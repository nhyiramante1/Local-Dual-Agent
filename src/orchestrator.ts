import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentResult,
  ProviderName,
  ReviewResult,
  RunPlan,
  RunRecord,
  TaskPlan,
  TaskRecord,
  VerificationResult,
} from "./core/domain.js";
import { DuetError } from "./core/errors.js";
import { extractMarkedJson, extractMarkedPatch } from "./core/json.js";
import {
  normalizeConfig,
  type DuetConfig,
  type PartialDuetConfig,
} from "./config.js";
import {
  assertAllowedChanges,
  assertFingerprintUnchanged,
  cherryPickTask,
  commitArtifact,
  commitReviewedTree,
  createManagedWorktree,
  currentHead,
  fingerprintRepository,
  inspectRepository,
  listChanges,
  mergeRun,
  preflightAndApplyPatch,
  removeManagedWorktree,
  requireClean,
  stageCandidate,
} from "./git/repository.js";
import { Store } from "./persistence/store.js";
import { terminateProcessTree, isProcessAlive } from "./process/run-command.js";
import type {
  AgentTurn,
  ProviderAdapter,
} from "./providers/adapter.js";
import { providerAdapter } from "./providers/index.js";
import {
  implementationPrompt,
  planningPrompt,
  reviewPrompt,
  revisionPrompt,
} from "./providers/prompts.js";
import {
  validateReview,
  validateRunPlan,
} from "./providers/validation.js";
import { runVerification } from "./verification.js";
import { approvalBinding } from "./application/integrity.js";
import { artifactsRoot } from "./paths.js";

const maxReviewDiffCharacters = 200_000;
const leaseTtlMs = 30_000;
const leaseHeartbeatMs = 5_000;

type ProviderFactory = (name: ProviderName) => ProviderAdapter;

