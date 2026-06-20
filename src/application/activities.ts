import { createHash, randomUUID } from "node:crypto";

import type { DuetConfig } from "../config.js";
import type {
  OperationRecord,
  ProviderName,
  RunRecord,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { ApplicationCommands } from "./commands.js";

export type LongRunningCommand =
  | {
      kind: "plan";
      repoPath: string;
      goal: string;
      lead: ProviderName;
      config: DuetConfig;
    }
  | { kind: "execute"; runId: string }
  | { kind: "resume"; runId: string; config?: DuetConfig }
  | { kind: "retry"; runId: string; taskId: string }
  | { kind: "cancel"; runId: string; taskId?: string }
  | { kind: "cleanup"; runId: string; force?: boolean }
  | { kind: "resolve"; runId: string; taskId: string }
  | { kind: "merge"; runId: string };

function inputHash(command: LongRunningCommand): string {
  return createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
}

export class ActivityManager {
  private readonly activeRuns = new Map<string, string>();
  private readonly activities = new Map<string, Promise<void>>();

  constructor(
    private readonly app: ApplicationCommands,
    private readonly serviceInstanceId: string,
  ) {}

  recoverInterrupted(): number {
    return this.app.store.interruptActiveOperations(this.serviceInstanceId);
  }

  submit(command: LongRunningCommand): OperationRecord {
    const runId = "runId" in command ? command.runId : undefined;
    const existing = runId ? this.activeRuns.get(runId) : undefined;
    if (existing && command.kind !== "cancel") {
      throw new DuetError(
        `Run ${runId} already has active operation ${existing}.`,
        "RUN_ACTIVITY_ACTIVE",
      );
    }
    const operation: OperationRecord = {
      id: randomUUID(),
      runId,
      kind: command.kind,
      status: "queued",
      serviceInstanceId: this.serviceInstanceId,
      inputHash: inputHash(command),
      createdAt: new Date().toISOString(),
    };
    this.app.store.createOperation(operation);
    if (runId && command.kind !== "cancel") {
      this.activeRuns.set(runId, operation.id);
    }
    const activity = this.run(operation.id, command).finally(() => {
      this.activities.delete(operation.id);
      if (
        runId &&
        command.kind !== "cancel" &&
        this.activeRuns.get(runId) === operation.id
      ) {
        this.activeRuns.delete(runId);
      }
    });
    this.activities.set(operation.id, activity);
    return operation;
  }

  get(operationId: string): OperationRecord {
    return this.app.store.getOperation(operationId);
  }

  isRunActive(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  hasActiveOperations(): boolean {
    return this.activities.size > 0;
  }

  cancelActive(operationId: string): void {
    const operation = this.app.store.getOperation(operationId);
    if (operation.status !== "queued" && operation.status !== "running") return;
    this.app.store.updateOperation(operationId, {
      status: "cancelled",
      errorJson: JSON.stringify({ code: "CANCELLED", message: "Cancelled before start." }),
      finishedAt: new Date().toISOString(),
    });
    if (operation.runId) this.activeRuns.delete(operation.runId);
    this.activities.delete(operationId);
  }

  async wait(operationId: string): Promise<OperationRecord> {
    await this.activities.get(operationId);
    return this.get(operationId);
  }

  private async run(
    operationId: string,
    command: LongRunningCommand,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.app.store.updateOperation(operationId, {
      status: "running",
      startedAt,
      heartbeatAt: startedAt,
    });
    const heartbeat = setInterval(() => {
      this.app.store.updateOperation(operationId, {
        heartbeatAt: new Date().toISOString(),
      });
    }, 5_000);
    try {
      const result = await this.dispatch(command);
      this.app.store.updateOperation(operationId, {
        runId: result.id,
        status: result.status === "cancelled" ? "cancelled" : "succeeded",
        resultJson: JSON.stringify(result),
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.app.store.updateOperation(operationId, {
        status: "failed",
        errorJson: JSON.stringify({
          code: error instanceof DuetError ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private dispatch(command: LongRunningCommand): Promise<RunRecord> {
    switch (command.kind) {
      case "plan":
        return this.app.plan(command);
      case "execute":
        return this.app.execute(command.runId);
      case "resume":
        return this.app.resume(command.runId, command.config);
      case "retry":
        return this.app.retry(command.runId, command.taskId);
      case "cancel":
        return this.app.cancel(command.runId, command.taskId);
      case "cleanup":
        return this.app.cleanup(command.runId, command.force);
      case "resolve":
        return this.app.resolve(command.runId, command.taskId);
      case "merge":
        return this.app.merge(command.runId);
    }
  }
}
