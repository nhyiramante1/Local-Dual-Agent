import { randomUUID } from "node:crypto";

import type { OperationRecord } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { Store } from "../persistence/store.js";
import type { ChatEngine } from "./engine.js";

const operationErrorMessageLimit = 500;

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

  constructor(
    private readonly store: Store,
    private readonly engine: ChatEngine,
    private readonly serviceInstanceId: string,
  ) {}

  hasActiveOperations(): boolean {
    return this.activities.size > 0;
  }

  async wait(operationId: string): Promise<void> {
    await this.activities.get(operationId)?.promise;
  }

  cancelActive(operationId?: string): number {
    let cancelled = 0;
    for (const [id, activity] of this.activities) {
      if (operationId && operationId !== id) continue;
      activity.controller.abort();
      cancelled += 1;
    }
    return cancelled;
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
    this.store.appendConversationTurn({
      conversationId: input.conversationId,
      role: "user",
      content: input.userMessage,
    });
    const operation: OperationRecord = {
      id: randomUUID(),
      runId: conversation.runId,
      kind: "manager_turn",
      status: "queued",
      serviceInstanceId: this.serviceInstanceId,
      inputHash: input.inputHash,
      createdAt: new Date().toISOString(),
    };
    this.store.createOperation(operation);
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
      const turn = await this.engine.runManagerTurn(
        conversationId,
        operationId,
        () => controller.signal.aborted,
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
      const code =
        error instanceof DuetError ? error.code : "MANAGER_TURN_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = controller.signal.aborted || code === "CANCELLED";
      // The full (still bounded) error lives on the failed turn; the operation
      // carries only a short message so durable operation.* events stay small.
      const failedTurn = this.store.appendConversationTurn({
        conversationId,
        role: "manager",
        content: "",
        status: "failed",
        errorJson: JSON.stringify({ code, message }),
      });
      this.store.updateOperation(operationId, {
        status: cancelled ? "cancelled" : "failed",
        errorJson: JSON.stringify({
          code: cancelled ? "CANCELLED" : code,
          message: message.slice(0, operationErrorMessageLimit),
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
    }
  }
}
