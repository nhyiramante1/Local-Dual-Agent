import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { nodeVersionError } from "../src/bootstrap.js";
import {
  defaultConfig,
  loadConfig,
  normalizeConfig,
  recommendedTurnBudget,
} from "../src/config.js";
import { runCommand } from "../src/process/run-command.js";
import { buildCodexArgs } from "../src/providers/codex.js";

test("Node below 24 returns a friendly bootstrap error", () => {
  assert.match(nodeVersionError("20.19.0")!, /requires Node.js 24/);
  assert.equal(nodeVersionError("24.0.0"), undefined);
});

test("revision configuration accepts 0, 1, and 3", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-config-"));
  try {
    assert.equal(defaultConfig.orchestration.maxRevisions, 1);
    for (const value of [0, 1, 3]) {
      const file = path.join(directory, `${value}.toml`);
      await writeFile(
        file,
        `[orchestration]\nmax_revisions = ${value}\n`,
      );
      assert.equal(
        (await loadConfig(file)).orchestration.maxRevisions,
        value,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("default turn budget covers six tasks and one revision each", () => {
  assert.equal(recommendedTurnBudget(6, 1), 25);
  assert.equal(
    defaultConfig.budgets.maxAgentTurns,
    recommendedTurnBudget(
      defaultConfig.orchestration.maxTasks,
      defaultConfig.orchestration.maxRevisions,
    ),
  );
});

test("stored pre-setup configuration receives verification defaults", () => {
  const normalized = normalizeConfig({
    verification: {
      commands: [],
      timeoutSeconds: 10,
      env: {},
    },
  });
  assert.deepEqual(normalized.verification.setupCommands, []);
});

test("Codex resume explicitly preserves read-only sandbox policy", () => {
  const args = buildCodexArgs({
    cwd: "C:\\repo",
    prompt: "revise",
    mode: "read-only",
    timeoutMs: 1_000,
    sessionId: "session-id",
  });
  assert.deepEqual(args.slice(0, 2), ["exec", "resume"]);
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes('approval_policy="never"'));
});

test("Windows command shims execute without shell mode", async () => {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await runCommand(executable, ["--version"], {
    cwd: process.cwd(),
    timeoutMs: 30_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^\d+\./);
});

test("cancellation terminates a spawned process tree", async () => {
  const started = Date.now();
  const result = await runCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      shouldCancel: () => Date.now() - started > 100,
    },
  );
  assert.equal(result.error, "Cancelled");
  assert.ok(result.durationMs < 5_000);
});
