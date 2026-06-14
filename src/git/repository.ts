import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import type {
  RepositoryFingerprint,
  RepositorySnapshot,
  ReviewedArtifact,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { runCommand } from "../process/run-command.js";
import { worktreesRoot } from "../paths.js";

interface GitOptions {
  timeoutMs?: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}

export interface PathChange {
  status: string;
  oldPath?: string;
  newPath: string;
}

function safeDirectory(cwd: string): string {
  return path.resolve(cwd).replaceAll("\\", "/");
}

async function git(
  cwd: string,
  args: string[],
  options: GitOptions = {},
): Promise<string> {
  const result = await runCommand(
    "git",
    ["-c", `safe.directory=${safeDirectory(cwd)}`, ...args],
    {
      cwd,
      timeoutMs: options.timeoutMs ?? 30_000,
      stdin: options.stdin,
      env: options.env,
    },
  );
  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new DuetError(
      result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`,
      "GIT_COMMAND_FAILED",
    );
  }
  return result.stdout;
}

function nulList(value: string): string[] {
  return value.split("\0").filter(Boolean).map((item) => item.replaceAll("\\", "/"));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pathMatchesScope(file: string, scopes: string[]): boolean {
  const normalized = file.replaceAll("\\", "/");
  return scopes.some((scope) => {
    const candidate = scope.replaceAll("\\", "/");
    return candidate.endsWith("/**")
      ? normalized === candidate.slice(0, -3) ||
          normalized.startsWith(candidate.slice(0, -2))
      : normalized === candidate;
  });
}

export function assertAllowedChanges(
  changes: PathChange[],
  allowedPaths: string[],
): void {
  const paths = changes.flatMap((change) =>
    change.oldPath ? [change.oldPath, change.newPath] : [change.newPath],
  );
  const outside = [...new Set(paths)].filter(
    (file) => !pathMatchesScope(file, allowedPaths),
  );
  if (outside.length > 0) {
    throw new DuetError(
      `Changes outside approved scope: ${outside.join(", ")}`,
      "SCOPE_VIOLATION",
    );
  }
}

export async function inspectRepository(
  repoPath: string,
): Promise<RepositorySnapshot> {
  const root = (await git(repoPath, ["rev-parse", "--show-toplevel"])).trim();
  const [branch, head, statusText] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  if (!branch.trim()) {
    throw new DuetError(
      "Detached HEAD repositories are not supported.",
      "DETACHED_HEAD",
    );
  }
  const remote = await git(root, ["remote", "get-url", "origin"], {
    allowFailure: true,
  });
  return {
    root,
    branch: branch.trim(),
    head: head.trim(),
    clean: statusText.trim().length === 0,
    statusText: statusText.trim(),
    remoteUrl: remote.trim() || undefined,
  };
}

export function requireClean(snapshot: RepositorySnapshot): void {
  if (!snapshot.clean) {
    throw new DuetError(
      `Repository must be clean.\n${snapshot.statusText}`,
      "DIRTY_REPOSITORY",
    );
  }
}

export async function fingerprintRepository(
  repoRoot: string,
): Promise<RepositoryFingerprint> {
  const [head, indexTree, trackedDiff, untracked, ignored] = await Promise.all([
    git(repoRoot, ["rev-parse", "HEAD"]),
    git(repoRoot, ["write-tree"]),
    git(repoRoot, ["diff", "--binary", "HEAD", "--"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    git(repoRoot, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
    ]),
  ]);
  return {
    head: head.trim(),
    indexTree: indexTree.trim(),
    trackedDiffHash: hash(trackedDiff),
    untracked: nulList(untracked).sort(),
    ignored: nulList(ignored).sort(),
  };
}

export function assertFingerprintUnchanged(
  before: RepositoryFingerprint,
  after: RepositoryFingerprint,
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new DuetError(
      "A read-only agent changed repository state.",
      "READ_ONLY_VIOLATION",
    );
  }
}

function managedWorktreePath(runId: string, taskId?: string): string {
  const root = path.resolve(worktreesRoot());
  const target = path.resolve(root, runId, taskId ?? "integration");
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DuetError("Managed worktree path escaped its root.", "UNSAFE_WORKTREE_PATH");
  }
  return target;
}

export async function createManagedWorktree(
  repoRoot: string,
  runId: string,
  branch: string,
  baseCommit: string,
  taskId?: string,
): Promise<string> {
  const target = managedWorktreePath(runId, taskId);
  await mkdir(path.dirname(target), { recursive: true });
  const registered = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (registered.includes(`worktree ${target.replaceAll("\\", "/")}`)) {
    return target;
  }
  await rm(target, { recursive: true, force: true });
  const branchExists = (
    await git(repoRoot, ["show-ref", "--verify", `refs/heads/${branch}`], {
      allowFailure: true,
    })
  ).trim();
  const args = branchExists
    ? ["worktree", "add", target, branch]
    : ["worktree", "add", "-b", branch, target, baseCommit];
  await git(repoRoot, args);
  return target;
}

export async function removeManagedWorktree(
  repoRoot: string,
  runId: string,
  branch: string,
  taskId?: string,
  force = false,
): Promise<void> {
  const target = managedWorktreePath(runId, taskId);
  await git(repoRoot, [
    "worktree",
    "remove",
    ...(force ? ["--force"] : []),
    target,
  ], { allowFailure: force });
  await rm(target, { recursive: true, force: true });
  await git(repoRoot, ["worktree", "prune"]);
  await git(repoRoot, ["branch", "-D", branch], { allowFailure: force });
  await rmdir(path.dirname(target)).catch(() => undefined);
}

export async function listChanges(
  worktree: string,
  baseCommit: string,
  staged = false,
): Promise<PathChange[]> {
  const output = await git(worktree, [
    "diff",
    ...(staged ? ["--cached"] : []),
    "--name-status",
    "-z",
    "-M",
    "-C",
    baseCommit,
    "--",
  ]);
  const fields = output.split("\0").filter(Boolean);
  const changes: PathChange[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push({
        status,
        oldPath: fields[index++].replaceAll("\\", "/"),
        newPath: fields[index++].replaceAll("\\", "/"),
      });
    } else {
      changes.push({
        status,
        newPath: fields[index++].replaceAll("\\", "/"),
      });
    }
  }
  return changes;
}

export async function currentHead(worktree: string): Promise<string> {
  return (await git(worktree, ["rev-parse", "HEAD"])).trim();
}

export async function commitArtifact(
  worktree: string,
  baseCommit: string,
  commit: string,
): Promise<ReviewedArtifact> {
  const [treeId, diff, changes] = await Promise.all([
    git(worktree, ["rev-parse", `${commit}^{tree}`]),
    git(worktree, [
      "diff",
      "--binary",
      "--no-ext-diff",
      baseCommit,
      commit,
      "--",
    ]),
    git(worktree, [
      "diff",
      "--name-status",
      "-z",
      "-M",
      "-C",
      baseCommit,
      commit,
      "--",
    ]),
  ]);
  const fields = changes.split("\0").filter(Boolean);
  const parsed: PathChange[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      parsed.push({
        status,
        oldPath: fields[index++].replaceAll("\\", "/"),
        newPath: fields[index++].replaceAll("\\", "/"),
      });
    } else {
      parsed.push({
        status,
        newPath: fields[index++].replaceAll("\\", "/"),
      });
    }
  }
  return {
    treeId: treeId.trim(),
    diffHash: hash(diff),
    diff,
    changedPaths: [
      ...new Set(
        parsed.flatMap((item) =>
          item.oldPath ? [item.oldPath, item.newPath] : [item.newPath],
        ),
      ),
    ],
  };
}

export async function listIgnoredFiles(worktree: string): Promise<string[]> {
  return nulList(
    await git(worktree, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
    ]),
  );
}

function patchHeaderPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match =
      /^(?:---|\+\+\+) (?:a|b)\/(.+)$/.exec(line) ??
      /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if (match && match[1] !== "/dev/null") paths.add(match[1].replaceAll("\\", "/"));
  }
  return [...paths];
}

async function patchPathsFromGit(
  worktree: string,
  patch: string,
): Promise<string[]> {
  const output = await git(
    worktree,
    ["apply", "--numstat", "-z", "-"],
    { stdin: `${patch}\n` },
  );
  const fields = output.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const parts = field.split("\t");
    if (parts.length >= 3 && parts[2]) {
      paths.add(parts.slice(2).join("\t").replaceAll("\\", "/"));
    } else if (parts.length >= 3) {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (oldPath) paths.add(oldPath.replaceAll("\\", "/"));
      if (newPath) paths.add(newPath.replaceAll("\\", "/"));
      index += 2;
    }
  }
  if (paths.size === 0) {
    for (const headerPath of patchHeaderPaths(patch)) paths.add(headerPath);
  }
  return [...paths];
}

async function ignoredAmong(worktree: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const output = await git(
    worktree,
    ["check-ignore", "--no-index", "--stdin", "-z"],
    { stdin: `${paths.join("\0")}\0`, allowFailure: true },
  );
  return nulList(output);
}

export async function preflightAndApplyPatch(
  worktree: string,
  patch: string,
  allowedPaths: string[],
  allowAlreadyApplied = false,
): Promise<"applied" | "already_applied"> {
  const paths = await patchPathsFromGit(worktree, patch);
  if (paths.length === 0) {
    throw new DuetError("Patch contains no repository paths.", "MALFORMED_AGENT_PATCH");
  }
  assertAllowedChanges(
    paths.map((newPath) => ({ status: "P", newPath })),
    allowedPaths,
  );
  const ignored = await ignoredAmong(worktree, paths);
  if (ignored.length > 0) {
    throw new DuetError(
      `Patch targets ignored files: ${ignored.join(", ")}`,
      "IGNORED_PATH",
    );
  }
  const check = await runCommand(
    "git",
    [
      "-c",
      `safe.directory=${safeDirectory(worktree)}`,
      "apply",
      "--check",
      "-",
    ],
    { cwd: worktree, stdin: `${patch}\n`, timeoutMs: 30_000 },
  );
  if (check.exitCode !== 0) {
    if (allowAlreadyApplied) {
      const reverse = await runCommand(
        "git",
        [
          "-c",
          `safe.directory=${safeDirectory(worktree)}`,
          "apply",
          "--reverse",
          "--check",
          "-",
        ],
        { cwd: worktree, stdin: `${patch}\n`, timeoutMs: 30_000 },
      );
      if (reverse.exitCode === 0) return "already_applied";
    }
    throw new DuetError(
      check.stderr.trim() || check.stdout.trim() || "Patch preflight failed.",
      "GIT_COMMAND_FAILED",
    );
  }
  await git(worktree, ["apply", "--whitespace=nowarn", "-"], {
    stdin: `${patch}\n`,
  });
  return "applied";
}

export async function stageCandidate(
  worktree: string,
  baseCommit: string,
  allowedPaths: string[],
): Promise<ReviewedArtifact> {
  const ignored = await listIgnoredFiles(worktree);
  if (ignored.length > 0) {
    throw new DuetError(
      `Ignored worker artifacts are forbidden: ${ignored.join(", ")}`,
      "IGNORED_ARTIFACT",
    );
  }
  await git(worktree, ["add", "-A"]);
  const changes = await listChanges(worktree, baseCommit, true);
  if (changes.length === 0) throw new DuetError("Candidate has no changes.", "NO_CHANGES");
  assertAllowedChanges(changes, allowedPaths);
  const [treeId, diff] = await Promise.all([
    git(worktree, ["write-tree"]),
    git(worktree, ["diff", "--cached", "--binary", "--no-ext-diff", baseCommit, "--"]),
  ]);
  return {
    treeId: treeId.trim(),
    diffHash: hash(diff),
    diff,
    changedPaths: [...new Set(changes.flatMap((item) =>
      item.oldPath ? [item.oldPath, item.newPath] : [item.newPath],
    ))],
  };
}

export async function materializeTree(
  repoRoot: string,
  treeId: string,
  target: string,
): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const indexFile = path.join(
    path.dirname(target),
    `.duet-index-${randomBytes(6).toString("hex")}`,
  );
  const prefix = `${path.resolve(target)}${path.sep}`;
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    await git(repoRoot, ["read-tree", treeId], { env });
    await git(repoRoot, ["checkout-index", "-a", `--prefix=${prefix}`], { env });
  } finally {
    await rm(indexFile, { force: true });
  }
}

export async function commitReviewedTree(
  worktree: string,
  baseCommit: string,
  message: string,
  allowedPaths: string[],
  reviewed: ReviewedArtifact,
): Promise<string> {
  const current = await stageCandidate(worktree, baseCommit, allowedPaths);
  if (
    current.treeId !== reviewed.treeId ||
    current.diffHash !== reviewed.diffHash
  ) {
    throw new DuetError(
      "Candidate changed after review.",
      "REVIEWED_ARTIFACT_MISMATCH",
    );
  }
  await git(worktree, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    `core.hooksPath=${path.join(worktreesRoot(), "empty-hooks")}`,
    "commit",
    "--no-verify",
    "-m",
    message,
  ]);
  const commit = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  const tree = (await git(worktree, ["rev-parse", `${commit}^{tree}`])).trim();
  const committedDiff = await git(worktree, [
    "diff",
    "--binary",
    "--no-ext-diff",
    baseCommit,
    commit,
    "--",
  ]);
  if (tree !== reviewed.treeId || hash(committedDiff) !== reviewed.diffHash) {
    throw new DuetError(
      "Committed tree differs from reviewed artifact.",
      "COMMIT_INTEGRITY_FAILURE",
    );
  }
  assertAllowedChanges(
    await listChanges(worktree, baseCommit),
    allowedPaths,
  );
  return commit;
}

export async function cherryPickTask(
  integrationWorktree: string,
  taskCommit: string,
): Promise<{ commit: string; conflict: boolean }> {
  const result = await runCommand(
    "git",
    [
      "-c",
      `safe.directory=${safeDirectory(integrationWorktree)}`,
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${path.join(worktreesRoot(), "empty-hooks")}`,
      "cherry-pick",
      taskCommit,
    ],
    { cwd: integrationWorktree, timeoutMs: 60_000 },
  );
  const unmerged = await git(
    integrationWorktree,
    ["diff", "--name-only", "--diff-filter=U"],
    { allowFailure: true },
  );
  if (unmerged.trim()) return { commit: "", conflict: true };
  if (result.exitCode !== 0) {
    throw new DuetError(
      result.stderr.trim() || "Cherry-pick failed.",
      "GIT_COMMAND_FAILED",
    );
  }
  return {
    commit: (await git(integrationWorktree, ["rev-parse", "HEAD"])).trim(),
    conflict: false,
  };
}

export async function abortCherryPick(worktree: string): Promise<void> {
  await git(worktree, ["cherry-pick", "--abort"], { allowFailure: true });
  await git(worktree, ["reset", "--merge"], { allowFailure: true });
}

export async function mergeRun(
  repoRoot: string,
  baseBranch: string,
  baseCommit: string,
  integrationBranch: string,
): Promise<string> {
  const current = await inspectRepository(repoRoot);
  requireClean(current);
  if (current.branch !== baseBranch || current.head !== baseCommit) {
    throw new DuetError(
      "Source branch moved after the run began.",
      "SOURCE_BRANCH_MOVED",
    );
  }
  await git(repoRoot, ["merge", "--ff-only", integrationBranch]);
  return (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
}
