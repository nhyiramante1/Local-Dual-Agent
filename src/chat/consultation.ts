import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  ConversationTurnRecord,
  ManagerBudget,
  OperationRecord,
  ProviderName,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import {
  assertFingerprintUnchanged,
  fingerprintRepository,
} from "../git/repository.js";
import type { Store } from "../persistence/store.js";
import { ConversationActivityLock } from "./conversation-lock.js";
import type { ChatProviders } from "./engine.js";
import { stripMalformedProposalArtifacts } from "./proposals.js";

export interface ConsultationInput {
  conversationId: string;
  proposalId: string;
  question: string;
  agents: ProviderName[];
  repoPath?: string;
  profile?: "cheap" | "balanced" | "reasoning" | "max";
  maxRuntimeSeconds: number;
  inputHash: string;
}

function oneDayAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
}

/**
 * Runs an approved agent_consultation: asks each selected agent (Claude/Codex)
 * the operator's question read-only and appends the reply as an inline turn.
 *
 * Like ChatActivityManager it reuses ONLY the operations table; it never
 * acquires run leases or touches run execution. Consultations are read-only and
 * fingerprint-enforced, so they never mutate a repository.
 */
export class ConsultationActivityManager {
  private readonly activities = new Map<
    string,
    { conversationId: string; controller: AbortController; promise: Promise<void> }
  >();
  private readonly activeConversations = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly providers: ChatProviders,
    private readonly budget: ManagerBudget,
    private readonly serviceInstanceId: string,
    // Shared with the manager-turn runner so the two never run concurrently in
    // one conversation. Defaults to a private lock for standalone construction.
    private readonly conversationLock: ConversationActivityLock = new ConversationActivityLock(),
  ) {}

  hasActiveOperations(): boolean {
    return this.activities.size > 0;
  }

  async wait(operationId: string): Promise<void> {
    await this.activities.get(operationId)?.promise;
  }

  // Abort-only cancellation: the run() promise writes the terminal status after
  // it actually unwinds, so the UI never sees "cancelled" before the backend has
  // finished. See ChatActivityManager.cancelActive for the rationale.
  cancelActive(operationId?: string): number {
    let cancelled = 0;
    for (const [id, activity] of this.activities) {
      if (operationId && operationId !== id) continue;
      activity.controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  isActive(operationId: string): boolean {
    return this.activities.has(operationId);
  }

  submit(input: ConsultationInput): OperationRecord {
    const conversation = this.store.getConversation(input.conversationId);
    if (this.conversationLock.isBusy(input.conversationId)) {
      throw new DuetError(
        `Conversation ${input.conversationId} already has active work (a manager turn or consultation is running).`,
        "CHAT_TURN_ACTIVE",
      );
    }
    const operation: OperationRecord = {
      id: randomUUID(),
      runId: conversation.runId,
      kind: "consultation",
      status: "queued",
      serviceInstanceId: this.serviceInstanceId,
      inputHash: input.inputHash,
      createdAt: new Date().toISOString(),
    };
    this.store.createOperation(operation);
    const controller = new AbortController();
    this.conversationLock.acquire(input.conversationId);
    this.activeConversations.set(input.conversationId, operation.id);
    const promise = this.run(operation.id, input, controller).finally(() => {
      this.activities.delete(operation.id);
      this.conversationLock.release(input.conversationId);
      if (this.activeConversations.get(input.conversationId) === operation.id) {
        this.activeConversations.delete(input.conversationId);
      }
    });
    this.activities.set(operation.id, {
      conversationId: input.conversationId,
      controller,
      promise,
    });
    return operation;
  }

  private assertBudget(agent: ProviderName): void {
    const since = oneDayAgo();
    if (agent === "claude") {
      const usage = this.store.sumManagerUsage("claude", since);
      if (usage.costUsd >= this.budget.claudeMaxUsdPerDay) {
        throw new DuetError("Daily Claude consultation budget reached.", "BUDGET_EXCEEDED");
      }
    } else {
      const usage = this.store.sumManagerUsage("codex", since);
      if (
        usage.inputTokens >= this.budget.codexMaxInputTokensPerDay ||
        usage.outputTokens >= this.budget.codexMaxOutputTokensPerDay
      ) {
        throw new DuetError("Daily Codex consultation token budget reached.", "BUDGET_EXCEEDED");
      }
    }
  }

  private buildPrompt(input: ConsultationInput, agent: ProviderName): string {
    const label = agent === "claude" ? "Claude" : "Codex";
    const recent = this.store
      .listRecentConversationTurns(input.conversationId, 8)
      .map((turn) => {
        const who = turn.role === "manager"
          ? `manager${turn.interfaceAgent ? `:${turn.interfaceAgent}` : ""}`
          : turn.role;
        return `[${who}] ${turn.content.slice(0, 1_000)}`;
      })
      .join("\n");
    return [
      `You are ${label}, consulted by the Duet manager for read-only advice.`,
      "This is a READ-ONLY consultation. Do NOT modify, create, or delete any files.",
      "",
      "Operator's question:",
      input.question,
      "",
      input.repoPath
        ? `You may inspect the repository at ${input.repoPath} read-only to ground your answer.`
        : "No repository is attached; answer from general reasoning.",
      "",
      "Recent conversation (context, newest last):",
      recent || "(none)",
      "",
      "Answer concretely and concisely. Base any repository claims on what you actually find.",
    ].join("\n");
  }

  private async run(
    operationId: string,
    input: ConsultationInput,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.store.updateOperation(operationId, { status: "running", startedAt, heartbeatAt: startedAt });
    const heartbeat = setInterval(() => {
      this.store.updateOperation(operationId, { heartbeatAt: new Date().toISOString() });
    }, 5_000);
    const conversation = this.store.getConversation(input.conversationId);
    const cwd = input.repoPath
      ?? (conversation.runId ? this.store.getRun(conversation.runId).repoRoot : os.tmpdir());
    const fingerprinted = Boolean(input.repoPath || conversation.runId);
    const turnIds: string[] = [];
    let anyAnswered = false;
    try {
      const before = fingerprinted ? await fingerprintRepository(cwd) : undefined;
      for (const agent of input.agents) {
        if (controller.signal.aborted) {
          throw new DuetError("Consultation cancelled.", "CANCELLED");
        }
        const adapter = this.providers[agent];
        if (!adapter) {
          turnIds.push(this.appendFailedTurn(input.conversationId, agent,
            "CONFIGURATION_ERROR", `${agent} is not configured.`).id);
          continue;
        }
        try {
          this.assertBudget(agent);
          const result = await adapter.run({
            cwd,
            prompt: this.buildPrompt(input, agent),
            mode: "read-only",
            timeoutMs: input.maxRuntimeSeconds * 1_000,
            maxBudgetUsd: agent === "claude" ? this.budget.claudeMaxUsdPerTurn : undefined,
            profile: input.profile,
            shouldCancel: () => controller.signal.aborted,
          });
          const content = stripMalformedProposalArtifacts(result.finalText.trim())
            || "(the agent returned no answer)";
          const turn = this.store.appendConversationTurn({
            conversationId: input.conversationId,
            role: "manager",
            interfaceAgent: agent,
            content,
            providerSessionId: result.sessionId,
            usageJson: JSON.stringify({
              ...result.usage,
              providerModel: result.model,
              consultation: true,
              agent,
            }),
            operationId,
          });
          turnIds.push(turn.id);
          anyAnswered = true;
          this.store.addManagerSharedContext({
            runId: conversation.runId,
            kind: "handoff",
            provider: agent,
            conversationId: input.conversationId,
            turnId: turn.id,
            content: `Consulted ${agent}: ${content.slice(0, 300)}`,
            metadataJson: JSON.stringify({ consultation: true, agent, question: input.question.slice(0, 200) }),
          });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          const code = error instanceof DuetError ? error.code : "AGENT_FAILED";
          const message = error instanceof Error ? error.message : String(error);
          turnIds.push(this.appendFailedTurn(input.conversationId, agent, code, message).id);
        }
      }
      if (before) {
        const after = await fingerprintRepository(cwd);
        assertFingerprintUnchanged(before, after);
      }
      this.store.updateOperation(operationId, {
        status: "succeeded",
        resultJson: JSON.stringify({
          conversationId: input.conversationId,
          turnIds,
          status: anyAnswered ? "ok" : "failed",
        }),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const cancelled = controller.signal.aborted
        || (error instanceof DuetError && error.code === "CANCELLED");
      const code = error instanceof DuetError ? error.code : "CONSULTATION_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateOperation(operationId, {
        status: cancelled ? "cancelled" : "failed",
        errorJson: JSON.stringify({ code: cancelled ? "CANCELLED" : code, message: message.slice(0, 500) }),
        resultJson: JSON.stringify({
          conversationId: input.conversationId,
          turnIds,
          status: cancelled ? "cancelled" : "failed",
        }),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private appendFailedTurn(
    conversationId: string,
    agent: ProviderName,
    code: string,
    message: string,
  ): ConversationTurnRecord {
    return this.store.appendConversationTurn({
      conversationId,
      role: "manager",
      interfaceAgent: agent,
      content: "",
      status: "failed",
      errorJson: JSON.stringify({ code, message: message.slice(0, 500) }),
      usageJson: JSON.stringify({ consultation: true, agent }),
    });
  }
}
