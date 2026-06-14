import type { DuetConfig } from "../config.js";
import type {
  ProviderName,
  RunRecord,
  TaskRecord,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { Orchestrator } from "../orchestrator.js";
import { Store } from "../persistence/store.js";
import { approvalBinding } from "./integrity.js";

export class ApplicationCommands {
  constructor(
    readonly store: Store,
    readonly orchestrator = new Orchestrator(store),
  ) {}

  plan(input: {
    repoPath: string;
    goal: string;
    lead: ProviderName;
    config: DuetConfig;
  }): Promise<RunRecord> {
    return this.orchestrator.plan(input);
  }

  approve(
    runId: string,
    stage: "plan" | "merge",
    expectedVersion?: number,
  ): RunRecord {
    const run = this.store.getRun(runId);
    if (
      expectedVersion !== undefined &&
      (run.version ?? 1) !== expectedVersion
    ) {
      throw new DuetError("Run version changed.", "VERSION_CONFLICT");
    }
    const expected =
      stage === "plan" ? "awaiting_plan_approval" : "awaiting_merge_approval";
    if (run.status !== expected) {
      throw new DuetError(
        `Run ${runId} is not awaiting ${stage} approval.`,
        "INVALID_RUN_STATE",
      );
    }
    const binding = approvalBinding(run, this.store.listTasks(runId), stage);
    this.store.approve(runId, stage, binding);
    return this.store.getRun(runId);
  }

  execute(runId: string): Promise<RunRecord> {
    this.assertApproval(runId, "plan");
    return this.orchestrator.execute(runId);
  }

  resume(runId: string, config?: DuetConfig): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (!config || JSON.stringify(config) === run.configJson) {
      this.assertApproval(runId, "plan");
    }
    return this.orchestrator.resume(runId, config);
  }

  retry(runId: string, taskId: string): Promise<RunRecord> {
    this.assertApproval(runId, "plan");
    return this.orchestrator.retry(runId, taskId);
  }

  cancel(runId: string, taskId?: string): Promise<RunRecord> {
    return this.orchestrator.cancel(runId, taskId);
  }

  cleanup(runId: string, force = false): Promise<RunRecord> {
    return this.orchestrator.cleanup(runId, force);
  }

  resolve(runId: string, taskId: string): Promise<RunRecord> {
    this.assertApproval(runId, "plan");
    return this.orchestrator.resolve(runId, taskId);
  }

  merge(runId: string): Promise<RunRecord> {
    this.assertApproval(runId, "merge");
    return this.orchestrator.merge(runId);
  }

  getRun(runId: string): {
    run: RunRecord;
    tasks: TaskRecord[];
    usage: ReturnType<Store["getUsageSummary"]>;
    leases: ReturnType<Store["listLeases"]>;
    approvals: { plan: boolean; merge: boolean };
  } {
    return {
      run: this.store.getRun(runId),
      tasks: this.store.listTasks(runId),
      usage: this.store.getUsageSummary(runId),
      leases: this.store.listLeases(runId),
      approvals: {
        plan: this.store.isApproved(runId, "plan"),
        merge: this.store.isApproved(runId, "merge"),
      },
    };
  }

  private assertApproval(runId: string, stage: "plan" | "merge"): void {
    const run = this.store.getRun(runId);
    const recorded = this.store.getApprovalBinding(runId, stage);
    const current = approvalBinding(
      run,
      this.store.listTasks(runId),
      stage,
    );
    if (!recorded && this.store.isApproved(runId, stage)) {
      this.store.bindLegacyApproval(runId, stage, current);
      return;
    }
    if (recorded !== current) {
      throw new DuetError(
        `${stage} approval no longer matches the approved state.`,
        "APPROVAL_BINDING_MISMATCH",
      );
    }
  }
}
