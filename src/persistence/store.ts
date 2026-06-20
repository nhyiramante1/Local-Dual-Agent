import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

import type {
  AgentProfile,
  AgentResult,
  ArtifactRecord,
  ConversationRecord,
  ConversationStatus,
  ConversationTurnRecord,
  DuetEvent,
  LeaseRecord,
  ManagerActionProposal,
  ManagerProviderName,
  OperationRecord,
  OperationStatus,
  ProposalAction,
  ProposalStatus,
  ProposalTier,
  ProviderName,
  ReviewResult,
  ReviewedArtifact,
  RunPlan,
  RunRecord,
  RunStatus,
  TaskRecord,
  TaskStatus,
  TurnRole,
  TurnStatus,
  UsageSummary,
  VerificationResult,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { stateDatabasePath } from "../paths.js";

interface RunRow {
  id: string;
  repo_path: string;
  repo_root: string;
  goal: string;
  status: RunStatus;
  lead_provider: ProviderName;
  base_branch: string;
  base_commit: string;
  integration_branch: string;
  integration_worktree_path: string | null;
  worktree_path: string | null;
  plan_json: string | null;
  final_commit: string | null;
  error: string | null;
  config_json: string;
  profile: string;
  cancellation_requested: number;
  created_at: string;
  updated_at: string;
  version: number;
}

interface TaskRow {
  run_id: string;
  id: string;
  ordinal: number;
  plan_json: string;
  status: TaskStatus;
  provider: ProviderName;
  reviewer_provider: ProviderName;
  base_commit: string | null;
  branch: string | null;
  worktree_path: string | null;
  session_id: string | null;
  revision_count: number;
  review_json: string | null;
  reviewed_artifact_json: string | null;
  task_commit: string | null;
  integrated_commit: string | null;
  error: string | null;
  cancellation_requested: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface AttemptRecord {
  id: number;
  runId: string;
  taskId?: string;
  role: string;
  provider?: ProviderName;
  status: "running" | "completed" | "failed" | "cancelled";
  pid?: number;
  sessionId?: string;
  checkpoint: string;
  stdout: string;
  stderr: string;
  startedAt: string;
  heartbeatAt: string;
  finishedAt?: string;
  error?: string;
}

function now(): string {
  return new Date().toISOString();
}

function capText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function capWithMeta(
  value: string,
  max: number,
): { text: string; truncated: boolean; originalLength: number } {
  const truncated = value.length > max;
  return {
    text: truncated ? value.slice(0, max) : value,
    truncated,
    originalLength: value.length,
  };
}

function opposite(provider: ProviderName): ProviderName {
  return provider === "claude" ? "codex" : "claude";
}

const VALID_PROPOSAL_ACTIONS = new Set<string>([
  "execute_run",
  "resume_run",
  "retry_task",
  "resolve_task",
  "cancel_run",
  "cancel_task",
  "cleanup_run",
  "approve_plan",
  "approve_merge",
  "merge_run",
]);

const VALID_PROPOSAL_TIERS = new Set<string>(["ordinary", "fingerprint"]);

export class Store {
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(databasePath = stateDatabasePath()) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(action: () => T): T {
    if (this.transactionDepth > 0) return action();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    return rows.some((row) => row.name === column);
  }

  private addColumn(table: string, definition: string): void {
    const column = definition.split(/\s+/)[0];
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  }

  private migrate(): void {
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          repo_path TEXT NOT NULL,
          repo_root TEXT NOT NULL,
          goal TEXT NOT NULL,
          status TEXT NOT NULL,
          lead_provider TEXT NOT NULL,
          worker_provider TEXT NOT NULL,
          base_branch TEXT NOT NULL,
          base_commit TEXT NOT NULL,
          integration_branch TEXT NOT NULL,
          worktree_path TEXT,
          plan_json TEXT,
          review_json TEXT,
          revision_count INTEGER NOT NULL DEFAULT 0,
          final_commit TEXT,
          error TEXT,
          config_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          provider TEXT NOT NULL,
          role TEXT NOT NULL,
          external_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          kind TEXT NOT NULL,
          provider TEXT,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          kind TEXT NOT NULL,
          path TEXT,
          content TEXT,
          sha256 TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          provider TEXT NOT NULL,
          role TEXT NOT NULL,
          input_tokens INTEGER,
          cached_input_tokens INTEGER,
          output_tokens INTEGER,
          reasoning_output_tokens INTEGER,
          cost_usd REAL,
          cost_known INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS approvals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          stage TEXT NOT NULL,
          approved_at TEXT NOT NULL,
          UNIQUE(run_id, stage)
        );

        CREATE TABLE IF NOT EXISTS verification_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          attempt INTEGER NOT NULL,
          command_json TEXT NOT NULL,
          exit_code INTEGER,
          stdout TEXT NOT NULL,
          stderr TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          passed INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          plan_json TEXT NOT NULL,
          status TEXT NOT NULL,
          provider TEXT NOT NULL,
          reviewer_provider TEXT NOT NULL,
          base_commit TEXT,
          branch TEXT,
          worktree_path TEXT,
          session_id TEXT,
          revision_count INTEGER NOT NULL DEFAULT 0,
          review_json TEXT,
          reviewed_artifact_json TEXT,
          task_commit TEXT,
          integrated_commit TEXT,
          error TEXT,
          cancellation_requested INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(run_id, id)
        );

        CREATE TABLE IF NOT EXISTS attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          role TEXT NOT NULL,
          provider TEXT,
          status TEXT NOT NULL,
          pid INTEGER,
          session_id TEXT,
          checkpoint TEXT NOT NULL,
          stdout TEXT NOT NULL DEFAULT '',
          stderr TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS leases (
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          owner TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          PRIMARY KEY(resource_type, resource_id)
        );

        CREATE TABLE IF NOT EXISTS integration_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT NOT NULL,
          source_commit TEXT NOT NULL,
          resulting_commit TEXT NOT NULL,
          tree_id TEXT NOT NULL,
          patch_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          service_instance_id TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          result_json TEXT,
          error_json TEXT,
          started_at TEXT,
          heartbeat_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          severity TEXT NOT NULL,
          run_id TEXT,
          task_id TEXT,
          operation_id TEXT,
          payload_json TEXT NOT NULL,
          occurred_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_idempotency (
          client_id TEXT NOT NULL,
          method TEXT NOT NULL,
          route TEXT NOT NULL,
          key TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          response_json TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(client_id, method, route, key)
        );

        CREATE TABLE IF NOT EXISTS action_tickets (
          token_hash TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          binding_hash TEXT NOT NULL,
          run_version INTEGER NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_run_status
          ON tasks(run_id, status, ordinal);
        CREATE INDEX IF NOT EXISTS idx_attempts_run_status
          ON attempts(run_id, status);
        CREATE INDEX IF NOT EXISTS idx_usage_run_provider
          ON usage_events(run_id, provider);
        CREATE INDEX IF NOT EXISTS idx_events_run_seq
          ON events(run_id, seq);
        CREATE INDEX IF NOT EXISTS idx_operations_run_status
          ON operations(run_id, status);
        CREATE INDEX IF NOT EXISTS idx_action_tickets_expiry
          ON action_tickets(expires_at);

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          interface_agent TEXT NOT NULL DEFAULT 'codex',
          title TEXT,
          summary TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_turns (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL
            REFERENCES conversations(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL,
          interface_agent TEXT,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ok',
          error_json TEXT,
          provider_session_id TEXT,
          usage_json TEXT,
          operation_id TEXT,
          truncated INTEGER NOT NULL DEFAULT 0,
          original_length INTEGER,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversation_turns_seq
          ON conversation_turns(conversation_id, seq);

        CREATE TABLE IF NOT EXISTS manager_action_proposals (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL
            REFERENCES conversations(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL
            REFERENCES conversation_turns(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
          task_id TEXT,
          action TEXT NOT NULL,
          summary TEXT NOT NULL,
          command_cli TEXT NOT NULL,
          command_json TEXT NOT NULL,
          tier TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'proposed',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_proposals_conversation_status
          ON manager_action_proposals(conversation_id, status);
      `);

      this.addColumn(
        "runs",
        "integration_worktree_path TEXT",
      );
      this.addColumn(
        "runs",
        "cancellation_requested INTEGER NOT NULL DEFAULT 0",
      );
      this.addColumn("agent_sessions", "task_id TEXT");
      this.addColumn("messages", "task_id TEXT");
      this.addColumn("artifacts", "task_id TEXT");
      this.addColumn("artifacts", "sha256 TEXT");
      this.addColumn("usage_events", "task_id TEXT");
      this.addColumn(
        "usage_events",
        "cost_known INTEGER NOT NULL DEFAULT 0",
      );
      this.addColumn("verification_results", "task_id TEXT");
      this.addColumn("runs", "version INTEGER NOT NULL DEFAULT 1");
      this.addColumn("tasks", "version INTEGER NOT NULL DEFAULT 1");
      this.addColumn("approvals", "binding_hash TEXT");
      this.addColumn("approvals", "actor TEXT NOT NULL DEFAULT 'local-human'");
      this.addColumn(
        "conversation_turns",
        "truncated INTEGER NOT NULL DEFAULT 0",
      );
      this.addColumn("conversation_turns", "original_length INTEGER");
      this.addColumn(
        "runs",
        "profile TEXT NOT NULL DEFAULT 'balanced'",
      );
      this.db.exec("PRAGMA user_version = 5");
    });

    this.transaction(() => {
      const version = (
        this.db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      if (version < 6) {
        this.addColumn("manager_action_proposals", "operation_id TEXT");
        this.db.exec("PRAGMA user_version = 6");
      }
    });
  }

  private appendEvent(options: {
    type: string;
    severity?: DuetEvent["severity"];
    runId?: string;
    taskId?: string;
    operationId?: string;
    payload?: unknown;
  }): void {
    this.db
      .prepare(`
        INSERT INTO events (
          id, type, severity, run_id, task_id, operation_id,
          payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        options.type,
        options.severity ?? "info",
        options.runId ?? null,
        options.taskId ?? null,
        options.operationId ?? null,
        JSON.stringify(options.payload ?? {}),
        now(),
      );
  }

  createRun(run: RunRecord, tasks: TaskRecord[] = []): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO runs (
            id, repo_path, repo_root, goal, status, lead_provider,
            worker_provider, base_branch, base_commit, integration_branch,
            worktree_path, integration_worktree_path, plan_json, review_json,
            revision_count, final_commit, error, config_json, profile,
            cancellation_requested, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          run.id,
          run.repoPath,
          run.repoRoot,
          run.goal,
          run.status,
          run.leadProvider,
          opposite(run.leadProvider),
          run.baseBranch,
          run.baseCommit,
          run.integrationBranch,
          run.integrationWorktreePath ?? null,
          run.integrationWorktreePath ?? null,
          run.plan ? JSON.stringify(run.plan) : null,
          null,
          0,
          run.finalCommit ?? null,
          run.error ?? null,
          run.configJson,
          run.profile ?? "balanced",
          run.cancellationRequested ? 1 : 0,
          run.createdAt,
          run.updatedAt,
        );
      for (const task of tasks) this.insertTask(task);
      this.appendEvent({
        type: "run.created",
        runId: run.id,
        payload: { status: run.status, goal: run.goal },
      });
    });
  }

  replacePlan(runId: string, plan: RunPlan, tasks: TaskRecord[]): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM tasks WHERE run_id = ?").run(runId);
      for (const task of tasks) this.insertTask(task);
      this.db
        .prepare(
          "UPDATE runs SET plan_json = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          JSON.stringify(plan),
          "awaiting_plan_approval",
          now(),
          runId,
        );
      this.appendEvent({
        type: "run.plan_ready",
        runId,
        payload: { taskCount: tasks.length },
      });
    });
  }

  private insertTask(task: TaskRecord): void {
    this.db
      .prepare(`
        INSERT INTO tasks (
          run_id, id, ordinal, plan_json, status, provider, reviewer_provider,
          base_commit, branch, worktree_path, session_id, revision_count,
          review_json, reviewed_artifact_json, task_commit, integrated_commit,
          error, cancellation_requested, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.runId,
        task.id,
        task.ordinal,
        JSON.stringify(task.plan),
        task.status,
        task.provider,
        task.reviewerProvider,
        task.baseCommit ?? null,
        task.branch ?? null,
        task.worktreePath ?? null,
        task.sessionId ?? null,
        task.revisionCount,
        task.review ? JSON.stringify(task.review) : null,
        task.reviewedArtifact
          ? JSON.stringify(task.reviewedArtifact)
          : null,
        task.taskCommit ?? null,
        task.integratedCommit ?? null,
        task.error ?? null,
        task.cancellationRequested ? 1 : 0,
        task.createdAt,
        task.updatedAt,
      );
  }

  getRun(id: string): RunRecord {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as unknown as RunRow | undefined;
    if (!row) throw new DuetError(`Unknown run: ${id}`, "RUN_NOT_FOUND");
    return this.mapRun(row);
  }

  listRuns(): RunRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM runs ORDER BY created_at DESC")
        .all() as unknown as RunRow[]
    ).map((row) => this.mapRun(row));
  }

  updateRun(
    id: string,
    fields: Partial<{
      status: RunStatus;
      integrationWorktreePath: string | null;
      plan: RunPlan;
      finalCommit: string;
      error: string | null;
      cancellationRequested: boolean;
      configJson: string;
    }>,
    expectedVersion?: number,
  ): void {
    this.transaction(() => {
    const current = this.getRun(id);
    if (
      expectedVersion !== undefined &&
      (current.version ?? 1) !== expectedVersion
    ) {
      throw new DuetError("Run version changed.", "VERSION_CONFLICT");
    }
    const entries: Array<[string, string | number | null]> = [];
    if (fields.status !== undefined) entries.push(["status", fields.status]);
    if (fields.integrationWorktreePath !== undefined) {
      entries.push([
        "integration_worktree_path",
        fields.integrationWorktreePath,
      ]);
      entries.push(["worktree_path", fields.integrationWorktreePath]);
    }
    if (fields.plan !== undefined) {
      entries.push(["plan_json", JSON.stringify(fields.plan)]);
    }
    if (fields.finalCommit !== undefined) {
      entries.push(["final_commit", fields.finalCommit]);
    }
    if (fields.error !== undefined) entries.push(["error", fields.error]);
    if (fields.cancellationRequested !== undefined) {
      entries.push([
        "cancellation_requested",
        fields.cancellationRequested ? 1 : 0,
      ]);
    }
    if (fields.configJson !== undefined) {
      entries.push(["config_json", fields.configJson]);
    }
    entries.push(["version", (current.version ?? 1) + 1]);
    entries.push(["updated_at", now()]);
    this.update("runs", "id", id, entries);
    this.appendEvent({
      type: "run.updated",
      runId: id,
      payload: fields,
    });
    });
  }

  listTasks(runId: string): TaskRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY ordinal, id")
        .all(runId) as unknown as TaskRow[]
    ).map((row) => this.mapTask(row));
  }

  getTask(runId: string, taskId: string): TaskRecord {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE run_id = ? AND id = ?")
      .get(runId, taskId) as unknown as TaskRow | undefined;
    if (!row) {
      throw new DuetError(
        `Unknown task ${taskId} in run ${runId}.`,
        "TASK_NOT_FOUND",
      );
    }
    return this.mapTask(row);
  }

  updateTask(
    runId: string,
    taskId: string,
    fields: Partial<{
      status: TaskStatus;
      baseCommit: string;
      branch: string;
      worktreePath: string | null;
      sessionId: string;
      revisionCount: number;
      review: ReviewResult;
      reviewedArtifact: ReviewedArtifact;
      taskCommit: string;
      integratedCommit: string;
      error: string | null;
      cancellationRequested: boolean;
    }>,
    expectedVersion?: number,
  ): void {
    this.transaction(() => {
    const current = this.getTask(runId, taskId);
    if (
      expectedVersion !== undefined &&
      (current.version ?? 1) !== expectedVersion
    ) {
      throw new DuetError("Task version changed.", "VERSION_CONFLICT");
    }
    const entries: Array<[string, string | number | null]> = [];
    if (fields.status !== undefined) entries.push(["status", fields.status]);
    if (fields.baseCommit !== undefined) {
      entries.push(["base_commit", fields.baseCommit]);
    }
    if (fields.branch !== undefined) entries.push(["branch", fields.branch]);
    if (fields.worktreePath !== undefined) {
      entries.push(["worktree_path", fields.worktreePath]);
    }
    if (fields.sessionId !== undefined) {
      entries.push(["session_id", fields.sessionId]);
    }
    if (fields.revisionCount !== undefined) {
      entries.push(["revision_count", fields.revisionCount]);
    }
    if (fields.review !== undefined) {
      entries.push(["review_json", JSON.stringify(fields.review)]);
    }
    if (fields.reviewedArtifact !== undefined) {
      entries.push([
        "reviewed_artifact_json",
        JSON.stringify(fields.reviewedArtifact),
      ]);
    }
    if (fields.taskCommit !== undefined) {
      entries.push(["task_commit", fields.taskCommit]);
    }
    if (fields.integratedCommit !== undefined) {
      entries.push(["integrated_commit", fields.integratedCommit]);
    }
    if (fields.error !== undefined) entries.push(["error", fields.error]);
    if (fields.cancellationRequested !== undefined) {
      entries.push([
        "cancellation_requested",
        fields.cancellationRequested ? 1 : 0,
      ]);
    }
    entries.push(["version", (current.version ?? 1) + 1]);
    entries.push(["updated_at", now()]);
    const assignments = entries.map(([name]) => `${name} = ?`).join(", ");
    this.db
      .prepare(
        `UPDATE tasks SET ${assignments} WHERE run_id = ? AND id = ?`,
      )
      .run(...entries.map(([, value]) => value), runId, taskId);
    this.appendEvent({
      type: "task.updated",
      runId,
      taskId,
      payload: fields,
    });
    });
  }

  approve(
    runId: string,
    stage: "plan" | "merge",
    bindingHash?: string,
    actor = "local-human",
  ): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO approvals (
            run_id, stage, approved_at, binding_hash, actor
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(run_id, stage) DO UPDATE SET
            approved_at = excluded.approved_at,
            binding_hash = excluded.binding_hash,
            actor = excluded.actor
        `)
        .run(runId, stage, now(), bindingHash ?? null, actor);
      this.updateRun(runId, {
        status: stage === "plan" ? "approved" : "merge_approved",
      });
      this.appendEvent({
        type: "approval.recorded",
        runId,
        payload: { stage, bindingHash, actor },
      });
    });
  }

  isApproved(runId: string, stage: "plan" | "merge"): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 AS approved FROM approvals WHERE run_id = ? AND stage = ?",
        )
        .get(runId, stage),
    );
  }

  getApprovalBinding(
    runId: string,
    stage: "plan" | "merge",
  ): string | undefined {
    const row = this.db
      .prepare(
        "SELECT binding_hash FROM approvals WHERE run_id = ? AND stage = ?",
      )
      .get(runId, stage) as { binding_hash: string | null } | undefined;
    return row?.binding_hash ?? undefined;
  }

  bindLegacyApproval(
    runId: string,
    stage: "plan" | "merge",
    bindingHash: string,
  ): void {
    this.transaction(() => {
      const result = this.db
        .prepare(`
          UPDATE approvals SET binding_hash = ?
          WHERE run_id = ? AND stage = ? AND binding_hash IS NULL
        `)
        .run(bindingHash, runId, stage);
      if (result.changes === 1) {
        this.appendEvent({
          type: "approval.legacy_bound",
          runId,
          payload: { stage, bindingHash },
        });
      }
    });
  }

  invalidateApproval(
    runId: string,
    stage: "plan" | "merge",
    reason: string,
  ): void {
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM approvals WHERE run_id = ? AND stage = ?")
        .run(runId, stage);
      this.appendEvent({
        type: "approval.invalidated",
        runId,
        severity: "warning",
        payload: { stage, reason },
      });
    });
  }

  reserveAgentAttempt(options: {
    runId: string;
    taskId?: string;
    role: string;
    provider: ProviderName;
    checkpoint: string;
    maxAgentTurns: number;
  }): number | undefined {
    return this.transaction(() => {
      const count = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM attempts WHERE run_id = ? AND provider IS NOT NULL",
        )
        .get(options.runId) as { count: number };
      if (count.count >= options.maxAgentTurns) return undefined;
      const stamp = now();
      const result = this.db
        .prepare(`
          INSERT INTO attempts (
            run_id, task_id, role, provider, status, checkpoint,
            started_at, heartbeat_at
          ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
        `)
        .run(
          options.runId,
          options.taskId ?? null,
          options.role,
          options.provider,
          options.checkpoint,
          stamp,
          stamp,
        );
      this.appendEvent({
        type: "provider.attempt_started",
        runId: options.runId,
        taskId: options.taskId,
        payload: {
          attemptId: Number(result.lastInsertRowid),
          role: options.role,
          provider: options.provider,
        },
      });
      return Number(result.lastInsertRowid);
    });
  }

  updateAttemptProcess(
    attemptId: number,
    fields: {
      pid?: number;
      heartbeat?: boolean;
      stdoutAppend?: string;
      stderrAppend?: string;
    },
  ): void {
    if (fields.pid !== undefined) {
      this.db
        .prepare("UPDATE attempts SET pid = ?, heartbeat_at = ? WHERE id = ?")
        .run(fields.pid, now(), attemptId);
    }
    if (fields.heartbeat) {
      this.db
        .prepare("UPDATE attempts SET heartbeat_at = ? WHERE id = ?")
        .run(now(), attemptId);
    }
    if (fields.stdoutAppend) {
      this.db
        .prepare(
          "UPDATE attempts SET stdout = stdout || ?, heartbeat_at = ? WHERE id = ?",
        )
        .run(fields.stdoutAppend, now(), attemptId);
    }
    if (fields.stderrAppend) {
      this.db
        .prepare(
          "UPDATE attempts SET stderr = stderr || ?, heartbeat_at = ? WHERE id = ?",
        )
        .run(fields.stderrAppend, now(), attemptId);
    }
  }

  finishAttempt(
    attemptId: number,
    status: "completed" | "failed" | "cancelled",
    fields: { sessionId?: string; checkpoint?: string; error?: string } = {},
  ): void {
    this.transaction(() => {
    const attempt = this.db
      .prepare("SELECT run_id, task_id FROM attempts WHERE id = ?")
      .get(attemptId) as { run_id: string; task_id: string | null } | undefined;
    this.db
      .prepare(`
        UPDATE attempts SET status = ?, session_id = COALESCE(?, session_id),
          checkpoint = COALESCE(?, checkpoint), error = ?,
          finished_at = ?, heartbeat_at = ? WHERE id = ?
      `)
      .run(
        status,
        fields.sessionId ?? null,
        fields.checkpoint ?? null,
        fields.error ?? null,
        now(),
        now(),
        attemptId,
      );
    if (attempt) {
      this.appendEvent({
        type: "provider.attempt_finished",
        runId: attempt.run_id,
        taskId: attempt.task_id ?? undefined,
        severity: status === "failed" ? "error" : "info",
        payload: { attemptId, status, checkpoint: fields.checkpoint },
      });
    }
    });
  }

  listRunningAttempts(runId: string, taskId?: string): AttemptRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM attempts
        WHERE run_id = ? AND status = 'running'
          AND (? IS NULL OR task_id = ?)
        ORDER BY id
      `)
      .all(runId, taskId ?? null, taskId ?? null) as unknown as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => this.mapAttempt(row));
  }

  recordAgentResult(
    runId: string,
    taskId: string | undefined,
    role: string,
    result: AgentResult,
    attemptId?: number,
  ): void {
    this.transaction(() => {
      const stamp = now();
      this.db
        .prepare(`
          INSERT OR REPLACE INTO agent_sessions (
            run_id, task_id, provider, role, external_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          runId,
          taskId ?? null,
          result.provider,
          role,
          result.sessionId,
          stamp,
        );
      this.db
        .prepare(`
          INSERT INTO usage_events (
            run_id, task_id, provider, role, input_tokens,
            cached_input_tokens, output_tokens, reasoning_output_tokens,
            cost_usd, cost_known, duration_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          runId,
          taskId ?? null,
          result.provider,
          role,
          result.usage.inputTokens ?? null,
          result.usage.cachedInputTokens ?? null,
          result.usage.outputTokens ?? null,
          result.usage.reasoningOutputTokens ?? null,
          result.provider === "claude" ? result.usage.costUsd ?? null : null,
          result.provider === "claude" && result.usage.costKnown ? 1 : 0,
          result.durationMs,
          stamp,
        );
      this.addArtifact(
        runId,
        `${role}.${result.provider}.control`,
        result.finalText,
        undefined,
        taskId,
      );
      if (attemptId !== undefined) {
        this.finishAttempt(attemptId, "completed", {
          sessionId: result.sessionId,
          checkpoint: "agent_completed",
        });
      }
      this.appendEvent({
        type: "provider.turn_completed",
        runId,
        taskId,
        payload: {
          role,
          provider: result.provider,
          durationMs: result.durationMs,
        },
      });
    });
  }

  getLatestSession(
    runId: string,
    taskId: string | undefined,
    provider: ProviderName,
    role: string,
  ): string | undefined {
    const row = this.db
      .prepare(`
        SELECT external_id FROM agent_sessions
        WHERE run_id = ? AND task_id IS ? AND provider = ? AND role = ?
        ORDER BY id DESC LIMIT 1
      `)
      .get(runId, taskId ?? null, provider, role) as
      | { external_id: string }
      | undefined;
    return row?.external_id;
  }

  addMessage(
    runId: string,
    kind: string,
    body: string,
    provider?: ProviderName,
    taskId?: string,
  ): void {
    this.transaction(() => {
    this.db
      .prepare(`
        INSERT INTO messages (
          run_id, task_id, kind, provider, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(runId, taskId ?? null, kind, provider ?? null, body, now());
    this.appendEvent({
      type: "message.created",
      runId,
      taskId,
      payload: { kind, provider },
    });
    });
  }

  addArtifact(
    runId: string,
    kind: string,
    content: string,
    filePath?: string,
    taskId?: string,
    sha256?: string,
  ): void {
    this.transaction(() => {
    this.db
      .prepare(`
        INSERT INTO artifacts (
          run_id, task_id, kind, path, content, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        runId,
        taskId ?? null,
        kind,
        filePath ?? null,
        content,
        sha256 ?? null,
        now(),
      );
    this.appendEvent({
      type: "artifact.created",
      runId,
      taskId,
      payload: { kind, sha256 },
    });
    });
  }

  addFileArtifact(
    runId: string,
    kind: string,
    filePath: string,
    taskId?: string,
  ): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO artifacts (
            run_id, task_id, kind, path, content, sha256, created_at
          ) VALUES (?, ?, ?, ?, NULL, NULL, ?)
        `)
        .run(runId, taskId ?? null, kind, filePath, now());
      this.appendEvent({
        type: "artifact.created",
        runId,
        taskId,
        payload: { kind, storage: "file" },
      });
    });
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare(`
        SELECT id, run_id, task_id, kind, sha256, created_at
        FROM artifacts WHERE run_id = ? ORDER BY id
      `)
      .all(runId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      runId: String(row.run_id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      kind: String(row.kind),
      sha256: row.sha256 ? String(row.sha256) : undefined,
      createdAt: String(row.created_at),
    }));
  }

  getArtifact(id: number): ArtifactRecord {
    const row = this.db
      .prepare(`
        SELECT id, run_id, task_id, kind, content, sha256, created_at
        FROM artifacts WHERE id = ?
      `)
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) throw new DuetError(`Unknown artifact: ${id}`, "ARTIFACT_NOT_FOUND");
    return {
      id: Number(row.id),
      runId: String(row.run_id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      kind: String(row.kind),
      content: row.content === null ? undefined : String(row.content),
      sha256: row.sha256 ? String(row.sha256) : undefined,
      createdAt: String(row.created_at),
    };
  }

  getArtifactSource(id: number): {
    record: ArtifactRecord;
    filePath?: string;
  } {
    const row = this.db
      .prepare(`
        SELECT id, run_id, task_id, kind, path, content, sha256, created_at
        FROM artifacts WHERE id = ?
      `)
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) throw new DuetError(`Unknown artifact: ${id}`, "ARTIFACT_NOT_FOUND");
    return {
      record: {
        id: Number(row.id),
        runId: String(row.run_id),
        taskId: row.task_id ? String(row.task_id) : undefined,
        kind: String(row.kind),
        content: row.content === null ? undefined : String(row.content),
        sha256: row.sha256 ? String(row.sha256) : undefined,
        createdAt: String(row.created_at),
      },
      filePath: row.path ? String(row.path) : undefined,
    };
  }

  getLatestArtifact(
    runId: string,
    taskId: string | undefined,
    kind: string,
  ): string | undefined {
    const row = this.db
      .prepare(`
        SELECT content FROM artifacts
        WHERE run_id = ? AND task_id IS ? AND kind = ?
        ORDER BY id DESC LIMIT 1
      `)
      .get(runId, taskId ?? null, kind) as
      | { content: string | null }
      | undefined;
    return row?.content ?? undefined;
  }

  clearTaskRecoveryOutputs(runId: string, taskId: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM artifacts WHERE run_id = ? AND task_id = ? AND kind LIKE 'worker-%.control'",
        )
        .run(runId, taskId);
      this.db
        .prepare(
          "DELETE FROM artifacts WHERE run_id = ? AND task_id = ? AND kind LIKE 'reviewer-%.control'",
        )
        .run(runId, taskId);
    });
  }

  recordVerification(
    runId: string,
    taskId: string,
    attempt: number,
    result: VerificationResult,
  ): void {
    this.transaction(() => {
    this.db
      .prepare(`
        INSERT INTO verification_results (
          run_id, task_id, attempt, command_json, exit_code, stdout, stderr,
          duration_ms, passed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        runId,
        taskId,
        attempt,
        JSON.stringify(result.command),
        result.exitCode,
        result.stdout,
        result.stderr,
        result.durationMs,
        result.passed ? 1 : 0,
        now(),
      );
    this.appendEvent({
      type: "verification.completed",
      runId,
      taskId,
      severity: result.passed ? "info" : "error",
      payload: {
        attempt,
        command: result.command,
        passed: result.passed,
        durationMs: result.durationMs,
      },
    });
    });
  }

  listVerificationResults(runId: string): Array<{
    id: number;
    taskId?: string;
    attempt: number;
    command: string[];
    exitCode: number | null;
    passed: boolean;
    durationMs: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(`
        SELECT id, task_id, attempt, command_json, exit_code,
          passed, duration_ms, created_at
        FROM verification_results WHERE run_id = ? ORDER BY id
      `)
      .all(runId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      attempt: Number(row.attempt),
      command: JSON.parse(String(row.command_json)) as string[],
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      passed: Number(row.passed) === 1,
      durationMs: Number(row.duration_ms),
      createdAt: String(row.created_at),
    }));
  }

  getUsageSummary(runId: string): UsageSummary {
    const rows = this.db
      .prepare(`
        SELECT provider,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(CASE WHEN cost_known = 1 THEN cost_usd ELSE 0 END), 0)
            AS cost_usd,
          MIN(cost_known) AS all_cost_known,
          COUNT(*) AS turns,
          COALESCE(SUM(duration_ms), 0) AS duration_ms
        FROM usage_events WHERE run_id = ? GROUP BY provider
      `)
      .all(runId) as unknown as Array<{
      provider: ProviderName;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      all_cost_known: number;
      turns: number;
      duration_ms: number;
    }>;
    const claude = rows.find((row) => row.provider === "claude");
    const codex = rows.find((row) => row.provider === "codex");
    const attemptRows = this.db
      .prepare(`
        SELECT provider, COUNT(*) AS turns
        FROM attempts
        WHERE run_id = ? AND provider IS NOT NULL
        GROUP BY provider
      `)
      .all(runId) as unknown as Array<{
      provider: ProviderName;
      turns: number;
    }>;
    const claudeAttempts =
      attemptRows.find((row) => row.provider === "claude")?.turns ?? 0;
    const codexAttempts =
      attemptRows.find((row) => row.provider === "codex")?.turns ?? 0;
    const claudeTurns = Math.max(claude?.turns ?? 0, claudeAttempts);
    const codexTurns = Math.max(codex?.turns ?? 0, codexAttempts);
    return {
      claude: {
        inputTokens: claude?.input_tokens ?? 0,
        outputTokens: claude?.output_tokens ?? 0,
        costUsd: claude?.cost_usd ?? 0,
        costKnown: claude ? claude.all_cost_known === 1 : true,
        turns: claudeTurns,
        durationMs: claude?.duration_ms ?? 0,
      },
      codex: {
        inputTokens: codex?.input_tokens ?? 0,
        outputTokens: codex?.output_tokens ?? 0,
        costUsd: null,
        costKnown: false,
        turns: codexTurns,
        durationMs: codex?.duration_ms ?? 0,
      },
      totalTurns: claudeTurns + codexTurns,
      totalDurationMs:
        (claude?.duration_ms ?? 0) + (codex?.duration_ms ?? 0),
    };
  }

  acquireLease(
    resourceType: LeaseRecord["resourceType"],
    resourceId: string,
    owner: string,
    ttlMs = 30_000,
  ): boolean {
    return this.transaction(() => {
      const stamp = Date.now();
      const existing = this.db
        .prepare(
          "SELECT owner, expires_at FROM leases WHERE resource_type = ? AND resource_id = ?",
        )
        .get(resourceType, resourceId) as
        | { owner: string; expires_at: string }
        | undefined;
      if (
        existing &&
        existing.owner !== owner &&
        Date.parse(existing.expires_at) > stamp
      ) {
        return false;
      }
      const heartbeat = new Date(stamp).toISOString();
      const expires = new Date(stamp + ttlMs).toISOString();
      this.db
        .prepare(`
          INSERT INTO leases (
            resource_type, resource_id, owner, expires_at, heartbeat_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(resource_type, resource_id) DO UPDATE SET
            owner = excluded.owner,
            expires_at = excluded.expires_at,
            heartbeat_at = excluded.heartbeat_at
        `)
        .run(resourceType, resourceId, owner, expires, heartbeat);
      return true;
    });
  }

  renewLease(
    resourceType: LeaseRecord["resourceType"],
    resourceId: string,
    owner: string,
    ttlMs = 30_000,
  ): boolean {
    const stamp = Date.now();
    const result = this.db
      .prepare(`
        UPDATE leases SET heartbeat_at = ?, expires_at = ?
        WHERE resource_type = ? AND resource_id = ? AND owner = ?
      `)
      .run(
        new Date(stamp).toISOString(),
        new Date(stamp + ttlMs).toISOString(),
        resourceType,
        resourceId,
        owner,
      );
    return result.changes === 1;
  }

  releaseLease(
    resourceType: LeaseRecord["resourceType"],
    resourceId: string,
    owner?: string,
  ): void {
    if (owner) {
      this.db
        .prepare(
          "DELETE FROM leases WHERE resource_type = ? AND resource_id = ? AND owner = ?",
        )
        .run(resourceType, resourceId, owner);
    } else {
      this.db
        .prepare(
          "DELETE FROM leases WHERE resource_type = ? AND resource_id = ?",
        )
        .run(resourceType, resourceId);
    }
  }

  listLeases(runId?: string): LeaseRecord[] {
    const rows = (
      runId
        ? this.db
            .prepare(
              "SELECT * FROM leases WHERE resource_id = ? OR resource_id LIKE ? ORDER BY resource_type, resource_id",
            )
            .all(runId, `${runId}:%`)
        : this.db
            .prepare(
              "SELECT * FROM leases ORDER BY resource_type, resource_id",
            )
            .all()
    ) as unknown as Array<{
      resource_type: LeaseRecord["resourceType"];
      resource_id: string;
      owner: string;
      expires_at: string;
      heartbeat_at: string;
    }>;
    return rows.map((row) => ({
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      owner: row.owner,
      expiresAt: row.expires_at,
      heartbeatAt: row.heartbeat_at,
    }));
  }

  recordIntegration(options: {
    runId: string;
    taskId: string;
    sourceCommit: string;
    resultingCommit: string;
    treeId: string;
    patchHash: string;
  }): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO integration_events (
            run_id, task_id, source_commit, resulting_commit,
            tree_id, patch_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          options.runId,
          options.taskId,
          options.sourceCommit,
          options.resultingCommit,
          options.treeId,
          options.patchHash,
          now(),
        );
      this.updateTask(options.runId, options.taskId, {
        status: "integrated",
        integratedCommit: options.resultingCommit,
      });
      this.appendEvent({
        type: "integration.completed",
        runId: options.runId,
        taskId: options.taskId,
        payload: {
          sourceCommit: options.sourceCommit,
          resultingCommit: options.resultingCommit,
          treeId: options.treeId,
          patchHash: options.patchHash,
        },
      });
    });
  }

  listMessages(runId: string): Array<{
    id: number;
    taskId?: string;
    kind: string;
    provider?: ProviderName;
    body: string;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(`
        SELECT id, task_id, kind, provider, body, created_at
        FROM messages WHERE run_id = ? ORDER BY id
      `)
      .all(runId) as unknown as Array<{
      id: number;
      task_id: string | null;
      kind: string;
      provider: ProviderName | null;
      body: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id ?? undefined,
      kind: row.kind,
      provider: row.provider ?? undefined,
      body: row.body,
      createdAt: row.created_at,
    }));
  }

  createOperation(operation: OperationRecord): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO operations (
            id, run_id, kind, status, service_instance_id, input_hash,
            result_json, error_json, started_at, heartbeat_at, finished_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          operation.id,
          operation.runId ?? null,
          operation.kind,
          operation.status,
          operation.serviceInstanceId,
          operation.inputHash,
          operation.resultJson ?? null,
          operation.errorJson ?? null,
          operation.startedAt ?? null,
          operation.heartbeatAt ?? null,
          operation.finishedAt ?? null,
          operation.createdAt,
        );
      this.appendEvent({
        type: "operation.created",
        runId: operation.runId,
        operationId: operation.id,
        payload: { kind: operation.kind, status: operation.status },
      });
    });
  }

  getOperation(id: string): OperationRecord {
    const row = this.db
      .prepare("SELECT * FROM operations WHERE id = ?")
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      throw new DuetError(`Unknown operation: ${id}`, "OPERATION_NOT_FOUND");
    }
    return this.mapOperation(row);
  }

  listActiveOperations(runId?: string): OperationRecord[] {
    const rows = (
      runId
        ? this.db
            .prepare(`
              SELECT * FROM operations
              WHERE run_id = ? AND status IN ('queued', 'running')
              ORDER BY created_at
            `)
            .all(runId)
        : this.db
            .prepare(`
              SELECT * FROM operations
              WHERE status IN ('queued', 'running')
              ORDER BY created_at
            `)
            .all()
    ) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapOperation(row));
  }

  countActiveManagerTurns(): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM operations
        WHERE kind = 'manager_turn' AND status IN ('queued', 'running')
      `)
      .get() as { count: number };
    return row.count;
  }

  updateOperation(
    id: string,
    fields: Partial<{
      runId: string;
      status: OperationStatus;
      resultJson: string;
      errorJson: string;
      startedAt: string;
      heartbeatAt: string;
      finishedAt: string;
    }>,
  ): void {
    this.transaction(() => {
      const entries: Array<[string, string | null]> = [];
      if (fields.runId !== undefined) entries.push(["run_id", fields.runId]);
      if (fields.status !== undefined) entries.push(["status", fields.status]);
      if (fields.resultJson !== undefined) {
        entries.push(["result_json", fields.resultJson]);
      }
      if (fields.errorJson !== undefined) {
        entries.push(["error_json", fields.errorJson]);
      }
      if (fields.startedAt !== undefined) {
        entries.push(["started_at", fields.startedAt]);
      }
      if (fields.heartbeatAt !== undefined) {
        entries.push(["heartbeat_at", fields.heartbeatAt]);
      }
      if (fields.finishedAt !== undefined) {
        entries.push(["finished_at", fields.finishedAt]);
      }
      if (entries.length > 0) this.update("operations", "id", id, entries);
      if (Object.keys(fields).some((key) => key !== "heartbeatAt")) {
        const operation = this.getOperation(id);
        this.appendEvent({
          type: "operation.updated",
          runId: operation.runId,
          operationId: id,
          severity: operation.status === "failed" ? "error" : "info",
          payload: fields,
        });
      }
    });
  }

  interruptActiveOperations(serviceInstanceId: string): number {
    return this.transaction(() => {
      const stamp = now();
      const rows = this.db
        .prepare(`
          SELECT id, run_id FROM operations
          WHERE service_instance_id != ?
            AND status IN ('queued', 'running')
        `)
        .all(serviceInstanceId) as unknown as Array<{
        id: string;
        run_id: string | null;
      }>;
      for (const row of rows) {
        this.db
          .prepare(`
            UPDATE operations SET status = 'interrupted',
              error_json = ?, finished_at = ? WHERE id = ?
          `)
          .run(
            JSON.stringify({
              code: "SERVICE_RESTARTED",
              message: "Service restarted before operation completion.",
            }),
            stamp,
            row.id,
          );
        this.appendEvent({
          type: "operation.interrupted",
          runId: row.run_id ?? undefined,
          operationId: row.id,
          severity: "warning",
        });
      }
      return rows.length;
    });
  }

  createConversation(input: {
    id: string;
    runId?: string;
    interfaceAgent: ManagerProviderName;
    title?: string;
  }): ConversationRecord {
    return this.transaction(() => {
      const stamp = now();
      this.db
        .prepare(`
          INSERT INTO conversations (
            id, run_id, interface_agent, title, summary, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, NULL, 'active', ?, ?)
        `)
        .run(
          input.id,
          input.runId ?? null,
          input.interfaceAgent,
          input.title ?? null,
          stamp,
          stamp,
        );
      this.appendEvent({
        type: "chat.conversation.created",
        runId: input.runId,
        payload: {
          conversationId: input.id,
          interfaceAgent: input.interfaceAgent,
        },
      });
      return this.getConversation(input.id);
    });
  }

  getConversation(id: string): ConversationRecord {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      throw new DuetError(
        `Unknown conversation: ${id}`,
        "CONVERSATION_NOT_FOUND",
      );
    }
    return this.mapConversation(row);
  }

  listConversations(runId?: string, limit = 50): ConversationRecord[] {
    const capped = Math.min(Math.max(limit, 1), 200);
    const rows = (
      runId
        ? this.db
            .prepare(`
              SELECT * FROM conversations WHERE run_id = ?
              ORDER BY updated_at DESC LIMIT ?
            `)
            .all(runId, capped)
        : this.db
            .prepare(`
              SELECT * FROM conversations
              ORDER BY updated_at DESC LIMIT ?
            `)
            .all(capped)
    ) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapConversation(row));
  }

  updateConversation(
    id: string,
    fields: Partial<{
      interfaceAgent: ManagerProviderName;
      summary: string;
      title: string;
      status: ConversationStatus;
    }>,
  ): void {
    this.transaction(() => {
      const entries: Array<[string, string | null]> = [];
      if (fields.interfaceAgent !== undefined) {
        entries.push(["interface_agent", fields.interfaceAgent]);
      }
      if (fields.summary !== undefined) {
        entries.push(["summary", capText(fields.summary, 20_000)]);
      }
      if (fields.title !== undefined) entries.push(["title", fields.title]);
      if (fields.status !== undefined) entries.push(["status", fields.status]);
      if (entries.length === 0) return;
      entries.push(["updated_at", now()]);
      this.update("conversations", "id", id, entries);
    });
  }

  appendConversationTurn(input: {
    conversationId: string;
    role: TurnRole;
    content: string;
    interfaceAgent?: ManagerProviderName;
    status?: TurnStatus;
    errorJson?: string;
    providerSessionId?: string;
    usageJson?: string;
    operationId?: string;
  }): ConversationTurnRecord {
    return this.transaction(() => {
      const conversation = this.getConversation(input.conversationId);
      const id = randomUUID();
      const status = input.status ?? "ok";
      const capped = capWithMeta(
        input.content,
        input.role === "manager" ? 100_000 : 20_000,
      );
      const errorJson = input.errorJson
        ? capText(input.errorJson, 8_000)
        : null;
      const seqRow = this.db
        .prepare(
          `SELECT COALESCE(MAX(seq), 0) + 1 AS seq
             FROM conversation_turns WHERE conversation_id = ?`,
        )
        .get(input.conversationId) as { seq: number };
      const stamp = now();
      this.db
        .prepare(`
          INSERT INTO conversation_turns (
            id, conversation_id, seq, role, interface_agent, content,
            status, error_json, provider_session_id, usage_json,
            operation_id, truncated, original_length, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.conversationId,
          seqRow.seq,
          input.role,
          input.interfaceAgent ?? null,
          capped.text,
          status,
          errorJson,
          input.providerSessionId ?? null,
          input.usageJson ?? null,
          input.operationId ?? null,
          capped.truncated ? 1 : 0,
          capped.truncated ? capped.originalLength : null,
          stamp,
        );
      this.db
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(stamp, input.conversationId);
      const eventType =
        input.role === "user"
          ? "chat.turn.created"
          : input.role === "manager"
            ? status === "failed"
              ? "chat.turn.failed"
              : "chat.turn.completed"
            : "chat.turn.system";
      this.appendEvent({
        type: eventType,
        runId: conversation.runId,
        operationId: input.operationId,
        severity: status === "failed" ? "error" : "info",
        payload: {
          conversationId: input.conversationId,
          turnId: id,
          role: input.role,
          status,
          truncated: capped.truncated,
          snippet: capText(capped.text, 120),
        },
      });
      return this.getConversationTurn(id);
    });
  }

  getConversationTurn(id: string): ConversationTurnRecord {
    const row = this.db
      .prepare("SELECT * FROM conversation_turns WHERE id = ?")
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      throw new DuetError(
        `Unknown conversation turn: ${id}`,
        "CONVERSATION_TURN_NOT_FOUND",
      );
    }
    return this.mapConversationTurn(row);
  }

  listConversationTurns(
    conversationId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): ConversationTurnRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1_000);
    const rows = this.db
      .prepare(`
        SELECT * FROM conversation_turns
        WHERE conversation_id = ? AND seq > ?
        ORDER BY seq LIMIT ?
      `)
      .all(
        conversationId,
        options.afterSeq ?? 0,
        limit,
      ) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapConversationTurn(row));
  }

  listRecentConversationTurns(
    conversationId: string,
    limit: number,
  ): ConversationTurnRecord[] {
    const boundedLimit = Math.min(Math.max(limit, 1), 1_000);
    const rows = this.db
      .prepare(`
        SELECT * FROM conversation_turns
        WHERE conversation_id = ?
        ORDER BY seq DESC LIMIT ?
      `)
      .all(conversationId, boundedLimit) as unknown as Array<
      Record<string, unknown>
    >;
    return rows
      .map((row) => this.mapConversationTurn(row))
      .reverse();
  }

  countManagerTurns(sinceIso?: string): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count FROM conversation_turns
        WHERE role = 'manager' AND (? IS NULL OR created_at >= ?)
      `)
      .get(sinceIso ?? null, sinceIso ?? null) as { count: number };
    return row.count;
  }

  sumManagerUsage(
    provider: ProviderName,
    sinceIso?: string,
  ): {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    turns: number;
  } {
    const rows = this.db
      .prepare(`
        SELECT usage_json FROM conversation_turns
        WHERE role = 'manager' AND interface_agent = ?
          AND usage_json IS NOT NULL
          AND (? IS NULL OR created_at >= ?)
      `)
      .all(provider, sinceIso ?? null, sinceIso ?? null) as Array<{
      usage_json: string;
    }>;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let turns = 0;
    for (const row of rows) {
      try {
        const usage = JSON.parse(row.usage_json) as {
          costUsd?: number;
          costKnown?: boolean;
          inputTokens?: number;
          outputTokens?: number;
        };
        turns += 1;
        if (usage.costKnown && typeof usage.costUsd === "number") {
          costUsd += usage.costUsd;
        }
        if (typeof usage.inputTokens === "number") {
          inputTokens += usage.inputTokens;
        }
        if (typeof usage.outputTokens === "number") {
          outputTokens += usage.outputTokens;
        }
      } catch {
        // Ignore malformed usage rows.
      }
    }
    return { costUsd, inputTokens, outputTokens, turns };
  }

  createProposal(input: {
    id: string;
    conversationId: string;
    turnId: string;
    runId?: string;
    taskId?: string;
    action: ProposalAction;
    summary: string;
    commandCli: string;
    commandJson: string;
    tier: ProposalTier;
    expiresAt: string;
  }): ManagerActionProposal {
    return this.transaction(() => {
      if (!VALID_PROPOSAL_ACTIONS.has(input.action)) {
        throw new DuetError(
          `Unknown proposal action: ${input.action}`,
          "INVALID_PROPOSAL",
        );
      }
      if (!VALID_PROPOSAL_TIERS.has(input.tier)) {
        throw new DuetError(
          `Unknown proposal tier: ${input.tier}`,
          "INVALID_PROPOSAL",
        );
      }
      if (isNaN(Date.parse(input.expiresAt))) {
        throw new DuetError(
          "Proposal expiresAt must be a valid ISO date.",
          "INVALID_PROPOSAL",
        );
      }

      // Turn must belong to this conversation.
      const turn = this.getConversationTurn(input.turnId);
      if (turn.conversationId !== input.conversationId) {
        throw new DuetError(
          `Turn ${input.turnId} does not belong to conversation ${input.conversationId}.`,
          "INVALID_PROPOSAL",
        );
      }

      // Proposal run must match the conversation's run (if conversation is run-scoped).
      if (input.runId) {
        this.getRun(input.runId);
        const conversation = this.getConversation(input.conversationId);
        if (conversation.runId && conversation.runId !== input.runId) {
          throw new DuetError(
            `Proposal run ${input.runId} does not match conversation run ${conversation.runId}.`,
            "INVALID_PROPOSAL",
          );
        }
      }

      if (input.taskId) {
        if (!input.runId) {
          throw new DuetError(
            "Task proposal requires a run.",
            "INVALID_PROPOSAL",
          );
        }
        const exists = this.listTasks(input.runId).some(
          (task) => task.id === input.taskId,
        );
        if (!exists) {
          throw new DuetError(`Unknown task: ${input.taskId}`, "TASK_NOT_FOUND");
        }
      }
      const stamp = now();
      this.db
        .prepare(`
          INSERT INTO manager_action_proposals (
            id, conversation_id, turn_id, run_id, task_id, action,
            summary, command_cli, command_json, tier, status,
            expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
        `)
        .run(
          input.id,
          input.conversationId,
          input.turnId,
          input.runId ?? null,
          input.taskId ?? null,
          input.action,
          capText(input.summary, 2_000),
          capText(input.commandCli, 1_000),
          capText(input.commandJson, 4_000),
          input.tier,
          input.expiresAt,
          stamp,
          stamp,
        );
      this.appendEvent({
        type: "chat.proposal.created",
        runId: input.runId,
        payload: {
          proposalId: input.id,
          action: input.action,
          status: "proposed",
        },
      });
      return this.getProposal(input.id);
    });
  }

  getProposal(id: string): ManagerActionProposal {
    const row = this.db
      .prepare("SELECT * FROM manager_action_proposals WHERE id = ?")
      .get(id) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      throw new DuetError(`Unknown proposal: ${id}`, "PROPOSAL_NOT_FOUND");
    }
    return this.mapProposal(row);
  }

  // Read-only: filters out expired/dismissed without mutating.
  listProposals(conversationId: string): ManagerActionProposal[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM manager_action_proposals
        WHERE conversation_id = ? AND status = 'proposed' AND expires_at > ?
        ORDER BY created_at
      `)
      .all(conversationId, now()) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapProposal(row));
  }

  listProposalsHistory(conversationId: string): ManagerActionProposal[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM manager_action_proposals
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `)
      .all(conversationId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapProposal(row));
  }

  dismissProposal(conversationId: string, proposalId: string): void {
    this.transaction(() => {
      const proposal = this.getProposal(proposalId);
      if (proposal.conversationId !== conversationId) {
        throw new DuetError(
          `Proposal ${proposalId} is not in conversation ${conversationId}.`,
          "PROPOSAL_NOT_FOUND",
        );
      }
      if (proposal.status === "dismissed") return;
      this.db
        .prepare(`
          UPDATE manager_action_proposals
          SET status = 'dismissed', updated_at = ? WHERE id = ?
        `)
        .run(now(), proposalId);
      this.appendEvent({
        type: "chat.proposal.dismissed",
        runId: proposal.runId,
        payload: { proposalId, action: proposal.action, status: "dismissed" },
      });
    });
  }

  markProposalStarted(
    conversationId: string,
    proposalId: string,
    operationId: string,
  ): ManagerActionProposal {
    return this.transaction(() => {
      const proposal = this.getProposal(proposalId);
      if (proposal.conversationId !== conversationId) {
        throw new DuetError(
          `Proposal ${proposalId} is not in conversation ${conversationId}.`,
          "PROPOSAL_NOT_FOUND",
        );
      }
      if (proposal.status !== "proposed") {
        throw new DuetError(
          `Proposal ${proposalId} is no longer active.`,
          "PROPOSAL_ALREADY_STARTED",
        );
      }
      if (Date.parse(proposal.expiresAt) <= Date.now()) {
        throw new DuetError(
          `Proposal ${proposalId} is expired.`,
          "PROPOSAL_NOT_ACTIVE",
        );
      }
      this.db
        .prepare(`
          UPDATE manager_action_proposals
          SET status = 'started', operation_id = ?, updated_at = ? WHERE id = ?
        `)
        .run(operationId, now(), proposalId);
      this.appendEvent({
        type: "chat.proposal.started",
        runId: proposal.runId,
        operationId,
        payload: {
          proposalId,
          action: proposal.action,
          status: "started",
          operationId,
        },
      });
      return this.getProposal(proposalId);
    });
  }

  // Explicit write path (never on read): mark proposals past their expiry.
  expireProposals(): number {
    return this.transaction(() => {
      const stamp = now();
      const rows = this.db
        .prepare(`
          SELECT id, run_id, action FROM manager_action_proposals
          WHERE status = 'proposed' AND expires_at <= ?
        `)
        .all(stamp) as unknown as Array<{
        id: string;
        run_id: string | null;
        action: string;
      }>;
      for (const row of rows) {
        this.db
          .prepare(`
            UPDATE manager_action_proposals
            SET status = 'expired', updated_at = ? WHERE id = ?
          `)
          .run(stamp, row.id);
        this.appendEvent({
          type: "chat.proposal.expired",
          runId: row.run_id ?? undefined,
          payload: {
            proposalId: row.id,
            action: row.action,
            status: "expired",
          },
        });
      }
      return rows.length;
    });
  }

  private mapProposal(row: Record<string, unknown>): ManagerActionProposal {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      turnId: String(row.turn_id),
      runId: row.run_id ? String(row.run_id) : undefined,
      taskId: row.task_id ? String(row.task_id) : undefined,
      action: row.action as ProposalAction,
      summary: String(row.summary),
      commandCli: String(row.command_cli),
      commandJson: String(row.command_json),
      tier: row.tier as ProposalTier,
      status: row.status as ProposalStatus,
      operationId: row.operation_id ? String(row.operation_id) : undefined,
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapConversation(row: Record<string, unknown>): ConversationRecord {
    return {
      id: String(row.id),
      runId: row.run_id ? String(row.run_id) : undefined,
      interfaceAgent: row.interface_agent as ManagerProviderName,
      title: row.title ? String(row.title) : undefined,
      summary: row.summary ? String(row.summary) : undefined,
      status: row.status as ConversationStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapConversationTurn(
    row: Record<string, unknown>,
  ): ConversationTurnRecord {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      seq: Number(row.seq),
      role: row.role as TurnRole,
      interfaceAgent: row.interface_agent
        ? (row.interface_agent as ProviderName)
        : undefined,
      content: String(row.content),
      status: row.status as TurnStatus,
      errorJson: row.error_json ? String(row.error_json) : undefined,
      providerSessionId: row.provider_session_id
        ? String(row.provider_session_id)
        : undefined,
      usageJson: row.usage_json ? String(row.usage_json) : undefined,
      operationId: row.operation_id ? String(row.operation_id) : undefined,
      truncated: Number(row.truncated) === 1,
      originalLength:
        row.original_length === null || row.original_length === undefined
          ? undefined
          : Number(row.original_length),
      createdAt: String(row.created_at),
    };
  }

  listEvents(options: {
    afterSeq?: number;
    runId?: string;
    limit?: number;
  } = {}): DuetEvent[] {
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 2_000);
    const rows = this.db
      .prepare(`
        SELECT * FROM events
        WHERE seq > ? AND (? IS NULL OR run_id = ?)
        ORDER BY seq LIMIT ?
      `)
      .all(
        options.afterSeq ?? 0,
        options.runId ?? null,
        options.runId ?? null,
        limit,
      ) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      seq: Number(row.seq),
      id: String(row.id),
      type: String(row.type),
      severity: row.severity as DuetEvent["severity"],
      runId: row.run_id ? String(row.run_id) : undefined,
      taskId: row.task_id ? String(row.task_id) : undefined,
      operationId: row.operation_id ? String(row.operation_id) : undefined,
      occurredAt: String(row.occurred_at),
      payload: JSON.parse(String(row.payload_json)),
    }));
  }

  getEventBounds(runId?: string): { minimum?: number; maximum?: number } {
    const row = this.db
      .prepare(`
        SELECT MIN(seq) AS minimum, MAX(seq) AS maximum
        FROM events WHERE (? IS NULL OR run_id = ?)
      `)
      .get(runId ?? null, runId ?? null) as {
      minimum: number | null;
      maximum: number | null;
    };
    return {
      minimum: row.minimum ?? undefined,
      maximum: row.maximum ?? undefined,
    };
  }

  compactEvents(retentionDays = 30, minimumNewest = 10_000): number {
    return this.transaction(() => {
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const result = this.db
        .prepare(`
          DELETE FROM events
          WHERE occurred_at < ?
            AND seq < COALESCE(
              (SELECT MIN(seq) FROM (
                SELECT seq FROM events ORDER BY seq DESC LIMIT ?
              )),
              0
            )
            AND (
              run_id IS NULL OR run_id IN (
                SELECT id FROM runs WHERE status IN (
                  'merged', 'failed', 'cancelled'
                )
              )
            )
        `)
        .run(cutoff, minimumNewest);
      return Number(result.changes);
    });
  }

  getIdempotentResponse(options: {
    clientId: string;
    method: string;
    route: string;
    key: string;
    inputHash: string;
  }): { statusCode: number; responseJson: string } | undefined {
    const row = this.db
      .prepare(`
        SELECT input_hash, status_code, response_json, expires_at
        FROM api_idempotency
        WHERE client_id = ? AND method = ? AND route = ? AND key = ?
      `)
      .get(
        options.clientId,
        options.method,
        options.route,
        options.key,
      ) as
      | {
          input_hash: string;
          status_code: number;
          response_json: string;
          expires_at: string;
        }
      | undefined;
    if (!row || Date.parse(row.expires_at) <= Date.now()) return undefined;
    if (row.input_hash !== options.inputHash) {
      throw new DuetError(
        "Idempotency key was reused with a different request.",
        "IDEMPOTENCY_CONFLICT",
      );
    }
    return { statusCode: row.status_code, responseJson: row.response_json };
  }

  saveIdempotentResponse(options: {
    clientId: string;
    method: string;
    route: string;
    key: string;
    inputHash: string;
    statusCode: number;
    responseJson: string;
    ttlMs?: number;
  }): void {
    const stamp = now();
    this.db
      .prepare(`
        INSERT INTO api_idempotency (
          client_id, method, route, key, input_hash, status_code,
          response_json, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_id, method, route, key) DO NOTHING
      `)
      .run(
        options.clientId,
        options.method,
        options.route,
        options.key,
        options.inputHash,
        options.statusCode,
        options.responseJson,
        new Date(Date.now() + (options.ttlMs ?? 7 * 86_400_000)).toISOString(),
        stamp,
      );
  }

  createActionTicket(options: {
    tokenHash: string;
    runId: string;
    action: "approve_plan" | "approve_merge" | "merge";
    bindingHash: string;
    runVersion: number;
    expiresAt: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO action_tickets (
          token_hash, run_id, action, binding_hash, run_version,
          expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        options.tokenHash,
        options.runId,
        options.action,
        options.bindingHash,
        options.runVersion,
        options.expiresAt,
        now(),
      );
  }

  consumeActionTicket(options: {
    tokenHash: string;
    runId: string;
    action: "approve_plan" | "approve_merge" | "merge";
    bindingHash: string;
    runVersion: number;
  }): void {
    this.transaction(() => {
      const ticket = this.db
        .prepare(`
          SELECT binding_hash, run_version, expires_at, consumed_at
          FROM action_tickets
          WHERE token_hash = ? AND run_id = ? AND action = ?
        `)
        .get(options.tokenHash, options.runId, options.action) as
        | {
            binding_hash: string;
            run_version: number;
            expires_at: string;
            consumed_at: string | null;
          }
        | undefined;
      if (
        !ticket ||
        ticket.consumed_at ||
        ticket.binding_hash !== options.bindingHash ||
        ticket.run_version !== options.runVersion ||
        Date.parse(ticket.expires_at) <= Date.now()
      ) {
        throw new DuetError(
          "Action ticket is invalid, expired, consumed, or stale.",
          "ACTION_TICKET_INVALID",
        );
      }
      this.db
        .prepare(
          "UPDATE action_tickets SET consumed_at = ? WHERE token_hash = ?",
        )
        .run(now(), options.tokenHash);
      this.appendEvent({
        type: "action_ticket.consumed",
        runId: options.runId,
        payload: { action: options.action },
      });
    });
  }

  private update(
    table: string,
    key: string,
    value: string,
    entries: Array<[string, string | number | null]>,
  ): void {
    const assignments = entries.map(([name]) => `${name} = ?`).join(", ");
    this.db
      .prepare(`UPDATE ${table} SET ${assignments} WHERE ${key} = ?`)
      .run(...entries.map(([, item]) => item), value);
  }

  private mapRun(row: RunRow): RunRecord {
    let plan: RunPlan | undefined;
    if (row.plan_json) {
      const parsed = JSON.parse(row.plan_json) as
        | RunPlan
        | {
            summary: string;
            task: Omit<RunPlan["tasks"][number], "id" | "dependencies">;
            risks: string[];
          };
      plan =
        "tasks" in parsed
          ? parsed
          : {
              summary: parsed.summary,
              tasks: [
                {
                  ...parsed.task,
                  id: "task-1",
                  dependencies: [],
                },
              ],
              risks: parsed.risks,
            };
    }
    return {
      id: row.id,
      repoPath: row.repo_path,
      repoRoot: row.repo_root,
      goal: row.goal,
      status: row.status,
      leadProvider: row.lead_provider,
      baseBranch: row.base_branch,
      baseCommit: row.base_commit,
      integrationBranch: row.integration_branch,
      integrationWorktreePath:
        row.integration_worktree_path ?? row.worktree_path ?? undefined,
      plan,
      finalCommit: row.final_commit ?? undefined,
      error: row.error ?? undefined,
      configJson: row.config_json,
      profile: (row.profile as AgentProfile | undefined) ?? "balanced",
      cancellationRequested: row.cancellation_requested === 1,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTask(row: TaskRow): TaskRecord {
    return {
      runId: row.run_id,
      id: row.id,
      ordinal: row.ordinal,
      plan: JSON.parse(row.plan_json) as TaskRecord["plan"],
      status: row.status,
      provider: row.provider,
      reviewerProvider: row.reviewer_provider,
      baseCommit: row.base_commit ?? undefined,
      branch: row.branch ?? undefined,
      worktreePath: row.worktree_path ?? undefined,
      sessionId: row.session_id ?? undefined,
      revisionCount: row.revision_count,
      review: row.review_json
        ? (JSON.parse(row.review_json) as ReviewResult)
        : undefined,
      reviewedArtifact: row.reviewed_artifact_json
        ? (JSON.parse(row.reviewed_artifact_json) as ReviewedArtifact)
        : undefined,
      taskCommit: row.task_commit ?? undefined,
      integratedCommit: row.integrated_commit ?? undefined,
      error: row.error ?? undefined,
      cancellationRequested: row.cancellation_requested === 1,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAttempt(row: Record<string, unknown>): AttemptRecord {
    return {
      id: Number(row.id),
      runId: String(row.run_id),
      taskId: row.task_id ? String(row.task_id) : undefined,
      role: String(row.role),
      provider: row.provider as ProviderName | undefined,
      status: row.status as AttemptRecord["status"],
      pid: row.pid === null ? undefined : Number(row.pid),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      checkpoint: String(row.checkpoint),
      stdout: String(row.stdout ?? ""),
      stderr: String(row.stderr ?? ""),
      startedAt: String(row.started_at),
      heartbeatAt: String(row.heartbeat_at),
      finishedAt: row.finished_at ? String(row.finished_at) : undefined,
      error: row.error ? String(row.error) : undefined,
    };
  }

  private mapOperation(row: Record<string, unknown>): OperationRecord {
    return {
      id: String(row.id),
      runId: row.run_id ? String(row.run_id) : undefined,
      kind: String(row.kind),
      status: row.status as OperationStatus,
      serviceInstanceId: String(row.service_instance_id),
      inputHash: String(row.input_hash),
      resultJson: row.result_json ? String(row.result_json) : undefined,
      errorJson: row.error_json ? String(row.error_json) : undefined,
      startedAt: row.started_at ? String(row.started_at) : undefined,
      heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : undefined,
      finishedAt: row.finished_at ? String(row.finished_at) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
