import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  AgentResult,
  ConversationRecord,
  ConversationTurnRecord,
  ProviderName,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { ProviderAdapter } from "../providers/adapter.js";
import type { Store } from "../persistence/store.js";
import {
  assertFingerprintUnchanged,
  fingerprintRepository,
} from "../git/repository.js";
import {
  buildManagerChatContext,
  type ChatContextBuilder,
  type ChatContextOptions,
} from "./context.js";
import { parseProposalBlock, tryValidateAndSynthesize } from "./proposals.js";

/**
 * Per-provider manager-chat budgets. Claude is metered in USD; Codex has no
 * reliable USD in the accounting model, so it is metered by historical token
 * totals before starting another turn. Never infer Codex USD.
 *
 * Injectable (with a default) for Phase 5A; wiring into `src/config.ts` is a
 * later step.
 */
export interface ManagerBudget {
  claudeMaxUsdPerTurn: number;
  claudeMaxUsdPerDay: number;
  codexMaxInputTokensPerDay: number;
  codexMaxOutputTokensPerDay: number;
  codexMaxRuntimeSeconds: number;
  maxTurnsPerDay: number;
}

export const defaultManagerBudget: ManagerBudget = {
  claudeMaxUsdPerTurn: 0.5,
  claudeMaxUsdPerDay: 5,
  codexMaxInputTokensPerDay: 500_000,
  codexMaxOutputTokensPerDay: 100_000,
  codexMaxRuntimeSeconds: 120,
  maxTurnsPerDay: 200,
};

export type ChatProviders = Record<ProviderName, ProviderAdapter>;

function oneDayAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
}

/**
 * Runs a single read-only manager turn. The manager answers from assembled
 * context only; in Phase 5A it has no execution or proposal path. Budget is
 * checked BEFORE any provider call so an over-cap turn never spends quota.
 */
export class ChatEngine {
  private readonly cwdFor: (conversation: ConversationRecord) => string;

  constructor(
    private readonly store: Store,
    private readonly providers: ChatProviders,
    private readonly budget: ManagerBudget = defaultManagerBudget,
    cwdFor?: (conversation: ConversationRecord) => string,
    context?: ChatContextBuilder | Partial<ChatContextOptions>,
  ) {
    this.cwdFor =
      cwdFor ??
      ((conversation) =>
        conversation.runId
          ? this.store.getRun(conversation.runId).repoRoot
          : os.tmpdir());
    this.contextBuilder =
      typeof context === "function"
        ? context
        : (conversation) =>
            buildManagerChatContext(this.store, conversation, this.budget, context);
  }

  private readonly contextBuilder: ChatContextBuilder;

  assertBudget(provider: ProviderName): void {
    const since = oneDayAgo();
    const reservedTurns = this.store.countActiveManagerTurns();
    if (
      this.store.countManagerTurns(since) + reservedTurns >
      this.budget.maxTurnsPerDay
    ) {
      throw new DuetError(
        "Daily manager-chat turn limit reached.",
        "BUDGET_EXCEEDED",
      );
    }
    if (provider === "claude") {
      const usage = this.store.sumManagerUsage("claude", since);
      if (usage.costUsd >= this.budget.claudeMaxUsdPerDay) {
        throw new DuetError(
          "Daily Claude manager-chat budget reached.",
          "BUDGET_EXCEEDED",
        );
      }
    } else {
      const usage = this.store.sumManagerUsage("codex", since);
      if (
        usage.inputTokens >= this.budget.codexMaxInputTokensPerDay ||
        usage.outputTokens >= this.budget.codexMaxOutputTokensPerDay
      ) {
        throw new DuetError(
          "Daily Codex manager-chat token budget reached.",
          "BUDGET_EXCEEDED",
        );
      }
    }
  }

  async runManagerTurn(
    conversationId: string,
    operationId: string,
    shouldCancel?: () => boolean,
  ): Promise<ConversationTurnRecord> {
    const conversation = this.store.getConversation(conversationId);
    const provider = conversation.interfaceAgent;
    // Budget gate happens before the provider is touched.
    this.assertBudget(provider);
    if (shouldCancel?.()) {
      throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
    }
    const adapter = this.providers[provider];
    const cwd = this.cwdFor(conversation);
    const before = conversation.runId
      ? await fingerprintRepository(cwd)
      : undefined;
    let result: AgentResult;
    try {
      result = await adapter.run({
        cwd,
        prompt: this.contextBuilder(conversation).prompt,
        mode: "read-only",
        timeoutMs: this.budget.codexMaxRuntimeSeconds * 1_000,
        maxBudgetUsd:
          provider === "claude" ? this.budget.claudeMaxUsdPerTurn : undefined,
        shouldCancel,
      });
      if (shouldCancel?.()) {
        throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
      }
    } finally {
      // Only assert fingerprint when the provider call completed (result is set).
      // If the provider itself threw, skip asserting to avoid masking the original error.
      if (before && result) {
        const after = await fingerprintRepository(cwd);
        assertFingerprintUnchanged(before, after);
      }
    }
    // Parse any proposal block from the reply. Strip it from visible content.
    const parseResult = parseProposalBlock(result.finalText);
    const contentToStore =
      parseResult.kind === "parsed"
        ? parseResult.strippedText
        : result.finalText;
    const synthesized =
      parseResult.kind === "parsed"
        ? tryValidateAndSynthesize(parseResult.raw, conversation, this.store)
        : null;

    // Persist turn + optional proposal atomically.
    // If a valid proposal fails to persist (DB error), the whole transaction
    // rolls back so the turn is not silently stored without its proposal.
    return this.store.transaction(() => {
      const turn = this.store.appendConversationTurn({
        conversationId,
        role: "manager",
        interfaceAgent: provider,
        content: contentToStore,
        providerSessionId: result.sessionId,
        usageJson: JSON.stringify(result.usage),
        operationId,
      });
      if (synthesized) {
        this.store.createProposal({
          id: randomUUID(),
          conversationId,
          turnId: turn.id,
          runId: synthesized.runId,
          taskId: synthesized.taskId,
          action: synthesized.action,
          summary: synthesized.summary,
          commandCli: synthesized.commandCli,
          commandJson: synthesized.commandJson,
          tier: synthesized.tier,
          expiresAt: synthesized.expiresAt,
        });
      }
      return turn;
    });
  }

}
