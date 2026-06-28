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
import type { AgentToolStep, ProviderAdapter } from "../providers/adapter.js";
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
  type ManagerToolExecution,
} from "./tools.js";

// Detects whether the previous legacy manager turn offered a plan so a follow-up
// user affirmation can synthesize the proposal the model omitted.
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
  [provider: string]: ProviderAdapter | undefined;
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

// Live progress for a manager turn, surfaced to the dashboard while the turn
// runs so the operator can see it is working and what it is doing.
export interface ManagerActivity {
  phase: "thinking" | "tool" | "summarizing";
  tool?: string;
  step: number;
}

export type ManagerActivityListener = (activity: ManagerActivity) => void;

const defaultToolRuntimeOptions: ManagerToolRuntimeOptions = {
  nativeToolCalling: true,
  actionMode: "recommended",
  supportsMultiStepToolLoop: true,
  supportsAgentConsultation: true,
  latencyTier: "balanced",
  maxToolCallsPerTurn: 5,
};

interface StoredToolTrace {
  name: string;
  ok: boolean;
  elapsedMs: number;
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function quoted(value: string | undefined): string | undefined {
  return value ? `"${value}"` : undefined;
}

function safeJsonObject(json: string | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value: unknown, limit = 240): unknown {
  return typeof value === "string" && value.length > limit
    ? `${value.slice(0, limit)}...`
    : value;
}

function summarizeSearchHit(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  return {
    path: boundedText(item.path, 500),
    type: item.type,
    line: item.line,
    snippet: boundedText(item.snippet),
  };
}

function summarizeFolderHit(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  return {
    path: boundedText(item.path, 500),
    matchCount: item.matchCount,
  };
}

function summarizeToolArguments(name: string, argumentsJson?: string): Record<string, unknown> | undefined {
  const args = safeJsonObject(argumentsJson);
  if (!args) return undefined;
  if (name === "search_files") {
    return {
      path: boundedText(args.path),
      namePattern: boundedText(args.namePattern),
      contentPattern: args.contentPattern ? "[content search]" : undefined,
      kind: args.kind,
      maxResults: args.maxResults,
    };
  }
  return Object.fromEntries(
    Object.entries(args)
      .slice(0, 8)
      .map(([key, value]) => [key, boundedText(value)]),
  );
}

function summarizeToolResult(name: string, result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (name === "search_files") {
    const matches = Array.isArray(record.matches)
      ? record.matches.slice(0, 5).map((match) => {
          return summarizeSearchHit(match);
        })
      : undefined;
    const folderMatches = Array.isArray(record.folderMatches)
      ? record.folderMatches.slice(0, 5).map((match) => {
          return summarizeFolderHit(match);
        })
      : undefined;
    return {
      root: boundedText(record.root, 500),
      namePattern: boundedText(record.namePattern),
      contentPattern: record.contentPattern ? "[content search]" : undefined,
      kind: record.kind,
      entriesScanned: record.entriesScanned,
      truncated: record.truncated,
      matched: record.matched,
      evidenceKind: record.evidenceKind,
      bestMatch: summarizeSearchHit(record.bestMatch),
      bestFolderMatch: summarizeFolderHit(record.bestFolderMatch),
      matchCount: record.matchCount,
      folderMatches,
      matches,
    };
  }
  if (name === "check_path" || name === "check_git_repo" || name === "resolve_alias") {
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 10)
        .map(([key, value]) => [key, boundedText(value, 500)]),
    );
  }
  return undefined;
}

function storedToolTrace(executions: ManagerToolExecution[]): StoredToolTrace[] {
  return executions.map((execution) => ({
    name: execution.name,
    ok: execution.ok,
    elapsedMs: execution.elapsedMs,
    arguments: summarizeToolArguments(execution.name, execution.argumentsJson),
    result: summarizeToolResult(execution.name, execution.result),
  }));
}

function oneDayAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
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
              {
                ...(context ?? {}),
                toolRuntime: true,
                supportsAgentConsultation: this.toolRuntime.supportsAgentConsultation,
              },
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
    onActivity?: ManagerActivityListener,
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
        onActivity,
      );
    }
    // Non-tool providers do a single reasoning pass — report it so the operator
    // sees the turn is alive even without tool steps.
    onActivity?.({ phase: "thinking", step: 1 });
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
        profile: provider === "claude" || provider === "codex" ? "cheap" : undefined,
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
        this.store.addManagerSharedContext({
          runId: synthesized.runId ?? conversation.runId,
          kind: "handoff",
          provider,
          conversationId,
          turnId: turn.id,
          content: `Created ${synthesized.action} suggestion card: ${synthesized.summary}`,
          metadataJson: JSON.stringify({
            action: synthesized.action,
            runId: synthesized.runId,
            taskId: synthesized.taskId,
          }),
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
    onActivity?: ManagerActivityListener,
  ): Promise<ConversationTurnRecord> {
    // Consultation is a paid capability; only expose its tool when enabled for
    // this manager profile. Other tools are always available to a capable model.
    const tools = this.toolRuntime.supportsAgentConsultation
      ? managerToolDefinitions
      : managerToolDefinitions.filter(
          (tool) => tool.name !== "request_agent_consultation",
        );
    const timeoutMs = this.toolRuntimeTimeoutMs();
    const executions: ManagerToolExecution[] = [];
    const responses: AgentResult[] = [];
    const priorSteps: AgentToolStep[] = [];
    // maxToolCallsPerTurn is a GLOBAL budget across loop iterations. It also
    // bounds iterations, since every iteration that continues the loop must
    // consume at least one call.
    let budgetRemaining = Math.max(0, this.toolRuntime.maxToolCallsPerTurn);
    let activityStep = 0;
    const emit = (activity: Omit<ManagerActivity, "step">): void => {
      onActivity?.({ ...activity, step: ++activityStep });
    };
    let result: AgentResult | undefined;
    try {
      const prompt = this.toolContextBuilder(conversation).prompt;
      // Bounded native tool loop. Each pass offers the tools; the model either
      // requests calls (which we execute and replay as real tool messages) or
      // answers in text (which ends the turn). With the loop disabled, this runs
      // exactly one tool round followed by one tool-free summarization pass.
      while (true) {
        emit({ phase: "thinking" });
        const response = await adapter.run({
          cwd,
          prompt,
          mode: "read-only",
          timeoutMs,
          maxBudgetUsd: this.budget.openaiMaxUsdPerTurn,
          shouldCancel,
          tools,
          priorSteps: priorSteps.length ? [...priorSteps] : undefined,
        });
        responses.push(response);
        if (shouldCancel?.()) {
          throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
        }
        const requested = response.toolCalls ?? [];
        if (requested.length === 0) {
          // Model answered in text — the turn is complete.
          result = response;
          break;
        }
        const allowed = requested.slice(0, budgetRemaining);
        const stepExecutions = await this.executeToolCalls(allowed, conversation, emit);
        executions.push(...stepExecutions);
        budgetRemaining -= allowed.length;
        if (requested.length > allowed.length) {
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
        priorSteps.push({
          assistantToolCalls: allowed,
          assistantText: response.finalText || undefined,
          results: allowed.map((call, index) => ({
            toolCallId: call.id,
            name: call.name,
            resultJson: JSON.stringify(stepExecutions[index]?.result ?? {}),
          })),
        });
        if (!this.toolRuntime.supportsMultiStepToolLoop) {
          // Legacy single-step: run exactly one tool round, then stop. The
          // response that carried the tool calls is the turn's result (its text,
          // or a fallback summary of what the tools did).
          result = response;
          break;
        }
        if (budgetRemaining <= 0) {
          // Loop enabled but the call budget is spent mid-loop: one final
          // tool-free pass so the model writes a closing message over the
          // results instead of being cut off after a bare tool call.
          emit({ phase: "summarizing" });
          const summary = await adapter.run({
            cwd,
            prompt,
            mode: "read-only",
            timeoutMs,
            maxBudgetUsd: this.budget.openaiMaxUsdPerTurn,
            shouldCancel,
            priorSteps: [...priorSteps],
          });
          responses.push(summary);
          result = summary;
          break;
        }
        // Otherwise loop again with tools and the replayed steps.
      }
      if (shouldCancel?.()) {
        throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
      }
    } finally {
      if (before && responses.length > 0) {
        const after = await fingerprintRepository(cwd);
        assertFingerprintUnchanged(before, after);
      }
    }
    if (!result) throw new DuetError("Provider returned no result.", "MANAGER_TURN_FAILED");
    const usage = this.combineUsage(responses);
    return this.store.transaction(() => {
      const turn = this.store.appendConversationTurn({
        conversationId: conversation.id,
        role: "manager",
        interfaceAgent: conversation.interfaceAgent,
        content:
          stripMalformedProposalArtifacts(result.finalText.trim()) ||
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
          toolTrace: storedToolTrace(executions),
        }),
        operationId,
      });
      for (const execution of executions) {
        if (
          execution.ok &&
          execution.name === "check_git_repo" &&
          typeof (execution.result as { path?: unknown }).path === "string" &&
          (execution.result as { isGitRepo?: unknown }).isGitRepo === true
        ) {
          const repoPath = (execution.result as { path: string }).path;
          this.addConfirmedRepoNote(conversation, turn, repoPath);
        }
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
        this.store.addManagerSharedContext({
          runId: execution.proposal.runId ?? conversation.runId,
          kind: "handoff",
          provider: conversation.interfaceAgent,
          conversationId: conversation.id,
          turnId: turn.id,
          content: `Created ${execution.proposal.action} suggestion card: ${execution.proposal.summary}`,
          metadataJson: JSON.stringify({
            action: execution.proposal.action,
            runId: execution.proposal.runId,
            taskId: execution.proposal.taskId,
          }),
          expiresAt: execution.proposal.expiresAt,
        });
      }
      return turn;
    });
  }

  private addConfirmedRepoNote(
    conversation: ConversationRecord,
    turn: ConversationTurnRecord,
    repoPath: string,
  ): void {
    const metadata = { tool: "check_git_repo", path: repoPath };
    this.store.addManagerSharedContext({
      runId: conversation.runId,
      kind: "note",
      provider: conversation.interfaceAgent,
      conversationId: conversation.id,
      turnId: turn.id,
      content: `Found git repository at ${repoPath}.`,
      metadataJson: JSON.stringify(metadata),
      expiresAt: daysFromNow(30),
    });
  }

  private async executeToolCalls(
    toolCalls: ManagerToolCall[],
    conversation: ConversationRecord,
    emit?: (activity: Omit<ManagerActivity, "step">) => void,
  ): Promise<ManagerToolExecution[]> {
    const executions: ManagerToolExecution[] = [];
    for (const call of toolCalls) {
      emit?.({ phase: "tool", tool: call.name });
      const execution = await executeManagerTool({
        name: call.name,
        argumentsJson: call.argumentsJson,
        store: this.store,
        conversation,
        configAliases: this.configAliases,
      });
      executions.push({ ...execution, argumentsJson: call.argumentsJson });
    }
    return executions;
  }

  private combineUsage(responses: AgentResult[]): AgentResult["usage"] {
    if (responses.length === 0) {
      return { inputTokens: 0, outputTokens: 0, costKnown: false };
    }
    if (responses.length === 1) return responses[0].usage;
    let anyCostKnown = false;
    let anyCostUsd = false;
    const totals = responses.reduce(
      (acc, response) => {
        const usage = response.usage;
        anyCostKnown ||= usage.costKnown === true;
        anyCostUsd ||= usage.costUsd !== undefined;
        return {
          inputTokens: acc.inputTokens + (usage.inputTokens ?? 0),
          cachedInputTokens: acc.cachedInputTokens + (usage.cachedInputTokens ?? 0),
          outputTokens: acc.outputTokens + (usage.outputTokens ?? 0),
          reasoningOutputTokens:
            acc.reasoningOutputTokens + (usage.reasoningOutputTokens ?? 0),
          costUsd: acc.costUsd + (usage.costUsd ?? 0),
          // costKnown is true only if EVERY pass reported known cost.
          costKnown: acc.costKnown && usage.costKnown === true,
        };
      },
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        costUsd: 0,
        costKnown: true,
      },
    );
    return {
      inputTokens: totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      outputTokens: totals.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens,
      costKnown: anyCostKnown ? totals.costKnown : false,
      costUsd: anyCostUsd ? totals.costUsd : undefined,
    };
  }

  private toolRuntimeTimeoutMs(): number {
    switch (this.toolRuntime.latencyTier) {
      case "fast":
        return 30_000;
      case "slow":
        return 120_000;
      case "balanced":
      default:
        return 60_000;
    }
  }

  private fallbackSearchResponse(execution: ManagerToolExecution): string | undefined {
    const result = asRecord(execution.result);
    if (!result) return undefined;
    const root = asString(result.root);
    const namePattern = asString(result.namePattern);
    const contentPattern = asString(result.contentPattern);
    const target = quoted(namePattern ?? contentPattern);
    const matchCount = asNumber(result.matchCount) ?? 0;
    const matched = result.matched === true;
    const matches = Array.isArray(result.matches)
      ? result.matches
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
      : [];
    const folderMatches = Array.isArray(result.folderMatches)
      ? result.folderMatches
          .map((item) => asRecord(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
      : [];
    const bestFolderMatch = asRecord(result.bestFolderMatch);
    const bestMatch = asRecord(result.bestMatch);
    const strongestFolder = asString(bestFolderMatch?.path) ?? asString(folderMatches[0]?.path);
    const strongestMatch = bestMatch && asString(bestMatch.path)
      ? bestMatch
      : matches.find((item) => asString(item.path));
    const strongestMatchPath = asString(strongestMatch?.path);
    const strongestType = strongestMatch?.type === "dir" ? "folder" : "file";
    if (!matched && folderMatches.length === 0) {
      if (target && root) return `I didn't find any matches for ${target} under ${root}.`;
      if (target) return `I didn't find any matches for ${target}.`;
      return "I didn't find a matching file or folder in the searched location.";
    }
    if (strongestFolder) {
      if (matchCount <= 1) return `I found a matching folder at ${strongestFolder}.`;
      return `I found ${matchCount} matching items. The strongest folder match is ${strongestFolder}.`;
    }
    if (strongestMatchPath) {
      if (matchCount <= 1) return `I found a matching ${strongestType} at ${strongestMatchPath}.`;
      return `I found ${matchCount} matching ${strongestType}s. The strongest match is ${strongestMatchPath}.`;
    }
    return "I searched and included the strongest matches below.";
  }

  private fallbackCheckGitRepoResponse(execution: ManagerToolExecution): string | undefined {
    const result = asRecord(execution.result);
    if (!result) return undefined;
    const repoPath = asString(result.path);
    const exists = result.exists === true;
    const isGitRepo = result.isGitRepo === true;
    if (repoPath && isGitRepo) return `I confirmed ${repoPath} is a Git repository.`;
    if (repoPath && !exists) return `I couldn't find ${repoPath}.`;
    if (repoPath) return `${repoPath} exists, but it doesn't look like a Git repository.`;
    return undefined;
  }

  private fallbackCheckPathResponse(execution: ManagerToolExecution): string | undefined {
    const result = asRecord(execution.result);
    if (!result) return undefined;
    const candidate = asString(result.path);
    if (!candidate) return undefined;
    if (result.exists !== true) return `I couldn't find ${candidate}.`;
    if (result.isDirectory === true) return `I confirmed ${candidate} exists and is a folder.`;
    if (result.isFile === true) return `I confirmed ${candidate} exists and is a file.`;
    return `I confirmed ${candidate} exists.`;
  }

  private fallbackResolveAliasResponse(execution: ManagerToolExecution): string | undefined {
    const result = asRecord(execution.result);
    if (!result) return undefined;
    const name = asString(result.name);
    const repoPath = asString(result.repoPath);
    if (name && repoPath) return `I resolved alias ${quoted(name)} to ${repoPath}.`;
    if (name) return `I couldn't resolve alias ${quoted(name)}.`;
    return undefined;
  }

  private fallbackToolSummary(executions: ManagerToolExecution[]): string | undefined {
    const search = executions.find((execution) => execution.name === "search_files" && execution.ok);
    if (search) return this.fallbackSearchResponse(search);
    const repo = executions.find((execution) => execution.name === "check_git_repo" && execution.ok);
    if (repo) return this.fallbackCheckGitRepoResponse(repo);
    const path = executions.find((execution) => execution.name === "check_path" && execution.ok);
    if (path) return this.fallbackCheckPathResponse(path);
    const alias = executions.find((execution) => execution.name === "resolve_alias" && execution.ok);
    if (alias) return this.fallbackResolveAliasResponse(alias);
    return undefined;
  }

  private fallbackToolResponse(executions: ManagerToolExecution[]): string {
    if (executions.length === 0) return "I looked into it.";
    const proposal = executions.find((execution) => execution.proposal);
    if (proposal?.proposal) {
      return `I created a ${proposal.proposal.action} suggestion card.`;
    }
    // Lead with successful evidence. A later tool call may have failed (e.g. a
    // malformed second search), but when the substantive read-only tools
    // succeeded the answer must reflect that — and stay consistent with the
    // trace, which hides a failed search when a successful one exists. Only
    // report a failure when nothing substantive succeeded.
    const synthesized = this.fallbackToolSummary(executions);
    if (synthesized) return synthesized;
    const failed = executions.find((execution) => !execution.ok);
    if (failed) {
      return `I tried to use ${failed.name}, but it failed.`;
    }
    return "I looked into it and included the tool results below.";
  }

}
