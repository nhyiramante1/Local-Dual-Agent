import { randomUUID } from "node:crypto";

import type { OperationRecord } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { Store } from "../persistence/store.js";
import type { ChatEngine, ManagerActivity } from "./engine.js";

const operationErrorMessageLimit = 500;

type ManagerActivitySnapshot = ManagerActivity & {
  history?: ManagerActivity[];
};

const completedActivityRetentionMs = 2_000;

function retryAfterSeconds(message: string): number | undefined {
  const match = /try again in about\s+(\d+)s|try again in\s+(\d+)/i.exec(message);
  const parsed = match ? Number(match[1] ?? match[2]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isAuthFailure(code: string, message: string): boolean {
  return (
    (code === "CODEX_FAILED" || code === "CLAUDE_FAILED") &&
    /refresh token|token.*revoked|sign in|log in|login|auth|oauth|unauthorized/i.test(message)
  );
}

function isProviderContextLimit(message: string): boolean {
  return (
    /\b413\b|request too large|tokens per minute|\bTPM\b|reduce your message size/i.test(message) &&
    /limit|requested|too large|tokens per minute|\bTPM\b/i.test(message)
  );
}

function providerContextLimitMessage(provider: string, message: string): string {
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  const limit = /limit\s+([\d,]+)/i.exec(message)?.[1];
  const requested = /requested\s+([\d,]+)/i.exec(message)?.[1];
  const detail = limit && requested
    ? ` (requested ${requested} tokens/minute; limit ${limit})`
    : "";
  return `${label} needs a smaller manager context for this tier${detail}. Clear context, switch managers, or try a shorter request.`;
}

function classifyManagerFailure(
  provider: string,
  code: string,
  message: string,
): { code: string; message: string; soft: boolean; sharedContext: boolean; expiresAt?: string } {
  if (isAuthFailure(code, message)) {
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    return {
      code: "PROVIDER_AUTH_REQUIRED",
      message: `${label} is signed out. Re-authenticate ${label} or switch managers.`,
      soft: true,
      sharedContext: true,
    };
  }
  if (isProviderContextLimit(message)) {
    return {
      code: "RATE_LIMITED",
      message: providerContextLimitMessage(provider, message),
      soft: true,
      sharedContext: true,
    };
  }
  if (code === "RATE_LIMITED") {
    const seconds = retryAfterSeconds(message);
    return {
      code,
      message,
      soft: true,
      sharedContext: true,
      expiresAt: seconds
        ? new Date(Date.now() + seconds * 1_000).toISOString()
        : undefined,
    };
  }
  if (code === "BUDGET_EXCEEDED") {
    return { code, message, soft: true, sharedContext: false };
  }
  if (code === "PROVIDER_TOOL_CALL_FAILED") {
    return { code, message, soft: true, sharedContext: true };
  }
  if (code === "PROVIDER_CONFIGURATION_ERROR") {
    return { code, message, soft: true, sharedContext: true };
  }
  return { code, message, soft: false, sharedContext: false };
}

function formatRetryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "later";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Runs manager turns as background `manager_turn` operations.
 *
 * It deliberately reuses ONLY the `operations` table (create/update + the
 * shared crash-recovery `interruptActiveOperations`). It is independent of the
 * run scheduler: it never acquires run leases and never touches run execution
 * state. The operation result is always `{ conversationId, turnId, status }`,
 * never a RunRecord.
 */
export class ChatActivityManager {
  private readonly activities = new Map<
    string,
    {
      conversationId: string;
      provider: string;
      controller: AbortController;
      promise: Promise<void>;
    }
  >();
  private readonly activeConversations = new Map<string, string>();
  private readonly activeProviders = new Map<string, string>();
  // Latest live activity per running manager_turn operation. In-memory only —
  // it is transient progress, polled by the dashboard, and cleared when the
  // operation finishes. Never persisted.
  private readonly activityByOperation = new Map<string, ManagerActivitySnapshot>();
  private readonly activityExpiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: Store,
    private readonly engine: ChatEngine,
    private readonly serviceInstanceId: string,
  ) {}

  hasActiveOperations(): boolean {
    return this.activities.size > 0;
  }

  getActivity(operationId: string): ManagerActivitySnapshot | undefined {
    return this.activityByOperation.get(operationId);
  }

  async wait(operationId: string): Promise<void> {
    await this.activities.get(operationId)?.promise;
  }

  cancelActive(operationId?: string): number {
    let cancelled = 0;
    for (const [id, activity] of this.activities) {
      if (operationId && operationId !== id) continue;
      const operation = this.store.getOperation(id);
      if (operation.status === "queued" || operation.status === "running") {
        this.store.updateOperation(id, {
          status: "cancelled",
          errorJson: JSON.stringify({
            code: "CANCELLED",
            message: "Cancellation requested.",
          }),
          finishedAt: new Date().toISOString(),
        });
      }
      activity.controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  private clearActivity(operationId: string): void {
    const timer = this.activityExpiryTimers.get(operationId);
    if (timer) {
      clearTimeout(timer);
      this.activityExpiryTimers.delete(operationId);
    }
    this.activityByOperation.delete(operationId);
  }

  private expireActivitySoon(operationId: string): void {
    const existing = this.activityExpiryTimers.get(operationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.activityExpiryTimers.delete(operationId);
      this.activityByOperation.delete(operationId);
    }, completedActivityRetentionMs);
    timer.unref?.();
    this.activityExpiryTimers.set(operationId, timer);
  }

  submitTurn(input: {
    conversationId: string;
    userMessage: string;
    inputHash: string;
  }): OperationRecord {
    const conversation = this.store.getConversation(input.conversationId);
    if (this.activeConversations.has(input.conversationId)) {
      throw new DuetError(
        `Conversation ${input.conversationId} already has an active manager turn.`,
        "CHAT_TURN_ACTIVE",
      );
    }
    if (this.activeProviders.has(conversation.interfaceAgent)) {
      throw new DuetError(
        `Provider ${conversation.interfaceAgent} already has an active manager turn.`,
        "CHAT_PROVIDER_ACTIVE",
      );
    }
    const operation: OperationRecord = this.store.transaction(() => {
      this.store.appendConversationTurn({
        conversationId: input.conversationId,
        role: "user",
        content: input.userMessage,
      });
      const op: OperationRecord = {
        id: randomUUID(),
        runId: conversation.runId,
        kind: "manager_turn",
        status: "queued",
        serviceInstanceId: this.serviceInstanceId,
        inputHash: input.inputHash,
        createdAt: new Date().toISOString(),
      };
      this.store.createOperation(op);
      return op;
    });
    const controller = new AbortController();
    this.activeConversations.set(input.conversationId, operation.id);
    this.activeProviders.set(conversation.interfaceAgent, operation.id);
    const promise = this.run(
      operation.id,
      input.conversationId,
      controller,
    ).finally(() => {
      this.activities.delete(operation.id);
      if (this.activeConversations.get(input.conversationId) === operation.id) {
        this.activeConversations.delete(input.conversationId);
      }
      if (
        this.activeProviders.get(conversation.interfaceAgent) === operation.id
      ) {
        this.activeProviders.delete(conversation.interfaceAgent);
      }
    });
    this.activities.set(operation.id, {
      conversationId: input.conversationId,
      provider: conversation.interfaceAgent,
      controller,
      promise,
    });
    return operation;
  }

  private async run(
    operationId: string,
    conversationId: string,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.store.updateOperation(operationId, {
      status: "running",
      startedAt,
      heartbeatAt: startedAt,
    });
    const heartbeat = setInterval(() => {
      this.store.updateOperation(operationId, {
        heartbeatAt: new Date().toISOString(),
      });
    }, 5_000);
    try {
      const conversation = this.store.getConversation(conversationId);
      const cooldown = this.activeProviderCooldown(
        conversation.interfaceAgent,
        conversation.runId,
      );
      if (cooldown) {
        const content =
          `${conversation.interfaceAgent} is cooling down until ${formatRetryTime(cooldown.expiresAt)}. ` +
          "No provider call was sent. Switch managers or try again then.";
        const failedTurn = this.store.appendConversationTurn({
          conversationId,
          role: "manager",
          interfaceAgent: conversation.interfaceAgent,
          content: "",
          status: "failed",
          errorJson: JSON.stringify({
            code: "RATE_LIMITED",
            message: content,
          }),
        });
        this.store.updateOperation(operationId, {
          status: "failed",
          errorJson: JSON.stringify({
            code: "RATE_LIMITED",
            message: content.slice(0, operationErrorMessageLimit),
          }),
          resultJson: JSON.stringify({
            conversationId,
            turnId: failedTurn.id,
            status: "failed",
          }),
          finishedAt: new Date().toISOString(),
        });
        return;
      }
      const turn = await this.engine.runManagerTurn(
        conversationId,
        operationId,
        () => controller.signal.aborted,
        (activity) => {
          const expiry = this.activityExpiryTimers.get(operationId);
          if (expiry) {
            clearTimeout(expiry);
            this.activityExpiryTimers.delete(operationId);
          }
          const previous = this.activityByOperation.get(operationId);
          const history = [...(previous?.history ?? []), activity].slice(-8);
          this.activityByOperation.set(operationId, { ...activity, history });
        },
      );
      this.store.updateOperation(operationId, {
        status: "succeeded",
        resultJson: JSON.stringify({
          conversationId,
          turnId: turn.id,
          status: turn.status,
        }),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const conversation = this.store.getConversation(conversationId);
      const code =
        error instanceof DuetError ? error.code : "MANAGER_TURN_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifyManagerFailure(
        conversation.interfaceAgent,
        code,
        message,
      );
      const cancelled = controller.signal.aborted || code === "CANCELLED";
      // The full (still bounded) error lives on the failed turn; the operation
      // carries only a short message so durable operation.* events stay small.
      const failedTurn = this.store.appendConversationTurn({
        conversationId,
        role: "manager",
        interfaceAgent: conversation.interfaceAgent,
        content: "",
        status: "failed",
        errorJson: JSON.stringify({
          code: cancelled ? "CANCELLED" : classified.code,
          message: cancelled ? message : classified.message,
        }),
      });
      if (!cancelled && classified.soft && classified.sharedContext) {
        this.store.addManagerSharedContext({
          kind: "provider_health",
          provider: conversation.interfaceAgent,
          conversationId,
          turnId: failedTurn.id,
          content: classified.message,
          metadataJson: JSON.stringify({
            code: classified.code,
            originalCode: code,
            originalMessage: message.slice(0, operationErrorMessageLimit),
          }),
          expiresAt: classified.expiresAt,
        });
      }
      this.store.updateOperation(operationId, {
        status: cancelled ? "cancelled" : "failed",
        errorJson: JSON.stringify({
          code: cancelled ? "CANCELLED" : classified.code,
          message: (cancelled ? message : classified.message).slice(0, operationErrorMessageLimit),
        }),
        resultJson: JSON.stringify({
          conversationId,
          turnId: failedTurn.id,
          status: cancelled ? "cancelled" : "failed",
        }),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
      if (this.activityByOperation.has(operationId)) {
        this.expireActivitySoon(operationId);
      } else {
        this.clearActivity(operationId);
      }
    }
  }

  private activeProviderCooldown(
    provider: string,
    runId?: string,
  ): { expiresAt: string } | undefined {
    const nowIso = new Date().toISOString();
    const notes = this.store.listManagerSharedContext({
      runId,
      limit: 50,
      nowIso,
    });
    const note = notes.find((candidate) => {
      const note = candidate;
      if (
        note.kind !== "provider_health" ||
        note.provider !== provider ||
        !note.expiresAt ||
        note.expiresAt <= nowIso
      ) {
        return false;
      }
      try {
        const metadata = note.metadataJson ? JSON.parse(note.metadataJson) as { code?: unknown } : {};
        return metadata.code === "RATE_LIMITED";
      } catch {
        return /rate limited|cooling down/i.test(note.content);
      }
    });
    return note?.expiresAt ? { expiresAt: note.expiresAt } : undefined;
  }
}
