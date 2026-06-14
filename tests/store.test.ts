import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  AgentResult,
  RunRecord,
  TaskRecord,
} from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";
import { ApplicationCommands } from "../src/application/commands.js";

function records(directory: string): {
  run: RunRecord;
  task: TaskRecord;
} {
  const stamp = new Date().toISOString();
  const run: RunRecord = {
    id: "run-1",
    repoPath: directory,
    repoRoot: directory,
    goal: "test",
    status: "awaiting_plan_approval",
    leadProvider: "claude",
    baseBranch: "main",
    baseCommit: "abc",
    integrationBranch: "duet/run-1/integration",
    plan: {
      summary: "test",
      tasks: [
        {
          id: "task",
          title: "task",
          objective: "test",
          acceptanceCriteria: ["pass"],
          allowedPaths: ["src/**"],
          dependencies: [],
        },
      ],
      risks: [],
    },
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return {
    run,
    task: {
      runId: run.id,
      id: "task",
      ordinal: 0,
      plan: run.plan!.tasks[0],
      status: "ready",
      provider: "codex",
      reviewerProvider: "claude",
      revisionCount: 0,
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

test("Store atomically persists tasks, approvals, and honest usage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-store-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    const { run, task } = records(directory);
    store.createRun(run, [task]);
    store.approve(run.id, "plan");
    assert.equal(store.getRun(run.id).status, "approved");
    assert.equal(store.listTasks(run.id).length, 1);

    const result: AgentResult = {
      provider: "codex",
      sessionId: "session",
      finalText: "done",
      stdout: "raw",
      stderr: "",
      durationMs: 10,
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        costKnown: false,
      },
    };
    store.recordAgentResult(run.id, task.id, "worker-task", result);
    const usage = store.getUsageSummary(run.id);
    assert.equal(usage.codex.inputTokens, 10);
    assert.equal(usage.codex.costUsd, null);
    assert.equal(usage.codex.costKnown, false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("transactions roll back and concurrent writers respect leases", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-lock-"));
  const database = path.join(directory, "state.sqlite");
  const first = new Store(database);
  const second = new Store(database);
  try {
    const { run, task } = records(directory);
    first.createRun(run, [task]);
    assert.throws(() =>
      first.transaction(() => {
        first.updateRun(run.id, { status: "failed" });
        throw new Error("rollback");
      }),
    );
    assert.equal(first.getRun(run.id).status, "awaiting_plan_approval");
    assert.equal(first.acquireLease("run", run.id, "one"), true);
    assert.equal(second.acquireLease("run", run.id, "two"), false);
    first.releaseLease("run", run.id, "one");
    assert.equal(second.acquireLease("run", run.id, "two"), true);
    second.releaseLease("run", run.id, "two");
    assert.equal(first.acquireLease("task", "stale", "one", 1), true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(second.acquireLease("task", "stale", "two"), true);
  } finally {
    first.close();
    second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("agent turn reservation is atomic across concurrent stores", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-turns-"));
  const database = path.join(directory, "state.sqlite");
  const first = new Store(database);
  const second = new Store(database);
  try {
    const { run, task } = records(directory);
    first.createRun(run, [task]);
    const options = {
      runId: run.id,
      taskId: task.id,
      role: "worker",
      provider: "codex" as const,
      checkpoint: "agent_starting",
      maxAgentTurns: 1,
    };
    const [left, right] = await Promise.all([
      Promise.resolve().then(() => first.reserveAgentAttempt(options)),
      Promise.resolve().then(() => second.reserveAgentAttempt(options)),
    ]);
    assert.equal([left, right].filter((value) => value !== undefined).length, 1);
    assert.equal(first.getUsageSummary(run.id).totalTurns, 1);
  } finally {
    first.close();
    second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("operations, events, and idempotency survive restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-events-"));
  const database = path.join(directory, "state.sqlite");
  let store = new Store(database);
  try {
    const { run } = records(directory);
    store.createRun(run);
    store.createOperation({
      id: "operation",
      runId: run.id,
      kind: "execute",
      status: "running",
      serviceInstanceId: "old-service",
      inputHash: "input",
      createdAt: new Date().toISOString(),
    });
    store.saveIdempotentResponse({
      clientId: "client",
      method: "POST",
      route: "/runs",
      key: "key",
      inputHash: "input",
      statusCode: 202,
      responseJson: "{\"ok\":true}",
    });
    store.close();

    store = new Store(database);
    assert.equal(store.interruptActiveOperations("new-service"), 1);
    assert.equal(store.getOperation("operation").status, "interrupted");
    assert.ok(store.listEvents().length >= 3);
    assert.deepEqual(
      store.getIdempotentResponse({
        clientId: "client",
        method: "POST",
        route: "/runs",
        key: "key",
        inputHash: "input",
      }),
      { statusCode: 202, responseJson: "{\"ok\":true}" },
    );
    assert.throws(
      () =>
        store.getIdempotentResponse({
          clientId: "client",
          method: "POST",
          route: "/runs",
          key: "key",
          inputHash: "changed",
        }),
      /different request/,
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("approval bindings reject changed approved inputs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-approval-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    const { run, task } = records(directory);
    store.createRun(run, [task]);
    const app = new ApplicationCommands(store);
    app.approve(run.id, "plan");
    store.updateRun(run.id, { configJson: "{\"changed\":true}" });
    assert.throws(() => app.execute(run.id), /approval no longer matches/);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume configuration changes require a fresh plan approval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-reapprove-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    const { run, task } = records(directory);
    store.createRun(run, [task]);
    const app = new ApplicationCommands(store);
    app.approve(run.id, "plan");
    const config = {
      orchestration: {
        defaultLead: "claude" as const,
        maxRevisions: 1,
        agentTimeoutSeconds: 600,
        maxParallelTasks: 2,
        maxTasks: 6,
      },
      budgets: {
        runWallClockSeconds: 3_600,
        maxAgentTurns: 25,
        claudeMaxUsdPerTurn: 0.75,
        claudeMaxUsdPerRun: 3,
        codexMaxInputTokens: 400_000,
        codexMaxOutputTokens: 40_000,
      },
      verification: {
        setupCommands: [],
        commands: [],
        timeoutSeconds: 300,
        env: {},
      },
    };
    const changed = await app.resume(run.id, config);
    assert.equal(changed.status, "awaiting_plan_approval");
    assert.equal(store.isApproved(run.id, "plan"), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
