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
    config.verification.commands = [
      [
        process.execPath,
        "-e",
        "const fs=require('fs'); if(process.env.DUET_TEST_SECRET||process.env.DUET_STATIC!=='yes'||fs.existsSync('ignored.txt')||fs.readFileSync('checked.txt','utf8').trim()!=='staged') process.exit(2)",
      ],
    ];
    const [result] = await runVerification({
      repoRoot: directory,
      treeId: artifact.treeId,
      runId: `verify-${Date.now()}`,
      taskId: "task",
      attempt: 0,
      config,
    });
    assert.equal(result.passed, true, JSON.stringify(result));
  } finally {
    if (oldSecret === undefined) delete process.env.DUET_TEST_SECRET;
    else process.env.DUET_TEST_SECRET = oldSecret;
    await rm(directory, { recursive: true, force: true });
  }
});