function createRunId(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function ownerId(): string {
  return `${process.pid}-${randomBytes(5).toString("hex")}`;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function opposite(provider: ProviderName): ProviderName {
  return provider === "claude" ? "codex" : "claude";
}

function parseConfig(run: RunRecord): DuetConfig {
  return normalizeConfig(JSON.parse(run.configJson) as PartialDuetConfig);
}

function allVerificationPassed(results: VerificationResult[]): boolean {
  return results.every((result) => result.passed);
}

function verificationReview(
  review: ReviewResult,
  verification: VerificationResult[],
): ReviewResult {
  if (allVerificationPassed(verification)) return review;
  return {
    verdict: "request_changes",
    summary: `${review.summary} Supervisor verification failed.`,
    findings: [
      ...review.findings,
      {
        severity: "high",
        description:
          "One or more configured verification commands failed. Correct the implementation so verification passes.",
        required: true,
      },
    ],
  };
}

function stableTopological(plan: RunPlan): TaskPlan[] {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const remaining = new Map(
    plan.tasks.map((task) => [task.id, new Set(task.dependencies)]),
  );
  const result: TaskPlan[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort();
    if (ready.length === 0) {
      throw new DuetError("Task graph contains a cycle.", "INVALID_PLAN");
    }
    for (const id of ready) {
      result.push(byId.get(id)!);
      remaining.delete(id);
      for (const dependencies of remaining.values()) dependencies.delete(id);
    }
  }
  return result;
}

function buildTaskRecords(
  runId: string,
  plan: RunPlan,
  lead: ProviderName,
): TaskRecord[] {
  const counts: Record<ProviderName, number> = { claude: 0, codex: 0 };
  const stamp = new Date().toISOString();
  return stableTopological(plan).map((task, ordinal) => {
    const provider =
      task.preferredProvider ??
      (counts.claude === counts.codex
        ? ordinal % 2 === 0
          ? opposite(lead)
          : lead
        : counts.claude < counts.codex
          ? "claude"
          : "codex");
    counts[provider] += 1;
    return {
      runId,
      id: task.id,
      ordinal,
      plan: task,
      status: task.dependencies.length === 0 ? "ready" : "blocked",
      provider,
      reviewerProvider: opposite(provider),
      revisionCount: 0,
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
  });
}

export class Orchestrator {
  constructor(
    private readonly store: Store,
    private readonly adapters: ProviderFactory = providerAdapter,
  ) {}

  async plan(options: {
    repoPath: string;
    goal: string;
    lead: ProviderName;
    config: DuetConfig;
  }): Promise<RunRecord> {
    const snapshot = await inspectRepository(options.repoPath);
    requireClean(snapshot);
    const id = createRunId();
    const stamp = new Date().toISOString();
    const run: RunRecord = {
      id,
      repoPath: options.repoPath,
      repoRoot: snapshot.root,
      goal: options.goal,
      status: "planning",
      leadProvider: options.lead,
      baseBranch: snapshot.branch,
      baseCommit: snapshot.head,
      integrationBranch: `duet/${id}/integration`,
      configJson: JSON.stringify(options.config),
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.store.createRun(run);
    this.store.addMessage(id, "goal", options.goal);

    try {
      const before = await fingerprintRepository(run.repoRoot);
      let result: AgentResult;
      try {
        result = await this.runAgent(
          run,
          undefined,
          "planner",
          run.leadProvider,
          {
            cwd: run.repoRoot,
            prompt: planningPrompt(
              run.goal,
              options.config.orchestration.maxTasks,
            ),
            mode: "read-only",
            timeoutMs:
              options.config.orchestration.agentTimeoutSeconds * 1_000,
          },
        );
      } finally {
        const after = await fingerprintRepository(run.repoRoot);
        assertFingerprintUnchanged(before, after);
      }
      const plan = validateRunPlan(
        extractMarkedJson<RunPlan>(result.finalText),
        options.config.orchestration.maxTasks,
      );
      const tasks = buildTaskRecords(id, plan, run.leadProvider);
      this.store.addMessage(
        id,
        "plan",
        JSON.stringify(plan),
        run.leadProvider,
      );
      this.store.replacePlan(id, plan, tasks);
      return this.store.getRun(id);
    } catch (error) {
      this.failRun(id, error);
      throw error;
    }
  }

  approve(runId: string, stage: "plan" | "merge"): RunRecord {
    const run = this.store.getRun(runId);
    const expected =
      stage === "plan" ? "awaiting_plan_approval" : "awaiting_merge_approval";
    if (run.status !== expected) {
      throw new DuetError(
        `Run ${runId} is not awaiting ${stage} approval.`,
        "INVALID_RUN_STATE",
      );
    }
    this.store.approve(
      runId,
      stage,
      approvalBinding(run, this.store.listTasks(runId), stage),
    );
    return this.store.getRun(runId);
  }

  async execute(runId: string): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (
      ![
        "approved",
        "running",
        "paused_budget",
        "needs_attention",
      ].includes(run.status) ||
      !this.store.isApproved(runId, "plan")
    ) {
      throw new DuetError(
        `Run ${runId} requires plan approval or a resumable state.`,
        "PLAN_NOT_APPROVED",
      );
    }
    const planBinding = approvalBinding(
      run,
      this.store.listTasks(runId),
      "plan",
    );
    const recordedPlanBinding = this.store.getApprovalBinding(runId, "plan");
    if (!recordedPlanBinding) {
      this.store.bindLegacyApproval(runId, "plan", planBinding);
    } else if (recordedPlanBinding !== planBinding) {
      throw new DuetError(
        "Plan approval no longer matches the approved state.",
        "APPROVAL_BINDING_MISMATCH",
      );
    }
    if (!run.plan) {
      throw new DuetError("Approved run has no plan.", "MISSING_PLAN");
    }

    const owner = ownerId();
    if (!this.store.acquireLease("run", runId, owner, leaseTtlMs)) {
      throw new DuetError(
        `Run ${runId} already has a live supervisor.`,
        "LIVE_LEASE",
      );
    }
    const heartbeat = setInterval(() => {
      this.store.renewLease("run", runId, owner, leaseTtlMs);
    }, leaseHeartbeatMs);

    try {
      return await this.schedule(runId, owner);
    } catch (error) {
      if (error instanceof DuetError && error.code === "BUDGET_PAUSED") {
        return this.store.getRun(runId);
      }
      this.failRun(runId, error);
      throw error;
    } finally {
      clearInterval(heartbeat);
      this.store.releaseLease("run", runId, owner);
    }
  }

  async resume(runId: string, config?: DuetConfig): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (config && JSON.stringify(config) !== run.configJson) {
      this.store.invalidateApproval(
        runId,
        "plan",
        "Run configuration changed during resume.",
      );
      this.store.updateRun(runId, {
        configJson: JSON.stringify(config),
        status: "awaiting_plan_approval",
        error: "Configuration changed; approve the updated run fingerprint.",
      });
      return this.store.getRun(runId);
    }
    for (const attempt of this.store.listRunningAttempts(runId)) {
      if (isProcessAlive(attempt.pid)) {
        throw new DuetError(
          `Attempt ${attempt.id} still has a live process.`,
          "LIVE_PROCESS",
        );
      }
      this.store.finishAttempt(
        attempt.id,
        "failed",
        { error: "Recovered after process exit." },
      );
    }
    for (const task of this.store.listTasks(runId)) {
      if (
        task.status === "revising" &&
        task.provider === "codex" &&
        task.worktreePath
      ) {
        const cached = this.store.getLatestArtifact(
          runId,
          task.id,
          `worker-${task.id}.${task.provider}.control`,
        );
        if (cached) {
          await preflightAndApplyPatch(
            task.worktreePath,
            extractMarkedPatch(cached),
            task.plan.allowedPaths,
            true,
          );
        }
      }
      if (
        [
          "leased",
          "implementing",
          "verifying",
          "reviewing",
          "revising",
        ].includes(task.status)
      ) {
        this.store.updateTask(runId, task.id, {
          status: "ready",
          error: null,
        });
      }
    }
    if (
      run.status === "integration_conflict" ||
      this.store
        .listTasks(runId)
        .some((task) => task.status === "conflict")
    ) {
      this.store.updateRun(runId, { status: "integration_conflict" });
      throw new DuetError(
        "Resolve the integration conflict before resuming.",
        "INTEGRATION_CONFLICT",
      );
    }
    if (run.status === "cancelled" || run.status === "merged") return run;
    return await this.execute(runId);
  }

  async retry(runId: string, taskId: string): Promise<RunRecord> {
    const task = this.store.getTask(runId, taskId);
    if (!["failed", "cancelled"].includes(task.status)) {
      throw new DuetError(
        `Task ${taskId} is not retryable from ${task.status}.`,
        "INVALID_TASK_STATE",
      );
    }
    this.store.clearTaskRecoveryOutputs(runId, taskId);
    this.store.updateTask(runId, taskId, {
      status: "ready",
      error: null,
      cancellationRequested: false,
      revisionCount: 0,
    });
    this.store.updateRun(runId, {
      status: "running",
      error: null,
      cancellationRequested: false,
    });
    return await this.execute(runId);
  }

  async cancel(runId: string, taskId?: string): Promise<RunRecord> {
    this.store.getRun(runId);
    if (taskId) {
      this.store.getTask(runId, taskId);
      this.store.updateTask(runId, taskId, {
        cancellationRequested: true,
        status: "cancelled",
      });
    } else {
      this.store.updateRun(runId, {
        cancellationRequested: true,
        status: "cancelled",
      });
      for (const task of this.store.listTasks(runId)) {
        if (!["integrated", "completed"].includes(task.status)) {
          this.store.updateTask(runId, task.id, {
            cancellationRequested: true,
            status: "cancelled",
          });
        }
      }
    }
    for (const attempt of this.store.listRunningAttempts(runId, taskId)) {
      terminateProcessTree(attempt.pid);
      this.store.finishAttempt(attempt.id, "cancelled", {
        error: "Cancellation requested.",
      });
    }
    return this.store.getRun(runId);
  }

  async cleanup(runId: string, force = false): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    for (const task of this.store.listTasks(runId)) {
      if (task.branch) {
        if (!task.branch.startsWith(`duet/${run.id}/task/`)) {
          throw new DuetError(
            `Refusing to remove unmanaged branch ${task.branch}.`,
            "UNSAFE_WORKTREE_PATH",
          );
        }
        await removeManagedWorktree(
          run.repoRoot,
          run.id,
          task.branch,
          task.id,
          force,
        );
        this.store.updateTask(runId, task.id, { worktreePath: null });
      }
    }
    if (run.integrationWorktreePath) {
      if (run.integrationBranch !== `duet/${run.id}/integration`) {
        throw new DuetError(
          `Refusing to remove unmanaged branch ${run.integrationBranch}.`,
          "UNSAFE_WORKTREE_PATH",
        );
      }
      await removeManagedWorktree(
        run.repoRoot,
        run.id,
        run.integrationBranch,
        undefined,
        force,
      );
      this.store.updateRun(runId, { integrationWorktreePath: null });
    }
    return this.store.getRun(runId);
  }

  async merge(runId: string): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    if (
      run.status !== "merge_approved" ||
      !this.store.isApproved(runId, "merge")
    ) {
      throw new DuetError(
        `Run ${runId} requires merge approval.`,
        "MERGE_NOT_APPROVED",
      );
    }
    const mergeBinding = approvalBinding(
      run,
      this.store.listTasks(runId),
      "merge",
    );
    const recordedMergeBinding = this.store.getApprovalBinding(runId, "merge");
    if (!recordedMergeBinding) {
      this.store.bindLegacyApproval(runId, "merge", mergeBinding);
    } else if (recordedMergeBinding !== mergeBinding) {
      throw new DuetError(
        "Merge approval no longer matches the reviewed state.",
        "APPROVAL_BINDING_MISMATCH",
      );
    }
    try {
      const head = await mergeRun(
        run.repoRoot,
        run.baseBranch,
        run.baseCommit,
        run.integrationBranch,
      );
      this.store.updateRun(runId, { status: "merged", finalCommit: head });
      await this.cleanup(runId, true);
      return this.store.getRun(runId);
    } catch (error) {
      this.failRun(runId, error);
      throw error;
    }
  }

  listConflicts(runId: string): TaskRecord[] {
    return this.store
      .listTasks(runId)
      .filter((task) => task.status === "conflict");
  }

  async resolve(runId: string, taskId: string): Promise<RunRecord> {
    const run = this.store.getRun(runId);
    const task = this.store.getTask(runId, taskId);
    if (
      run.status !== "integration_conflict" ||
      task.status !== "conflict" ||
      !run.integrationWorktreePath
    ) {
      throw new DuetError(
        "Run and task are not awaiting conflict resolution.",
        "INVALID_RUN_STATE",
      );
    }
    try {
      const unmerged = await listChanges(
        run.integrationWorktreePath,
        await currentHead(run.integrationWorktreePath),
        true,
      );
      if (unmerged.some((change) => change.status === "U")) {
        throw new DuetError(
          "Conflict still contains unmerged paths.",
          "UNRESOLVED_CONFLICT",
        );
      }
      const base = await currentHead(run.integrationWorktreePath);
      const artifact = await stageCandidate(
        run.integrationWorktreePath,
        base,
        task.plan.allowedPaths,
      );
      const config = parseConfig(run);
      const verification = await this.verify(run, task, artifact, config);
      let review = await this.review(
        run,
        task,
        artifact,
        verification,
        config,
        {
          worktree: run.integrationWorktreePath,
          role: `resolver-${task.id}-${task.revisionCount}`,
          useCache: false,
        },
      );
      review = verificationReview(review, verification);
      if (
        review.verdict !== "approve" ||
        !allVerificationPassed(verification)
      ) {
        this.store.updateTask(runId, taskId, {
          status: "conflict",
          review,
          error: "Resolved candidate did not pass review.",
        });
        return this.store.getRun(runId);
      }
      const commit = await commitReviewedTree(
        run.integrationWorktreePath,
        base,
        `duet: resolve ${task.plan.title}`,
        task.plan.allowedPaths,
        artifact,
      );
      this.store.updateTask(runId, taskId, {
        review,
        reviewedArtifact: artifact,
      });
      const integrated = await commitArtifact(
        run.integrationWorktreePath,
        base,
        commit,
      );
      this.store.recordIntegration({
        runId,
        taskId,
        sourceCommit: task.taskCommit ?? commit,
        resultingCommit: commit,
        treeId: integrated.treeId,
        patchHash: integrated.diffHash,
      });
    } catch (error) {
      this.store.updateTask(runId, taskId, {
        status: "conflict",
        error: error instanceof Error ? error.message : String(error),
      });
      if (!(error instanceof DuetError && error.code === "BUDGET_PAUSED")) {
        this.store.updateRun(runId, {
          status: "integration_conflict",
          error: `Integration conflict in task ${taskId} remains unresolved.`,
        });
      }
      throw error;
    }
    this.store.updateRun(runId, { status: "running", error: null });
    return await this.execute(runId);
  }

  private async schedule(runId: string, owner: string): Promise<RunRecord> {
    let run = this.store.getRun(runId);
    const config = parseConfig(run);
    if (!run.integrationWorktreePath) {
      const integration = await createManagedWorktree(
        run.repoRoot,
        run.id,
        run.integrationBranch,
        run.baseCommit,
      );
      this.store.updateRun(runId, {
        integrationWorktreePath: integration,
        status: "running",
      });
      run = this.store.getRun(runId);
    } else {
      this.store.updateRun(runId, { status: "running", error: null });
    }

    while (true) {
      run = this.store.getRun(runId);
      if (run.cancellationRequested) {
        this.store.updateRun(runId, { status: "cancelled" });
        return this.store.getRun(runId);
      }
      await this.integrateCompleted(run);
      if (this.store.getRun(runId).status === "integration_conflict") {
        return this.store.getRun(runId);
      }

      const tasks = this.refreshTaskReadiness(runId);
      if (tasks.every((task) => task.status === "integrated")) {
        this.store.updateRun(runId, {
          status: "awaiting_merge_approval",
          finalCommit: run.integrationWorktreePath
            ? await currentHead(run.integrationWorktreePath)
            : undefined,
        });
        return this.store.getRun(runId);
      }

      const ready = tasks.filter((task) => task.status === "ready");
      const slots = Math.min(
        config.orchestration.maxParallelTasks,
        Math.max(
          0,
          config.budgets.maxAgentTurns -
            this.store.getUsageSummary(runId).totalTurns,
        ),
      );
      const selected: TaskRecord[] = [];
      const providers = new Set<ProviderName>();
      for (const task of ready) {
        if (selected.length >= slots) break;
        if (!providers.has(task.provider)) {
          selected.push(task);
          providers.add(task.provider);
        }
      }
      if (selected.length === 0) {
        this.assertBudget(run, config);
        const failed = tasks.filter((task) =>
          ["failed", "cancelled"].includes(task.status),
        );
        this.store.updateRun(runId, {
          status: failed.length > 0 ? "needs_attention" : "failed",
          error:
            failed.length > 0
              ? `Tasks require attention: ${failed.map((item) => item.id).join(", ")}`
              : "No runnable tasks remain.",
        });
        return this.store.getRun(runId);
      }

      const waveBase = await currentHead(run.integrationWorktreePath!);
      await Promise.allSettled(
        selected.map((task) =>
          this.executeTask(run, task, config, waveBase, owner),
        ),
      );
      const afterWave = this.store.getRun(runId);
      if (
        ["paused_budget", "failed", "cancelled"].includes(afterWave.status)
      ) {
        return afterWave;
      }
    }
  }

  private refreshTaskReadiness(runId: string): TaskRecord[] {
    const tasks = this.store.listTasks(runId);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (!["pending", "blocked", "ready"].includes(task.status)) continue;
      const dependencies = task.plan.dependencies.map((id) => byId.get(id)!);
      const failedDependency = dependencies.some((dependency) =>
        ["failed", "cancelled", "conflict"].includes(dependency.status),
      );
      const ready = dependencies.every(
        (dependency) => dependency.status === "integrated",
      );
      const status = failedDependency ? "blocked" : ready ? "ready" : "blocked";
      if (task.status !== status) {
        this.store.updateTask(runId, task.id, { status });
      }
    }
    return this.store.listTasks(runId);
  }

  private async executeTask(
    run: RunRecord,
    originalTask: TaskRecord,
    config: DuetConfig,
    waveBase: string,
    runOwner: string,
  ): Promise<void> {
    const resourceId = `${run.id}:${originalTask.id}`;
    if (
      !this.store.acquireLease(
        "task",
        resourceId,
        runOwner,
        leaseTtlMs,
      )
    ) {
      throw new DuetError(
        `Task ${originalTask.id} has a live lease.`,
        "LIVE_LEASE",
      );
    }
    const branch =
      originalTask.branch ?? `duet/${run.id}/task/${originalTask.id}`;
    const worktree =
      originalTask.worktreePath ??
      (await createManagedWorktree(
        run.repoRoot,
        run.id,
        branch,
        waveBase,
        originalTask.id,
      ));
    this.store.acquireLease("worktree", resourceId, runOwner, leaseTtlMs);
    this.store.updateTask(run.id, originalTask.id, {
      status: "implementing",
      branch,
      worktreePath: worktree,
      baseCommit: originalTask.baseCommit ?? waveBase,
      error: null,
    });
    const heartbeat = setInterval(() => {
      this.store.renewLease("task", resourceId, runOwner, leaseTtlMs);
      this.store.renewLease("worktree", resourceId, runOwner, leaseTtlMs);
    }, leaseHeartbeatMs);

    try {
      let task = this.store.getTask(run.id, originalTask.id);
      const existingHead = await currentHead(worktree);
      if (
        existingHead !== task.baseCommit &&
        task.reviewedArtifact
      ) {
        const committed = await commitArtifact(
          worktree,
          task.baseCommit!,
          existingHead,
        );
        assertAllowedChanges(
          await listChanges(worktree, task.baseCommit!),
          task.plan.allowedPaths,
        );
        if (
          committed.treeId === task.reviewedArtifact.treeId &&
          committed.diffHash === task.reviewedArtifact.diffHash
        ) {
          this.store.updateTask(run.id, task.id, {
            status: "completed",
            taskCommit: existingHead,
          });
          return;
        }
        throw new DuetError(
          `Existing commit for ${task.id} differs from its reviewed artifact.`,
          "COMMIT_INTEGRITY_FAILURE",
        );
      }
      let artifact;
      try {
        artifact = await stageCandidate(
          worktree,
          task.baseCommit!,
          task.plan.allowedPaths,
        );
      } catch (error) {
        if (!(error instanceof DuetError) || error.code !== "NO_CHANGES") {
          throw error;
        }
        await this.implement(run, task, config);
        task = this.store.getTask(run.id, task.id);
        artifact = await stageCandidate(
          worktree,
          task.baseCommit!,
          task.plan.allowedPaths,
        );
      }

      while (true) {
        this.store.updateTask(run.id, task.id, {
          status: "verifying",
          reviewedArtifact: artifact,
        });
        const verification = await this.verify(run, task, artifact, config);
        let review = await this.review(
          run,
          task,
          artifact,
          verification,
          config,
        );
        review = verificationReview(review, verification);
        this.store.updateTask(run.id, task.id, { review });
        if (
          review.verdict === "approve" &&
          allVerificationPassed(verification)
        ) {
          const commit = await commitReviewedTree(
            worktree,
            task.baseCommit!,
            `duet: ${task.plan.title}`,
            task.plan.allowedPaths,
            artifact,
          );
          this.store.updateTask(run.id, task.id, {
            status: "completed",
            taskCommit: commit,
            reviewedArtifact: artifact,
            review,
          });
          return;
        }
        if (task.revisionCount >= config.orchestration.maxRevisions) {
          this.store.updateTask(run.id, task.id, {
            status: "failed",
            review,
            error: "Review or verification still requires attention.",
          });
          return;
        }
        const nextRevision = task.revisionCount + 1;
        this.store.updateTask(run.id, task.id, {
          status: "revising",
          revisionCount: nextRevision,
        });
        task = this.store.getTask(run.id, task.id);
        await this.revise(run, task, review, config);
        artifact = await stageCandidate(
          worktree,
          task.baseCommit!,
          task.plan.allowedPaths,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof DuetError && error.code === "BUDGET_PAUSED") {
        this.store.updateTask(run.id, originalTask.id, {
          status: "ready",
          error: null,
        });
        throw error;
      }
      const cancelled =
        this.store.getRun(run.id).cancellationRequested ||
        this.store.getTask(run.id, originalTask.id).cancellationRequested;
      this.store.updateTask(run.id, originalTask.id, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "Cancellation requested." : message,
      });
      if (
        error instanceof DuetError &&
        [
          "REVIEWED_ARTIFACT_MISMATCH",
          "COMMIT_INTEGRITY_FAILURE",
          "READ_ONLY_VIOLATION",
        ].includes(error.code)
      ) {
        this.store.updateRun(run.id, { status: "failed", error: message });
      }
    } finally {
      clearInterval(heartbeat);
      this.store.releaseLease("task", resourceId, runOwner);
      this.store.releaseLease("worktree", resourceId, runOwner);
    }
  }

  private async implement(
    run: RunRecord,
    task: TaskRecord,
    config: DuetConfig,
  ): Promise<void> {
    const patchOnly = task.provider === "codex";
    const cached = this.store.getLatestArtifact(
      run.id,
      task.id,
      `worker-${task.id}.${task.provider}.control`,
    );
    if (patchOnly && cached) {
      await preflightAndApplyPatch(
        task.worktreePath!,
        extractMarkedPatch(cached),
        task.plan.allowedPaths,
      );
      return;
    }
    const before = patchOnly
      ? await fingerprintRepository(task.worktreePath!)
      : undefined;
    let result: AgentResult;
    try {
      result = await this.runAgent(
        run,
        task,
        `worker-${task.id}`,
        task.provider,
        {
          cwd: task.worktreePath!,
          prompt: implementationPrompt(run, task.plan, patchOnly),
          mode: patchOnly ? "read-only" : "workspace-write",
          timeoutMs: config.orchestration.agentTimeoutSeconds * 1_000,
        },
      );
    } finally {
      if (before) {
        const after = await fingerprintRepository(task.worktreePath!);
        assertFingerprintUnchanged(before, after);
      }
    }
    this.store.updateTask(run.id, task.id, {
      sessionId: result.sessionId,
    });
    if (patchOnly) {
      await preflightAndApplyPatch(
        task.worktreePath!,
        extractMarkedPatch(result.finalText),
        task.plan.allowedPaths,
      );
    } else {
      const changes = await listChanges(
        task.worktreePath!,
        task.baseCommit!,
      );
      if (changes.length === 0 && result.finalText.includes("DUET_PATCH_BEGIN")) {
        await preflightAndApplyPatch(
          task.worktreePath!,
          extractMarkedPatch(result.finalText),
          task.plan.allowedPaths,
        );
      }
    }
  }

  private async revise(
    run: RunRecord,
    task: TaskRecord,
    review: ReviewResult,
    config: DuetConfig,
  ): Promise<void> {
    const patchOnly = task.provider === "codex";
    const before = patchOnly
      ? await fingerprintRepository(task.worktreePath!)
      : undefined;
    let result: AgentResult;
    try {
      result = await this.runAgent(
        run,
        task,
        `worker-${task.id}`,
        task.provider,
        {
          cwd: task.worktreePath!,
          prompt: revisionPrompt(review, task.plan, patchOnly),
          mode: patchOnly ? "read-only" : "workspace-write",
          timeoutMs: config.orchestration.agentTimeoutSeconds * 1_000,
          sessionId: task.sessionId,
        },
      );
    } finally {
      if (before) {
        const after = await fingerprintRepository(task.worktreePath!);
        assertFingerprintUnchanged(before, after);
      }
    }
    this.store.updateTask(run.id, task.id, {
      sessionId: result.sessionId,
    });
    if (patchOnly) {
      await preflightAndApplyPatch(
        task.worktreePath!,
        extractMarkedPatch(result.finalText),
        task.plan.allowedPaths,
      );
    }
  }

  private async verify(
    run: RunRecord,
    task: TaskRecord,
    artifact: { treeId: string },
    config: DuetConfig,
  ): Promise<VerificationResult[]> {
    const results = await runVerification({
      repoRoot: run.repoRoot,
      treeId: artifact.treeId,
      runId: run.id,
      taskId: task.id,
      attempt: task.revisionCount,
      config,
      shouldCancel: () =>
        this.store.getRun(run.id).cancellationRequested ||
        this.store.getTask(run.id, task.id).cancellationRequested,
    });
    for (const result of results) {
      this.store.recordVerification(
        run.id,
        task.id,
        task.revisionCount,
        result,
      );
    }
    return results;
  }

  private async review(
    run: RunRecord,
    task: TaskRecord,
    artifact: {
      diff: string;
      changedPaths: string[];
    },
    verification: VerificationResult[],
    config: DuetConfig,
    options: {
      worktree?: string;
      role?: string;
      useCache?: boolean;
    } = {},
  ): Promise<ReviewResult> {
    if (artifact.diff.length > maxReviewDiffCharacters) {
      throw new DuetError(
        `Diff is too large for review (${artifact.diff.length} characters).`,
        "DIFF_TOO_LARGE",
      );
    }
    this.store.updateTask(run.id, task.id, { status: "reviewing" });
    const role =
      options.role ?? `reviewer-${task.id}-${task.revisionCount}`;
    const worktree = options.worktree ?? task.worktreePath!;
    const cached =
      options.useCache === false
        ? undefined
        : this.store.getLatestArtifact(
            run.id,
            task.id,
            `${role}.${task.reviewerProvider}.control`,
          );
    if (cached) {
      return validateReview(extractMarkedJson<ReviewResult>(cached));
    }
    const before = await fingerprintRepository(worktree);
    let result: AgentResult;
    try {
      result = await this.runAgent(
        run,
        task,
        role,
        task.reviewerProvider,
        {
          cwd: worktree,
          prompt: reviewPrompt(
            run,
            task.plan,
            artifact.changedPaths,
            artifact.diff,
            verification,
          ),
          mode: "read-only",
          timeoutMs: config.orchestration.agentTimeoutSeconds * 1_000,
        },
      );
    } finally {
      const after = await fingerprintRepository(worktree);
      assertFingerprintUnchanged(before, after);
    }
    const review = validateReview(
      extractMarkedJson<ReviewResult>(result.finalText),
    );
    this.store.addMessage(
      run.id,
      `review-${task.revisionCount}`,
      JSON.stringify(review),
      task.reviewerProvider,
      task.id,
    );
    return review;
  }

  private async integrateCompleted(run: RunRecord): Promise<void> {
    if (!run.integrationWorktreePath) return;
    const tasks = this.store
      .listTasks(run.id)
      .filter((task) => task.status === "completed")
      .sort((left, right) =>
        left.ordinal === right.ordinal
          ? left.id.localeCompare(right.id)
          : left.ordinal - right.ordinal,
      );
    for (const task of tasks) {
      if (
        !task.taskCommit ||
        !task.baseCommit ||
        !task.reviewedArtifact ||
        !task.worktreePath
      ) {
        throw new DuetError(
          `Task ${task.id} lacks reviewed commit metadata.`,
          "COMMIT_INTEGRITY_FAILURE",
        );
      }
      const source = await commitArtifact(
        task.worktreePath,
        task.baseCommit,
        task.taskCommit,
      );
      assertAllowedChanges(
        await listChanges(task.worktreePath, task.baseCommit),
        task.plan.allowedPaths,
      );
      if (
        source.treeId !== task.reviewedArtifact.treeId ||
        source.diffHash !== task.reviewedArtifact.diffHash
      ) {
        throw new DuetError(
          `Task ${task.id} commit no longer matches review.`,
          "COMMIT_INTEGRITY_FAILURE",
        );
      }
      const parent = await currentHead(run.integrationWorktreePath);
      if (parent !== run.baseCommit) {
        const currentPatch = await commitArtifact(
          run.integrationWorktreePath,
          `${parent}^`,
          parent,
        );
        if (currentPatch.diffHash === task.reviewedArtifact.diffHash) {
          this.store.recordIntegration({
            runId: run.id,
            taskId: task.id,
            sourceCommit: task.taskCommit,
            resultingCommit: parent,
            treeId: currentPatch.treeId,
            patchHash: currentPatch.diffHash,
          });
          continue;
        }
      }
      const picked = await cherryPickTask(
        run.integrationWorktreePath,
        task.taskCommit,
      );
      if (picked.conflict) {
        this.store.updateTask(run.id, task.id, {
          status: "conflict",
          error: "Cherry-pick conflict requires human resolution.",
        });
        this.store.updateRun(run.id, {
          status: "integration_conflict",
          error: `Integration conflict in task ${task.id}.`,
        });
        return;
      }
      const integrated = await commitArtifact(
        run.integrationWorktreePath,
        parent,
        picked.commit,
      );
      assertAllowedChanges(
        await listChanges(run.integrationWorktreePath, parent),
        task.plan.allowedPaths,
      );
      if (integrated.diffHash !== task.reviewedArtifact.diffHash) {
        throw new DuetError(
          `Integrated patch for ${task.id} differs from review.`,
          "COMMIT_INTEGRITY_FAILURE",
        );
      }
      this.store.recordIntegration({
        runId: run.id,
        taskId: task.id,
        sourceCommit: task.taskCommit,
        resultingCommit: picked.commit,
        treeId: integrated.treeId,
        patchHash: integrated.diffHash,
      });
    }
  }

  private async runAgent(
    run: RunRecord,
    task: TaskRecord | undefined,
    role: string,
    provider: ProviderName,
    turn: Omit<AgentTurn, "maxBudgetUsd">,
  ): Promise<AgentResult> {
    const config = parseConfig(run);
    this.assertBudget(this.store.getRun(run.id), config, provider);
    const providerResource = `${run.id}:provider:${provider}`;
    const providerOwner = ownerId();
    while (
      !this.store.acquireLease(
        "task",
        providerResource,
        providerOwner,
        leaseTtlMs,
      )
    ) {
      if (
        this.store.getRun(run.id).cancellationRequested ||
        (task
          ? this.store.getTask(run.id, task.id).cancellationRequested
          : false)
      ) {
        throw new DuetError("Agent turn cancelled.", "CANCELLED");
      }
      await delay(100);
    }
    const providerHeartbeat = setInterval(() => {
      this.store.renewLease(
        "task",
        providerResource,
        providerOwner,
        leaseTtlMs,
      );
    }, leaseHeartbeatMs);
    const attempt = this.store.reserveAgentAttempt({
      runId: run.id,
      taskId: task?.id,
      role,
      provider,
      checkpoint: "agent_starting",
      maxAgentTurns: config.budgets.maxAgentTurns,
    });
    if (attempt === undefined) {
      clearInterval(providerHeartbeat);
      this.store.releaseLease("task", providerResource, providerOwner);
      this.store.updateRun(run.id, {
        status: "paused_budget",
        error: "Aggregate provider or runtime budget reached.",
      });
      throw new DuetError(
        "Aggregate provider or runtime budget reached.",
        "BUDGET_PAUSED",
      );
    }
    let stdoutWrites = Promise.resolve();
    let stderrWrites = Promise.resolve();
    let outputError: unknown;
    try {
      const outputDirectory = path.join(
        artifactsRoot(),
        run.id,
        task?.id ?? "run",
      );
      mkdirSync(outputDirectory, { recursive: true });
      const stdoutPath = path.join(outputDirectory, `${attempt}.stdout.log`);
      const stderrPath = path.join(outputDirectory, `${attempt}.stderr.log`);
      await Promise.all([
        writeFile(stdoutPath, "", "utf8"),
        writeFile(stderrPath, "", "utf8"),
      ]);
      this.store.addFileArtifact(
        run.id,
        `${role}.${provider}.raw.stdout`,
        stdoutPath,
        task?.id,
      );
      this.store.addFileArtifact(
        run.id,
        `${role}.${provider}.raw.stderr`,
        stderrPath,
        task?.id,
      );
      const result = await this.adapters(provider).run({
        ...turn,
        maxBudgetUsd:
          provider === "claude"
            ? config.budgets.claudeMaxUsdPerTurn
            : undefined,
        onStart: (pid) =>
          this.store.updateAttemptProcess(attempt, { pid }),
        onStdout: (chunk) => {
          stdoutWrites = stdoutWrites
            .then(() => appendFile(stdoutPath, chunk, "utf8"))
            .catch((error: unknown) => {
              outputError ??= error;
            });
          this.store.updateAttemptProcess(attempt, { heartbeat: true });
        },
        onStderr: (chunk) => {
          stderrWrites = stderrWrites
            .then(() => appendFile(stderrPath, chunk, "utf8"))
            .catch((error: unknown) => {
              outputError ??= error;
            });
          this.store.updateAttemptProcess(attempt, { heartbeat: true });
        },
        onHeartbeat: () =>
          this.store.updateAttemptProcess(attempt, { heartbeat: true }),
        shouldCancel: () =>
          this.store.getRun(run.id).cancellationRequested ||
          (task
            ? this.store.getTask(run.id, task.id).cancellationRequested
            : false),
      });
      await Promise.all([stdoutWrites, stderrWrites]);
      if (outputError) {
        throw new DuetError(
          `Could not persist provider output: ${
            outputError instanceof Error
              ? outputError.message
              : String(outputError)
          }`,
          "ARTIFACT_WRITE_FAILED",
        );
      }
      this.store.recordAgentResult(
        run.id,
        task?.id,
        role,
        result,
        attempt,
      );
      return result;
    } catch (error) {
      await Promise.allSettled([stdoutWrites, stderrWrites]);
      this.store.finishAttempt(attempt, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearInterval(providerHeartbeat);
      this.store.releaseLease("task", providerResource, providerOwner);
    }
  }

  private assertBudget(
    run: RunRecord,
    config: DuetConfig,
    provider?: ProviderName,
  ): void {
    const usage = this.store.getUsageSummary(run.id);
    const wallMs = Date.now() - Date.parse(run.createdAt);
    const exhausted =
      wallMs >= config.budgets.runWallClockSeconds * 1_000 ||
      usage.totalTurns >= config.budgets.maxAgentTurns ||
      (provider === "claude" &&
        usage.claude.costUsd >= config.budgets.claudeMaxUsdPerRun) ||
      (provider === "codex" &&
        (usage.codex.inputTokens >= config.budgets.codexMaxInputTokens ||
          usage.codex.outputTokens >= config.budgets.codexMaxOutputTokens));
    if (exhausted) {
      this.store.updateRun(run.id, {
        status: "paused_budget",
        error: "Aggregate provider or runtime budget reached.",
      });
      throw new DuetError(
        "Aggregate provider or runtime budget reached.",
        "BUDGET_PAUSED",
      );
    }
  }

  private failRun(runId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.store.updateRun(runId, { status: "failed", error: message });
  }
}
