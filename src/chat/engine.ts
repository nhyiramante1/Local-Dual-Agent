import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  AgentResult,
  ConversationRecord,
  ConversationTurnRecord,
  ManagerBudget,
  ManagerProviderName,
  ManagerToolCall,
  ProviderName,
} from "../core/domain.js";
import { isOpenAiCompatibleManager } from "../core/domain.js";
import type { DuetConfig } from "../config.js";
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
import {
  parseProposalBlock,
  stripMalformedProposalArtifacts,
  tryValidateAndSynthesize,
  userIntentAllowsCreatePlan,
} from "./proposals.js";
import { serviceLog } from "../service/logger.js";
import {
  executeManagerTool,
  managerToolDefinitions,
  serializeToolExecutions,
  type ManagerToolExecution,
} from "./tools.js";

// Phrases a weaker manager model uses when it narrates an intent to propose but
// forgets to emit the duet-proposal block. Used to trigger a single backstop retry.
const INTENT_TO_PROPOSE_RE =
  /\b(?:I (?:will |can |'ll |would )?propose|propose (?:the|a|this|an)\b|here is (?:the |a |my )?(?:proposal|plan)|a proposal can be|propose the following)/i;

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
  groq?: ProviderAdapter;
  gemini?: ProviderAdapter;
};

export type ManagerToolRuntimeOptions = Pick<
  DuetConfig["manager"],
  | "nativeToolCalling"
  | "actionMode"
  | "supportsMultiStepToolLoop"
  | "supportsAgentConsultation"
  | "latencyTier"
  | "maxToolCallsPerTurn"
>;

const defaultToolRuntimeOptions: ManagerToolRuntimeOptions = {
  nativeToolCalling: true,
  actionMode: "recommended",
  supportsMultiStepToolLoop: true,
  supportsAgentConsultation: true,
  latencyTier: "balanced",
  maxToolCallsPerTurn: 5,
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
    toolRuntime?: Partial<ManagerToolRuntimeOptions>,
  ) {
    this.toolRuntime = { ...defaultToolRuntimeOptions, ...(toolRuntime ?? {}) };
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
    this.toolContextBuilder =
      typeof context === "function"
        ? context
        : (conversation) =>
            buildManagerChatContext(
              this.store,
              conversation,
              this.budget,
              { ...(context ?? {}), toolRuntime: true },
              this.configAliases,
            );
  }

  private readonly contextBuilder: ChatContextBuilder;
  private readonly toolContextBuilder: ChatContextBuilder;
  private readonly toolRuntime: ManagerToolRuntimeOptions;

  assertBudget(provider: ManagerProviderName): void {
    const since = oneDayAgo();
    // Reserve the turn currently being attempted even if the caller has not
    // yet made its operation visible as queued/running in the Store.
    const reservedTurns = Math.max(1, this.store.countActiveManagerTurns());
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
    } else if (isOpenAiCompatibleManager(provider)) {
      // OpenAI-compatible (openai/groq/gemini): turn-limit gate above covers
      // cost control. USD per-day gate deferred until cost tracking is added
      // (costKnown: false).
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
    if (this.shouldUseToolRuntime(provider, adapter)) {
      return this.runToolManagerTurn(
        conversation,
        operationId,
        adapter,
        cwd,
        before,
        shouldCancel,
      );
    }
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
            : isOpenAiCompatibleManager(provider)
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
    // create_plan permission is decided from the CURRENT user message plus the
    // immediately-previous manager turn — not from a loose window of old text
    // and not from this reply (the model must never authorize its own proposal):
    //   - current user message expresses planning intent, OR
    //   - current user message is an affirmation AND the previous manager turn
    //     offered to propose a plan ("create a plan" -> Q&A -> "go ahead").
    const recentTurns = this.store.listRecentConversationTurns(conversationId, 12);
    const latestUserMessage =
      recentTurns.filter((turn) => turn.role === "user").at(-1)?.content ?? "";
    const lastManagerTurn = recentTurns
      .filter((turn) => turn.role === "manager")
      .at(-1);
    const managerOfferedPlan =
      !!lastManagerTurn && INTENT_TO_PROPOSE_RE.test(lastManagerTurn.content || "");
    // Parse any proposal block from the reply. Strip it from visible content.
    // If OpenAI-compatible action mode is disabled, keep the response purely
    // conversational; do not silently fall back to the legacy fenced protocol.
    // The legacy fenced-block path runs only for providers that did NOT take the
    // tool runtime above: non-tool-capable providers (codex/claude), or an
    // OpenAI-compatible provider whose action mode is "disabled".
    const allowLegacyProposalProtocol =
      adapter.supportsNativeToolCalling !== true ||
      this.toolRuntime.actionMode !== "disabled";
    let parseResult = allowLegacyProposalProtocol
      ? parseProposalBlock(result.finalText)
      : ({ kind: "none" } as const);
    // Visible content is the original reply (block stripped if it was inline).
    let contentToStore =
      parseResult.kind === "parsed"
        ? parseResult.strippedText
        : allowLegacyProposalProtocol
          ? result.finalText
          : stripMalformedProposalArtifacts(result.finalText);
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
            managerOfferedPlan,
          )
        : null;
    if (parseResult.kind === "invalid") {
      contentToStore = stripMalformedProposalArtifacts(contentToStore);
      void serviceLog("warning", "manager proposal block was malformed", {
        conversationId,
        reason: parseResult.reason,
      });
    } else if (parseResult.kind === "parsed" && synthesized === null) {
      const isIntentBlocked =
        parseResult.raw.action === "create_plan" &&
        !userIntentAllowsCreatePlan(latestUserMessage, managerOfferedPlan);
      void serviceLog(
        "warning",
        isIntentBlocked
          ? "manager create_plan blocked: no planning intent in latest user message"
          : "manager proposal failed validation",
        { conversationId, action: parseResult.raw.action, runId: parseResult.raw.runId },
      );
      // Surface the rejection reason to the operator so a dropped proposal is not
      // silently invisible (the manager may have said "here is the proposal").
      if (diagnostics.reason && !isIntentBlocked) {
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

  private shouldUseToolRuntime(
    provider: ManagerProviderName,
    adapter: ProviderAdapter,
  ): boolean {
    // Any OpenAI-compatible manager (openai/groq/gemini) with a tool-capable
    // adapter uses the native tool runtime; identity no longer hardcoded.
    return (
      isOpenAiCompatibleManager(provider) &&
      adapter.supportsNativeToolCalling === true &&
      this.toolRuntime.nativeToolCalling &&
      this.toolRuntime.actionMode !== "disabled"
    );
  }

  private async runToolManagerTurn(
    conversation: ConversationRecord,
    operationId: string,
    adapter: ProviderAdapter,
    cwd: string,
    before: Awaited<ReturnType<typeof fingerprintRepository>> | undefined,
    shouldCancel?: () => boolean,
  ): Promise<ConversationTurnRecord> {
    let first: AgentResult | undefined;
    let final: AgentResult | undefined;
    let executions: ManagerToolExecution[] = [];
    // Consultation is a paid capability; only expose its tool when enabled for
    // this manager profile. Other tools are always available to a capable model.
    const tools = this.toolRuntime.supportsAgentConsultation
      ? managerToolDefinitions
      : managerToolDefinitions.filter(
          (tool) => tool.name !== "request_agent_consultation",
        );
    try {
      const prompt = this.toolContextBuilder(conversation).prompt;
      first = await adapter.run({
        cwd,
        prompt,
        mode: "read-only",
        timeoutMs: 60_000,
        maxBudgetUsd: this.budget.openaiMaxUsdPerTurn,
        shouldCancel,
        tools,
      });
      if (shouldCancel?.()) {
        throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
      }
      const toolCalls = (first.toolCalls ?? []).slice(
        0,
        this.toolRuntime.maxToolCallsPerTurn,
      );
      executions = await this.executeToolCalls(toolCalls, conversation);
      if ((first.toolCalls?.length ?? 0) > toolCalls.length) {
        executions.push({
          name: "tool_runtime",
          ok: false,
          elapsedMs: 0,
          result: {
            code: "TOOL_CALL_LIMIT_EXCEEDED",
            message: `Only ${this.toolRuntime.maxToolCallsPerTurn} tool calls are allowed per manager turn.`,
          },
        });
      }
      if (executions.length > 0) {
        final = await adapter.run({
          cwd,
          prompt:
            prompt +
            "\n\n## Duet Tool Results\n" +
            "These are trusted backend tool results. Explain them naturally. If a proposal was created, mention it briefly; do not output JSON blocks.\n" +
            serializeToolExecutions(executions),
          mode: "read-only",
          timeoutMs: 60_000,
          maxBudgetUsd: this.budget.openaiMaxUsdPerTurn,
          shouldCancel,
        });
      } else {
        final = first;
      }
      if (shouldCancel?.()) {
        throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
      }
    } finally {
      if (before && (first || final)) {
        const after = await fingerprintRepository(cwd);
        assertFingerprintUnchanged(before, after);
      }
    }
    const result = final ?? first;
    if (!result) throw new DuetError("Provider returned no result.", "MANAGER_TURN_FAILED");
    const usage = this.combineUsage(first, final);
    return this.store.transaction(() => {
      const turn = this.store.appendConversationTurn({
        conversationId: conversation.id,
        role: "manager",
        interfaceAgent: conversation.interfaceAgent,
        content:
          result.finalText.trim() ||
          this.fallbackToolResponse(executions),
        providerSessionId: result.sessionId,
        usageJson: JSON.stringify({
          ...usage,
          providerModel: result.model,
          toolRuntime: true,
          toolCalls: executions.map((execution) => ({
            name: execution.name,
            ok: execution.ok,
            elapsedMs: execution.elapsedMs,
          })),
        }),
        operationId,
      });
      for (const execution of executions) {
        if (!execution.proposal) continue;
        this.store.createProposal({
          id: randomUUID(),
          conversationId: conversation.id,
          turnId: turn.id,
          runId: execution.proposal.runId,
          taskId: execution.proposal.taskId,
          action: execution.proposal.action,
          summary: execution.proposal.summary,
          commandCli: execution.proposal.commandCli,
          commandJson: execution.proposal.commandJson,
          tier: execution.proposal.tier,
          expiresAt: execution.proposal.expiresAt,
        });
      }
      return turn;
    });
  }

  private async executeToolCalls(
    toolCalls: ManagerToolCall[],
    conversation: ConversationRecord,
  ): Promise<ManagerToolExecution[]> {
    const executions: ManagerToolExecution[] = [];
    for (const call of toolCalls) {
      executions.push(
        await executeManagerTool({
          name: call.name,
          argumentsJson: call.argumentsJson,
          store: this.store,
          conversation,
          configAliases: this.configAliases,
        }),
      );
    }
    return executions;
  }

  private combineUsage(
    first: AgentResult | undefined,
    final: AgentResult | undefined,
  ): AgentResult["usage"] {
    if (!first) {
      return final?.usage ?? { inputTokens: 0, outputTokens: 0, costKnown: false };
    }
    if (!final || first === final) return first.usage;
    return {
      inputTokens: (first.usage.inputTokens ?? 0) + (final.usage.inputTokens ?? 0),
      cachedInputTokens:
        (first.usage.cachedInputTokens ?? 0) + (final.usage.cachedInputTokens ?? 0),
      outputTokens: (first.usage.outputTokens ?? 0) + (final.usage.outputTokens ?? 0),
      reasoningOutputTokens:
        (first.usage.reasoningOutputTokens ?? 0) +
        (final.usage.reasoningOutputTokens ?? 0),
      costKnown: first.usage.costKnown && final.usage.costKnown,
      costUsd:
        first.usage.costUsd !== undefined || final.usage.costUsd !== undefined
          ? (first.usage.costUsd ?? 0) + (final.usage.costUsd ?? 0)
          : undefined,
    };
  }

  private fallbackToolResponse(executions: ManagerToolExecution[]): string {
    if (executions.length === 0) return "I checked the available Duet context.";
    const proposal = executions.find((execution) => execution.proposal);
    if (proposal?.proposal) {
      return `I created a ${proposal.proposal.action} suggestion card.`;
    }
    const failed = executions.find((execution) => !execution.ok);
    if (failed) {
      return `I tried to use ${failed.name}, but it failed.`;
    }
    return "I checked the requested Duet context.";
  }

}
