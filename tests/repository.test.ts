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

import {
  abortCherryPick,
  assertAllowedChanges,
  cherryPickTask,
  commitReviewedTree,
  createManagedWorktree,
  preflightAndApplyPatch,
  removeManagedWorktree,
  stageCandidate,
} from "../src/git/repository.js";
import { runCommand } from "../src/process/run-command.js";

async function git(cwd: string, args: string[]): Promise<string> {
  const safe = path.resolve(cwd).replaceAll("\\", "/");
  const result = await runCommand(
    "git",
    ["-c", `safe.directory=${safe}`, ...args],
    { cwd },
  );
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(): Promise<{ directory: string; base: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-repo-"));
  await git(directory, ["init", "--initial-branch=main"]);
  await git(directory, ["config", "user.name", "Duet Test"]);
  await git(directory, ["config", "user.email", "duet@example.invalid"]);
  await writeFile(path.join(directory, "allowed.txt"), "original\n");
  await writeFile(path.join(directory, "outside.txt"), "outside\n");
  await writeFile(path.join(directory, ".gitignore"), "ignored.txt\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "initial"]);
  return {
    directory,
    base: await git(directory, ["rev-parse", "HEAD"]),
  };
}

test("scope enforcement checks deletion, rename, copy, and type paths", () => {
  assert.throws(
    () =>
      assertAllowedChanges(
        [{ status: "D", newPath: "outside.txt" }],
        ["allowed.txt"],
      ),
    /outside approved scope/,
  );
  assert.throws(
    () =>
      assertAllowedChanges(
        [{ status: "R100", oldPath: "allowed.txt", newPath: "outside.txt" }],
        ["allowed.txt"],
      ),
    /outside.txt/,
  );
  assert.throws(
    () =>
      assertAllowedChanges(
        [{ status: "C100", oldPath: "outside.txt", newPath: "allowed.txt" }],
        ["allowed.txt"],
      ),
    /outside.txt/,
  );
  assert.throws(
    () =>
      assertAllowedChanges(
        [{ status: "T", newPath: "outside.txt" }],
        ["allowed.txt"],
      ),
    /outside.txt/,
  );
});

test("unauthorized and ignored patches fail before disk mutation", async () => {
  const { directory } = await fixture();
  try {
    const unauthorized = `diff --git a/outside.txt b/outside.txt
--- a/outside.txt
+++ b/outside.txt
@@ -1 +1 @@
-outside
+changed
`;
    await assert.rejects(
      preflightAndApplyPatch(directory, unauthorized, ["allowed.txt"]),
      /outside approved scope/,
    );
    assert.equal(
      await readFile(path.join(directory, "outside.txt"), "utf8"),
      "outside\n",
    );

    const ignored = `diff --git a/ignored.txt b/ignored.txt
new file mode 100644
--- /dev/null
+++ b/ignored.txt
@@ -0,0 +1 @@
+secret influence
`;
    await assert.rejects(
      preflightAndApplyPatch(directory, ignored, ["ignored.txt"]),
      /ignored files/,
    );
    await assert.rejects(readFile(path.join(directory, "ignored.txt"), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume recognizes a patch that was already applied before a crash", async () => {
  const { directory } = await fixture();
  const patch = `diff --git a/allowed.txt b/allowed.txt
--- a/allowed.txt
+++ b/allowed.txt
@@ -1 +1 @@
-original
+resumed
`;
  try {
    assert.equal(
      await preflightAndApplyPatch(directory, patch, ["allowed.txt"]),
      "applied",
    );
    assert.equal(
      await preflightAndApplyPatch(
        directory,
        patch,
        ["allowed.txt"],
        true,
      ),
      "already_applied",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("staging includes new files and rejects ignored worker artifacts", async () => {
  const { directory, base } = await fixture();
  try {
    await writeFile(path.join(directory, "new.txt"), "new\n");
    const artifact = await stageCandidate(directory, base, ["new.txt"]);
    assert.deepEqual(artifact.changedPaths, ["new.txt"]);
    assert.match(artifact.diff, /new file mode/);

    await writeFile(path.join(directory, "ignored.txt"), "bad\n");
    await assert.rejects(
      stageCandidate(directory, base, ["new.txt"]),
      /Ignored worker artifacts/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("staging blocks an out-of-scope deletion exploit", async () => {
  const { directory, base } = await fixture();
  try {
    await rm(path.join(directory, "outside.txt"));
    await assert.rejects(
      stageCandidate(directory, base, ["allowed.txt"]),
      /outside approved scope/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commit refuses a candidate mutated after review", async () => {
  const { directory, base } = await fixture();
  try {
    await writeFile(path.join(directory, "allowed.txt"), "reviewed\n");
    const reviewed = await stageCandidate(
      directory,
      base,
      ["allowed.txt"],
    );
    await writeFile(path.join(directory, "allowed.txt"), "mutated\n");
    await assert.rejects(
      commitReviewedTree(
        directory,
        base,
        "candidate",
        ["allowed.txt"],
        reviewed,
      ),
      /changed after review/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cherry-pick conflicts are preserved for human resolution", async () => {
  const { directory } = await fixture();
  try {
    await git(directory, ["checkout", "-b", "task"]);
    await writeFile(path.join(directory, "allowed.txt"), "task\n");
    await git(directory, ["add", "allowed.txt"]);
    await git(directory, ["commit", "-m", "task"]);
    const taskCommit = await git(directory, ["rev-parse", "HEAD"]);
    await git(directory, ["checkout", "main"]);
    await writeFile(path.join(directory, "allowed.txt"), "integration\n");
    await git(directory, ["add", "allowed.txt"]);
    await git(directory, ["commit", "-m", "integration"]);

    const picked = await cherryPickTask(directory, taskCommit);
    assert.equal(picked.conflict, true);
    assert.match(
      await git(directory, ["diff", "--name-only", "--diff-filter=U"]),
      /allowed.txt/,
    );
    await abortCherryPick(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("managed worktree creation is idempotent", async () => {
  const { directory, base } = await fixture();
  const runId = `idempotent-${Date.now()}`;
  const branch = `duet/${runId}/integration`;
  try {
    const first = await createManagedWorktree(
      directory,
      runId,
      branch,
      base,
    );
    const second = await createManagedWorktree(
      directory,
      runId,
      branch,
      base,
    );
    assert.equal(second, first);
    await removeManagedWorktree(directory, runId, branch, undefined, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
