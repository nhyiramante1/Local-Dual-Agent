import { mkdirSync } from "node:fs";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

import type {
  AgentResult,
  LeaseRecord,
  ProviderName,
  ReviewResult,
  ReviewedArtifact,
  RunPlan,
  RunRecord,
  RunStatus,
  TaskRecord,
  TaskStatus,
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
  cancellation_requested: number;
  created_at: string;
  updated_at: string;
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

function opposite(provider: ProviderName): ProviderName {
  return provider === "claude" ? "codex" : "claude";
}

export class Store {
  private readonly db: DatabaseSync;

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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
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

        CREATE INDEX IF NOT EXISTS idx_tasks_run_status
          ON tasks(run_id, status, ordinal);
        CREATE INDEX IF NOT EXISTS idx_attempts_run_status
          ON attempts(run_id, status);
        CREATE INDEX IF NOT EXISTS idx_usage_run_provider
          ON usage_events(run_id, provider);
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
      this.db.exec("PRAGMA user_version = 2");
    });
  }

  createRun(run: RunRecord, tasks: TaskRecord[] = []): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO runs (
            id, repo_path, repo_root, goal, status, lead_provider,
            worker_provider, base_branch, base_commit, integration_branch,
            worktree_path, integration_worktree_path, plan_json, review_json,
            revision_count, final_commit, error, config_json,
            cancellation_requested, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          run.cancellationRequested ? 1 : 0,
          run.createdAt,
          run.updatedAt,
        );
      for (const task of tasks) this.insertTask(task);
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
  ): void {
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
    entries.push(["updated_at", now()]);
    this.update("runs", "id", id, entries);
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
  ): void {
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
    entries.push(["updated_at", now()]);
    const assignments = entries.map(([name]) => `${name} = ?`).join(", ");
    this.db
      .prepare(
        `UPDATE tasks SET ${assignments} WHERE run_id = ? AND id = ?`,
      )
      .run(...entries.map(([, value]) => value), runId, taskId);
  }

  approve(runId: string, stage: "plan" | "merge"): void {
    this.transaction(() => {
      this.db
        .prepare(`
          INSERT OR IGNORE INTO approvals (run_id, stage, approved_at)
          VALUES (?, ?, ?)
        `)
        .run(runId, stage, now());
      this.updateRun(runId, {
        status: stage === "plan" ? "approved" : "merge_approved",
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

  beginAttempt(options: {
    runId: string;
    taskId?: string;
    role: string;
    provider?: ProviderName;
    checkpoint: string;
  }): number {
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
        options.provider ?? null,
        options.checkpoint,
        stamp,
        stamp,
      );
    return Number(result.lastInsertRowid);
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
        `${role}.${result.provider}.raw.stdout`,
        result.stdout,
        undefined,
        taskId,
      );
      if (result.stderr.trim()) {
        this.addArtifact(
          runId,
          `${role}.${result.provider}.raw.stderr`,
          result.stderr,
          undefined,
          taskId,
        );
      }
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
    this.db
      .prepare(`
        INSERT INTO messages (
          run_id, task_id, kind, provider, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(runId, taskId ?? null, kind, provider ?? null, body, now());
  }

  addArtifact(
    runId: string,
    kind: string,
    content: string,
    filePath?: string,
    taskId?: string,
    sha256?: string,
  ): void {
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
    return {
      claude: {
        inputTokens: claude?.input_tokens ?? 0,
        outputTokens: claude?.output_tokens ?? 0,
        costUsd: claude?.cost_usd ?? 0,
        costKnown: claude ? claude.all_cost_known === 1 : true,
        turns: claude?.turns ?? 0,
        durationMs: claude?.duration_ms ?? 0,
      },
      codex: {
        inputTokens: codex?.input_tokens ?? 0,
        outputTokens: codex?.output_tokens ?? 0,
        costUsd: null,
        costKnown: false,
        turns: codex?.turns ?? 0,
        durationMs: codex?.duration_ms ?? 0,
      },
      totalTurns: (claude?.turns ?? 0) + (codex?.turns ?? 0),
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
      cancellationRequested: row.cancellation_requested === 1,
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
}
