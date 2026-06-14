import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFingerprintUnchanged,
  fingerprintRepository,
} from "../src/git/repository.js";
import { runCommand } from "../src/process/run-command.js";

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

test("repository fingerprint detects read-only writes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-fingerprint-"));
  try {
    await git(directory, ["init", "--initial-branch=main"]);
    await git(directory, ["config", "user.name", "Duet Test"]);
    await git(directory, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(directory, "file.txt"), "base\n");
    await git(directory, ["add", "."]);
    await git(directory, ["commit", "-m", "base"]);
    const before = await fingerprintRepository(directory);
    await writeFile(path.join(directory, "file.txt"), "changed\n");
    const after = await fingerprintRepository(directory);
    assert.throws(
      () => assertFingerprintUnchanged(before, after),
      /read-only agent changed/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
