import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, resolveManagerBudget } from "../src/config.js";

async function withToml<T>(
  content: string,
  fn: (tomlPath: string) => Promise<T> | T,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "duet-config-test-"));
  try {
    const tomlPath = path.join(dir, "duet.toml");
    await writeFile(tomlPath, content);
    await fn(tomlPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig returns default manager budget fields when [manager] is absent", async () => {
  await withToml("", async (tomlPath) => {
    const config = await loadConfig(tomlPath);
    const budget = resolveManagerBudget(config);
    assert.equal(budget.claudeMaxUsdPerTurn, 0.5);
    assert.equal(budget.claudeMaxUsdPerDay, 5);
    assert.equal(budget.codexMaxInputTokensPerDay, 500_000);
    assert.equal(budget.codexMaxOutputTokensPerDay, 100_000);
    assert.equal(budget.codexMaxRuntimeSeconds, 120);
    assert.equal(budget.maxTurnsPerDay, 200);
  });
});

test("loadConfig reads custom [manager] values from TOML", async () => {
  await withToml(
    `
[manager]
claude_max_usd_per_turn = 0.25
claude_max_usd_per_day = 2.0
max_turns_per_day = 50
codex_max_input_tokens_per_day = 100000
codex_max_output_tokens_per_day = 20000
codex_runtime_seconds = 60
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      const budget = resolveManagerBudget(config);
      assert.equal(budget.claudeMaxUsdPerTurn, 0.25);
      assert.equal(budget.claudeMaxUsdPerDay, 2.0);
      assert.equal(budget.maxTurnsPerDay, 50);
      assert.equal(budget.codexMaxInputTokensPerDay, 100_000);
      assert.equal(budget.codexMaxOutputTokensPerDay, 20_000);
      assert.equal(budget.codexMaxRuntimeSeconds, 60);
    },
  );
});

test("loadConfig partial [manager] section merges with defaults", async () => {
  await withToml(
    `
[manager]
max_turns_per_day = 100
`,
    async (tomlPath) => {
      const config = await loadConfig(tomlPath);
      const budget = resolveManagerBudget(config);
      assert.equal(budget.maxTurnsPerDay, 100);
      assert.equal(budget.claudeMaxUsdPerTurn, 0.5);
      assert.equal(budget.claudeMaxUsdPerDay, 5);
    },
  );
});

test("loadConfig rejects [manager] values below minimum", async () => {
  await withToml(
    `
[manager]
claude_max_usd_per_turn = 0.001
`,
    async (tomlPath) => {
      await assert.rejects(
        () => loadConfig(tomlPath),
        (error: Error) => {
          assert.ok(error.message.includes("0.01"));
          return true;
        },
      );
    },
  );
});
