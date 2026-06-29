import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultConfig } from "../src/config.js";
import type {
  AgentResult,
  ProviderName,
  RunPlan,
  RunRecord,
  TaskRecord,
} from "../src/core/domain.js";
import { Orchestrator } from "../src/orchestrator.js";
import { Store } from "../src/persistence/store.js";
import type {
  AgentTurn,
  ProviderAdapter,
} from "../src/providers/adapter.js";
import { runCommand } from "../src/process/run-command.js";

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

function result(
  provider: ProviderName,
  finalText: string,
  sequence: number,
): AgentResult {
  return {
    provider,
    sessionId: `${provider}-${sequence}`,
    finalText,
    stdout: JSON.stringify({ finalText }),
    stderr: "",
    durationMs: 5,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      costUsd: provider === "claude" ? 0.01 : undefined,
      costKnown: provider === "claude",
    },
  };
}

test("two non-overlapping tasks run concurrently and integrate deterministically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-dag-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-state-"));
  const database = path.join(stateDirectory, "duet.sqlite");
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await writeFile(path.join(directory, "b.txt"), "b\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);

  const active: Record<ProviderName, number> = { claude: 0, codex: 0 };
  const maximum: Record<ProviderName, number> = { claude: 0, codex: 0 };
  let activeWorkers = 0;
  let maximumWorkers = 0;
  let sequence = 0;
  // Force the two workers to overlap deterministically instead of relying on
  // wall-clock sleeps. The git/worktree setup each task performs before the stub
  // runs has unbounded latency under CPU load, so fixed sleeps could fail to
  // overlap and make maximumWorkers read 1 (a flaky "expected 2, got 1").
  const expectedConcurrentWorkers = 2;
  let releaseWorkerBarrier: () => void = () => {};
  const bothWorkersActive = new Promise<void>((resolve) => {
    releaseWorkerBarrier = resolve;
  });

  class StubAdapter implements ProviderAdapter {
    constructor(readonly name: ProviderName) {}

    async run(turn: AgentTurn): Promise<AgentResult> {
      active[this.name] += 1;
      maximum[this.name] = Math.max(maximum[this.name], active[this.name]);
      const worker = turn.prompt.includes("implementation worker");
      if (worker) {
        activeWorkers += 1;
        maximumWorkers = Math.max(maximumWorkers, activeWorkers);
        if (activeWorkers >= expectedConcurrentWorkers) releaseWorkerBarrier();
      }
      try {
        if (worker) {
          // Block until both workers are concurrently active, with a generous
          // timeout so a genuine single-worker regression fails the assertion
          // instead of hanging.
          await Promise.race([
            bothWorkersActive,
            new Promise((resolve) => setTimeout(resolve, 2_000)),
          ]);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        sequence += 1;
        if (turn.prompt.includes("planning lead")) {
          return result(
            this.name,
            `DUET_JSON_BEGIN
{"summary":"parallel","tasks":[{"id":"task-a","title":"A","objective":"change a","acceptanceCriteria":["A"],"allowedPaths":["a.txt"],"dependencies":[],"preferredProvider":"codex"},{"id":"task-b","title":"B","objective":"change b","acceptanceCriteria":["B"],"allowedPaths":["b.txt"],"dependencies":[],"preferredProvider":"claude"}],"risks":[]}
DUET_JSON_END`,
            sequence,
          );
        }
        if (turn.prompt.includes("cross-reviewer")) {
          return result(
            this.name,
            "DUET_JSON_BEGIN\n{\"verdict\":\"approve\",\"summary\":\"ok\",\"findings\":[]}\nDUET_JSON_END",
            sequence,
          );
        }
        if (this.name === "codex") {
          return result(
            this.name,
            `DUET_PATCH_BEGIN
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
DUET_PATCH_END`,
            sequence,
          );
        }
        await writeFile(path.join(turn.cwd, "b.txt"), "B\n");
        return result(this.name, "implemented", sequence);
      } finally {
        if (worker) activeWorkers -= 1;
        active[this.name] -= 1;
      }
    }
  }

  const adapters = {
    claude: new StubAdapter("claude"),
    codex: new StubAdapter("codex"),
  };
  const store = new Store(database);
  const orchestrator = new Orchestrator(
    store,
    (provider) => adapters[provider],
  );
  let runId: string | undefined;
  try {
    const config = structuredClone(defaultConfig);
    config.verification.commands = [
      [process.execPath, "-e", "process.exit(0)"],
    ];
    const planned = await orchestrator.plan({
      repoPath: directory,
      goal: "change both files",
      lead: "claude",
      config,
    });
    runId = planned.id;
    orchestrator.approve(planned.id, "plan");
    const executed = await orchestrator.execute(planned.id);
    assert.equal(executed.status, "awaiting_merge_approval");
    assert.equal(maximumWorkers, 2);
    assert.equal(maximum.claude, 1);
    assert.equal(maximum.codex, 1);
    assert.deepEqual(
      store.listTasks(planned.id).map((task) => [
        task.id,
        task.status,
        task.provider,
      ]),
      [
        ["task-a", "integrated", "codex"],
        ["task-b", "integrated", "claude"],
      ],
    );

    orchestrator.approve(planned.id, "merge");
    const merged = await orchestrator.merge(planned.id);
    assert.equal(merged.status, "merged");
    assert.equal(
      (await readFile(path.join(directory, "a.txt"), "utf8")).trim(),
      "A",
    );
    assert.equal(
      (await readFile(path.join(directory, "b.txt"), "utf8")).trim(),
      "B",
    );
  } finally {
    if (runId) await orchestrator.cleanup(runId, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("aggregate turn budget pauses before a new worker turn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-budget-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-budget-state-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  let workerTurns = 0;
  const adapter: ProviderAdapter = {
    name: "claude",
    async run(turn) {
      if (!turn.prompt.includes("planning lead")) workerTurns += 1;
      return result(
        "claude",
        `DUET_JSON_BEGIN
{"summary":"one","tasks":[{"id":"task","title":"Task","objective":"change","acceptanceCriteria":["done"],"allowedPaths":["a.txt"],"dependencies":[],"preferredProvider":"claude"}],"risks":[]}
DUET_JSON_END`,
        1,
      );
    },
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, () => adapter);
  let runId: string | undefined;
  try {
    const config = structuredClone(defaultConfig);
    config.budgets.maxAgentTurns = 1;
    const planned = await orchestrator.plan({
      repoPath: directory,
      goal: "change",
      lead: "claude",
      config,
    });
    runId = planned.id;
    orchestrator.approve(planned.id, "plan");
    const paused = await orchestrator.execute(planned.id);
    assert.equal(paused.status, "paused_budget");
    assert.equal(workerTurns, 0);
  } finally {
    if (runId) await orchestrator.cleanup(runId, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("concurrent providers cannot overshoot the reserved turn ceiling", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-turn-budget-"));
  const stateDirectory = await mkdtemp(
    path.join(os.tmpdir(), "duet-turn-budget-state-"),
  );
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await writeFile(path.join(directory, "b.txt"), "b\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  let sequence = 0;

  class BudgetAdapter implements ProviderAdapter {
    constructor(readonly name: ProviderName) {}
    async run(turn: AgentTurn): Promise<AgentResult> {
      sequence += 1;
      if (turn.prompt.includes("planning lead")) {
        return result(
          this.name,
          `DUET_JSON_BEGIN
{"summary":"budget","tasks":[{"id":"a","title":"A","objective":"A","acceptanceCriteria":["A"],"allowedPaths":["a.txt"],"dependencies":[],"preferredProvider":"codex"},{"id":"b","title":"B","objective":"B","acceptanceCriteria":["B"],"allowedPaths":["b.txt"],"dependencies":[],"preferredProvider":"claude"}],"risks":[]}
DUET_JSON_END`,
          sequence,
        );
      }
      if (this.name === "claude") {
        await writeFile(path.join(turn.cwd, "b.txt"), "B\n");
        return result(this.name, "done", sequence);
      }
      return result(
        this.name,
        `DUET_PATCH_BEGIN
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
DUET_PATCH_END`,
        sequence,
      );
    }
  }
  const adapters = {
    claude: new BudgetAdapter("claude"),
    codex: new BudgetAdapter("codex"),
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, (name) => adapters[name]);
  let runId: string | undefined;
  try {
    const config = structuredClone(defaultConfig);
    config.budgets.maxAgentTurns = 3;
    const planned = await orchestrator.plan({
      repoPath: directory,
      goal: "budget",
      lead: "claude",
      config,
    });
    runId = planned.id;
    orchestrator.approve(planned.id, "plan");
    const paused = await orchestrator.execute(planned.id);
    assert.equal(paused.status, "paused_budget");
    assert.equal(store.getUsageSummary(planned.id).totalTurns, 3);
  } finally {
    if (runId) await orchestrator.cleanup(runId, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("planner write is a deterministic read-only violation and is preserved", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-readonly-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-readonly-state-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  const adapter: ProviderAdapter = {
    name: "claude",
    async run(turn) {
      await writeFile(path.join(turn.cwd, "rogue.txt"), "rogue\n");
      return result(
        "claude",
        "DUET_JSON_BEGIN\n{\"summary\":\"x\",\"tasks\":[],\"risks\":[]}\nDUET_JSON_END",
        1,
      );
    },
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, () => adapter);
  try {
    await assert.rejects(
      orchestrator.plan({
        repoPath: directory,
        goal: "inspect",
        lead: "claude",
        config: structuredClone(defaultConfig),
      }),
      /read-only agent changed/,
    );
    assert.equal(
      await readFile(path.join(directory, "rogue.txt"), "utf8"),
      "rogue\n",
    );
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("resume reuses a completed Codex patch without another worker turn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-resume-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-resume-state-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  const base = await git(directory, ["rev-parse", "HEAD"]);
  const stamp = new Date().toISOString();
  const plan: RunPlan = {
    summary: "resume",
    tasks: [
      {
        id: "task",
        title: "Task",
        objective: "change",
        acceptanceCriteria: ["changed"],
        allowedPaths: ["a.txt"],
        dependencies: [],
        preferredProvider: "codex",
      },
    ],
    risks: [],
  };
  const config = structuredClone(defaultConfig);
  config.verification.commands = [];
  const run: RunRecord = {
    id: `resume-${Date.now()}`,
    repoPath: directory,
    repoRoot: directory,
    goal: "change",
    status: "awaiting_plan_approval",
    leadProvider: "claude",
    baseBranch: "main",
    baseCommit: base,
    integrationBranch: `duet/resume-${Date.now()}/integration`,
    plan,
    configJson: JSON.stringify(config),
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  run.integrationBranch = `duet/${run.id}/integration`;
  const task: TaskRecord = {
    runId: run.id,
    id: "task",
    ordinal: 0,
    plan: plan.tasks[0],
    status: "ready",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  let codexCalls = 0;
  const adapters: Record<ProviderName, ProviderAdapter> = {
    codex: {
      name: "codex",
      async run() {
        codexCalls += 1;
        throw new Error("duplicate Codex turn");
      },
    },
    claude: {
      name: "claude",
      async run() {
        return result(
          "claude",
          "DUET_JSON_BEGIN\n{\"verdict\":\"approve\",\"summary\":\"ok\",\"findings\":[]}\nDUET_JSON_END",
          1,
        );
      },
    },
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, (name) => adapters[name]);
  try {
    store.createRun(run, [task]);
    store.addArtifact(
      run.id,
      "worker-task.codex.control",
      `DUET_PATCH_BEGIN
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
DUET_PATCH_END`,
      undefined,
      task.id,
    );
    store.approve(run.id, "plan");
    const resumed = await orchestrator.resume(run.id);
    assert.equal(resumed.status, "awaiting_merge_approval");
    assert.equal(codexCalls, 0);
  } finally {
    await orchestrator.cleanup(run.id, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("a six-task DAG advances in dependency waves", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-six-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-six-state-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  for (let index = 1; index <= 6; index += 1) {
    await writeFile(path.join(directory, `t${index}.txt`), `t${index}\n`);
  }
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  const dependencies = [[], [], ["t1"], ["t2"], ["t3", "t4"], ["t5"]];
  const workerOrder: string[] = [];
  let sequence = 0;

  class SixAdapter implements ProviderAdapter {
    constructor(readonly name: ProviderName) {}
    async run(turn: AgentTurn): Promise<AgentResult> {
      sequence += 1;
      if (turn.prompt.includes("planning lead")) {
        const tasks = Array.from({ length: 6 }, (_, offset) => {
          const index = offset + 1;
          return {
            id: `t${index}`,
            title: `T${index}`,
            objective: `change t${index}`,
            acceptanceCriteria: ["changed"],
            allowedPaths: [`t${index}.txt`],
            dependencies: dependencies[offset],
            preferredProvider: index % 2 === 0 ? "claude" : "codex",
          };
        });
        return result(
          this.name,
          `DUET_JSON_BEGIN\n${JSON.stringify({ summary: "six", tasks, risks: [] })}\nDUET_JSON_END`,
          sequence,
        );
      }
      if (turn.prompt.includes("cross-reviewer")) {
        return result(
          this.name,
          "DUET_JSON_BEGIN\n{\"verdict\":\"approve\",\"summary\":\"ok\",\"findings\":[]}\nDUET_JSON_END",
          sequence,
        );
      }
      const id = /"id": "(t\d)"/.exec(turn.prompt)?.[1];
      assert.ok(id);
      workerOrder.push(id);
      if (this.name === "claude") {
        await writeFile(path.join(turn.cwd, `${id}.txt`), id.toUpperCase());
        return result(this.name, "done", sequence);
      }
      return result(
        this.name,
        `DUET_PATCH_BEGIN
diff --git a/${id}.txt b/${id}.txt
--- a/${id}.txt
+++ b/${id}.txt
@@ -1 +1 @@
-${id}
+${id.toUpperCase()}
DUET_PATCH_END`,
        sequence,
      );
    }
  }
  const adapters = {
    claude: new SixAdapter("claude"),
    codex: new SixAdapter("codex"),
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, (name) => adapters[name]);
  let runId: string | undefined;
  try {
    const config = structuredClone(defaultConfig);
    const planned = await orchestrator.plan({
      repoPath: directory,
      goal: "six changes",
      lead: "claude",
      config,
    });
    runId = planned.id;
    orchestrator.approve(planned.id, "plan");
    const executed = await orchestrator.execute(planned.id);
    assert.equal(executed.status, "awaiting_merge_approval");
    assert.ok(workerOrder.indexOf("t3") > workerOrder.indexOf("t1"));
    assert.ok(workerOrder.indexOf("t4") > workerOrder.indexOf("t2"));
    assert.ok(workerOrder.indexOf("t5") > workerOrder.indexOf("t3"));
    assert.ok(workerOrder.indexOf("t6") > workerOrder.indexOf("t5"));
    assert.deepEqual(
      store.listTasks(planned.id).map((task) => task.status),
      Array(6).fill("integrated"),
    );
  } finally {
    if (runId) await orchestrator.cleanup(runId, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("partial failure preserves independent progress and retry is bounded", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-retry-"));
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "duet-retry-state-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "a.txt"), "a\n");
  await writeFile(path.join(directory, "b.txt"), "b\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  let codexWorkerCalls = 0;
  let sequence = 0;

  class RetryAdapter implements ProviderAdapter {
    constructor(readonly name: ProviderName) {}
    async run(turn: AgentTurn): Promise<AgentResult> {
      sequence += 1;
      if (turn.prompt.includes("planning lead")) {
        return result(
          this.name,
          `DUET_JSON_BEGIN
{"summary":"retry","tasks":[{"id":"a","title":"A","objective":"change a","acceptanceCriteria":["A"],"allowedPaths":["a.txt"],"dependencies":[],"preferredProvider":"codex"},{"id":"b","title":"B","objective":"change b","acceptanceCriteria":["B"],"allowedPaths":["b.txt"],"dependencies":[],"preferredProvider":"claude"}],"risks":[]}
DUET_JSON_END`,
          sequence,
        );
      }
      if (turn.prompt.includes("cross-reviewer")) {
        return result(
          this.name,
          "DUET_JSON_BEGIN\n{\"verdict\":\"approve\",\"summary\":\"ok\",\"findings\":[]}\nDUET_JSON_END",
          sequence,
        );
      }
      if (this.name === "claude") {
        await writeFile(path.join(turn.cwd, "b.txt"), "B\n");
        return result(this.name, "done", sequence);
      }
      codexWorkerCalls += 1;
      if (codexWorkerCalls === 1) {
        return result(
          this.name,
          "DUET_PATCH_BEGIN\nnot a patch\nDUET_PATCH_END",
          sequence,
        );
      }
      return result(
        this.name,
        `DUET_PATCH_BEGIN
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
DUET_PATCH_END`,
        sequence,
      );
    }
  }
  const adapters = {
    claude: new RetryAdapter("claude"),
    codex: new RetryAdapter("codex"),
  };
  const store = new Store(path.join(stateDirectory, "state.sqlite"));
  const orchestrator = new Orchestrator(store, (name) => adapters[name]);
  let runId: string | undefined;
  try {
    const planned = await orchestrator.plan({
      repoPath: directory,
      goal: "retry",
      lead: "claude",
      config: structuredClone(defaultConfig),
    });
    runId = planned.id;
    orchestrator.approve(planned.id, "plan");
    const first = await orchestrator.execute(planned.id);
    assert.equal(first.status, "needs_attention");
    assert.equal(store.getTask(planned.id, "a").status, "failed");
    assert.equal(store.getTask(planned.id, "b").status, "integrated");

    const retried = await orchestrator.retry(planned.id, "a");
    assert.equal(retried.status, "awaiting_merge_approval");
    assert.equal(codexWorkerCalls, 2);
    assert.equal(store.getTask(planned.id, "a").status, "integrated");
  } finally {
    if (runId) await orchestrator.cleanup(runId, true);
    store.close();
    await rm(directory, { recursive: true, force: true });
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
