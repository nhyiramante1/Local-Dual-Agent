import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  AgentResult,
  ConversationRecord,
  ConversationTurnRecord,
  ManagerBudget,
  ManagerProviderName,
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
import { parseProposalBlock, tryValidateAndSynthesize, userIntentAllowsCreatePlan } from "./proposals.js";
import { serviceLog } from "../service/logger.js";

export const defaultManagerBudget: ManagerBudget = {
  claudeMaxUsdPerTurn: 0.5,
  claudeMaxUsdPerDay: 5,
  codexMaxInputTokensPerDay: 500_000,
  codexMaxOutputTokensPerDay: 100_000,
  codexMaxRuntimeSeconds: 120,
  maxTurnsPerDay: 200,
  openaiMaxUsdPerTurn: 0.1,
  openaiMaxUsdPerDay: 2,
};

export type ChatProviders = Record<ProviderName, ProviderAdapter> & {
  openai?: ProviderAdapter;
};

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
    private readonly configAliases: Record<string, string> = {},
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
            buildManagerChatContext(this.store, conversation, this.budget, context, this.configAliases);
  }

  private readonly contextBuilder: ChatContextBuilder;

  assertBudget(provider: ManagerProviderName): void {
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
    } else if (provider === "openai") {
      // OpenAI: turn-limit gate above covers cost control.
      // USD per-day gate deferred until cost tracking is added (costKnown: false).
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
    const adapter =
      provider === "openai"
        ? this.providers.openai
        : this.providers[provider as ProviderName];
    if (!adapter) {
      throw new DuetError(
        `Manager provider "${provider}" is not configured.`,
        "CONFIGURATION_ERROR",
      );
    }
    const cwd = this.cwdFor(conversation);
    const before = conversation.runId
      ? await fingerprintRepository(cwd)
      : undefined;
    let result: AgentResult | undefined;
    try {
      result = await adapter.run({
        cwd,
        prompt: this.contextBuilder(conversation).prompt,
        mode: "read-only",
        timeoutMs:
          provider === "codex"
            ? this.budget.codexMaxRuntimeSeconds * 1_000
            : 60_000,
        maxBudgetUsd:
          provider === "claude"
            ? this.budget.claudeMaxUsdPerTurn
            : provider === "openai"
              ? this.budget.openaiMaxUsdPerTurn
              : undefined,
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
    // result is always set here — the try block throws on provider failure,
    // and the finally guard already checks `result` before asserting fingerprint.
    if (!result) throw new DuetError("Provider returned no result.", "MANAGER_TURN_FAILED");
    // Gather the recent user messages (not just the single latest) so create_plan
    // intent survives a natural multi-turn flow: "create a plan" -> answer the
    // manager's follow-up questions -> "go ahead". Checking only the latest turn
    // would wrongly block the proposal once the user moves past the word "plan".
    const latestUserMessage = this.store
      .listRecentConversationTurns(conversationId, 12)
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .join("\n");
    // Parse any proposal block from the reply. Strip it from visible content.
    const parseResult = parseProposalBlock(result.finalText);
    let contentToStore =
      parseResult.kind === "parsed"
        ? parseResult.strippedText
        : result.finalText;
    const diagnostics: { reason?: string } = {};
    const synthesized =
      parseResult.kind === "parsed"
        ? tryValidateAndSynthesize(
            parseResult.raw,
            conversation,
            this.store,
            latestUserMessage,
            this.configAliases,
            diagnostics,
          )
        : null;
    if (parseResult.kind === "invalid") {
      void serviceLog("warning", "manager proposal block was malformed", {
        conversationId,
        reason: parseResult.reason,
      });
    } else if (parseResult.kind === "parsed" && synthesized === null) {
      const isIntentBlocked =
        parseResult.raw.action === "create_plan" &&
        !userIntentAllowsCreatePlan(latestUserMessage);
      void serviceLog(
        "warning",
        isIntentBlocked
          ? "manager create_plan blocked: no planning intent in latest user message"
          : "manager proposal failed validation",
        { conversationId, action: parseResult.raw.action, runId: parseResult.raw.runId },
      );
      // Surface the rejection reason to the operator so a dropped proposal is not
      // silently invisible (the manager may have said "here is the proposal").
      if (diagnostics.reason) {
        contentToStore =
          `${contentToStore}\n\n_⚠ Proposal could not be created: ${diagnostics.reason}_`.trim();
      }
    }

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
