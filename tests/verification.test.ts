import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultConfig } from "../src/config.js";
import { stageCandidate } from "../src/git/repository.js";
import { runCommand } from "../src/process/run-command.js";
import { runVerification } from "../src/verification.js";

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

test("verification uses the staged tree and strips ambient secrets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-verify-"));
  const oldSecret = process.env.DUET_TEST_SECRET;
  process.env.DUET_TEST_SECRET = "must-not-leak";
  try {
    await git(directory, ["init", "--initial-branch=main"]);
    await git(directory, ["config", "user.name", "Duet Test"]);
    await git(directory, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(directory, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(directory, "checked.txt"), "base\n");
    await git(directory, ["add", "."]);
    await git(directory, ["commit", "-m", "base"]);
    const base = await git(directory, ["rev-parse", "HEAD"]);
    await writeFile(path.join(directory, "checked.txt"), "staged\n");
    const artifact = await stageCandidate(
      directory,
      base,
      ["checked.txt"],
    );
    await writeFile(path.join(directory, "ignored.txt"), "influence\n");

    const config = structuredClone(defaultConfig);
    config.verification.env = { DUET_STATIC: "yes" };
    config.verification.setupCommands = [
      [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('dependency.txt','provisioned')",
      ],
    ];
    config.verification.commands = [
      [
        process.execPath,
        "-e",
        "const fs=require('fs'); if(process.env.DUET_TEST_SECRET||process.env.DUET_STATIC!=='yes'||fs.existsSync('ignored.txt')||fs.readFileSync('checked.txt','utf8').trim()!=='staged'||fs.readFileSync('dependency.txt','utf8')!=='provisioned') process.exit(2)",
      ],
    ];
    const results = await runVerification({
      repoRoot: directory,
      treeId: artifact.treeId,
      runId: `verify-${Date.now()}`,
      taskId: "task",
      attempt: 0,
      config,
    });
    assert.equal(results.length, 2);
    assert.ok(results.every((result) => result.passed), JSON.stringify(results));
  } finally {
    if (oldSecret === undefined) delete process.env.DUET_TEST_SECRET;
    else process.env.DUET_TEST_SECRET = oldSecret;
    await rm(directory, { recursive: true, force: true });
  }
});

test("verification points package managers at a persistent cache", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-verify-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "duet-vcache-"));
  const oldCache = process.env.DUET_VERIFICATION_CACHE;
  process.env.DUET_VERIFICATION_CACHE = cacheDir;
  try {
    await git(directory, ["init", "--initial-branch=main"]);
    await git(directory, ["config", "user.name", "Duet Test"]);
    await git(directory, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(directory, "checked.txt"), "base\n");
    await git(directory, ["add", "."]);
    await git(directory, ["commit", "-m", "base"]);
    const base = await git(directory, ["rev-parse", "HEAD"]);
    await writeFile(path.join(directory, "checked.txt"), "staged\n");
    const artifact = await stageCandidate(directory, base, ["checked.txt"]);

    const config = structuredClone(defaultConfig);
    config.verification.setupCommands = [];
    config.verification.commands = [
      [
        process.execPath,
        "-e",
        "const c=process.env.npm_config_cache||''; const p=process.env.PIP_CACHE_DIR||''; if(!c.includes('duet-vcache-')||!p.includes('duet-vcache-')) process.exit(4)",
      ],
    ];
    const results = await runVerification({
      repoRoot: directory,
      treeId: artifact.treeId,
      runId: `verify-cache-${Date.now()}`,
      taskId: "task",
      attempt: 0,
      config,
    });
    assert.ok(results.every((result) => result.passed), JSON.stringify(results));
  } finally {
    if (oldCache === undefined) delete process.env.DUET_VERIFICATION_CACHE;
    else process.env.DUET_VERIFICATION_CACHE = oldCache;
    await rm(directory, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});
