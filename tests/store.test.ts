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
