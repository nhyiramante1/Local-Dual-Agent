import type {
  ReviewResult,
  RunRecord,
  TaskPlan,
  VerificationResult,
} from "../core/domain.js";

const jsonContract = `
Your complete trimmed final response must be exactly:
DUET_JSON_BEGIN
<one valid JSON object>
DUET_JSON_END
Do not add markdown fences, commentary, or another marker block.`;

export function planningPrompt(goal: string, maxTasks: number): string {
  return `You are the read-only planning lead for a local coding orchestrator.

Inspect the repository and decompose this goal into at most ${maxTasks} bounded
implementation tasks:

${goal}

Each task must have a stable short ID, observable acceptance criteria, explicit
dependencies, and narrow file ownership. allowedPaths accepts only exact
repository-relative paths such as "README.md" or recursive directory forms
such as "src/**". Other glob forms, absolute paths, "..", and .git are invalid.
Prefer independent scopes where sound. Do not edit any file or run Git writes.

Return:
{
  "summary": "short approach",
  "tasks": [{
    "id": "task-id",
    "title": "short title",
    "objective": "implementation objective",
    "acceptanceCriteria": ["observable criterion"],
    "allowedPaths": ["src/module/**", "README.md"],
    "dependencies": [],
    "preferredProvider": "claude" | "codex"
  }],
  "risks": ["specific risk"]
}
${jsonContract}`;
}

export function implementationPrompt(
  run: RunRecord,
  task: TaskPlan,
  patchOnly = false,
): string {
  const delivery = patchOnly
    ? `You have read-only repository access. Return the complete unified diff as
your entire trimmed final response:
DUET_PATCH_BEGIN
diff --git ...
DUET_PATCH_END
Do not add fences, summaries, or another marker block.`
    : `Edit files directly. If direct edits are unavailable, return only one
complete DUET_PATCH_BEGIN/DUET_PATCH_END unified-diff envelope.`;

  return `You are an implementation worker in an isolated Git worktree.

Goal:
${run.goal}

Assigned task:
${JSON.stringify(task, null, 2)}

Modify only these scopes:
${task.allowedPaths.map((item) => `- ${item}`).join("\n")}

Do not run Git commands, create commits, change branches, install dependencies,
access credentials, or use the network. The supervisor owns Git, tests, review,
and integration. Implement only this task.

${delivery}`;
}

export function reviewPrompt(
  run: RunRecord,
  task: TaskPlan,
  changedFiles: string[],
  diff: string,
  verification: VerificationResult[],
): string {
  return `You are the read-only cross-reviewer for one coding task.

Goal:
${run.goal}

Approved task:
${JSON.stringify(task, null, 2)}

Changed paths:
${changedFiles.map((item) => `- ${item}`).join("\n")}

Supervisor verification:
${JSON.stringify(
  verification.map((item) => ({
    command: item.command,
    passed: item.passed,
    exitCode: item.exitCode,
    stdoutTail: item.stdout.slice(-2_000),
    stderrTail: item.stderr.slice(-2_000),
  })),
  null,
  2,
)}

Canonical staged binary diff:
${diff}

Review correctness, regressions, security, scope, and missing tests. Request
changes only for concrete integration blockers. Do not edit repository files.

Return:
{
  "verdict": "approve" | "request_changes",
  "summary": "short assessment",
  "findings": [{
    "severity": "critical" | "high" | "medium" | "low",
    "file": "optional path",
    "description": "specific issue and expected fix",
    "required": true
  }]
}
${jsonContract}`;
}

export function revisionPrompt(
  review: ReviewResult,
  task: TaskPlan,
  patchOnly = false,
): string {
  const delivery = patchOnly
    ? `Return only the corrective unified diff between one
DUET_PATCH_BEGIN/DUET_PATCH_END marker pair.`
    : `Edit the files directly. If unavailable, return only one corrective
DUET_PATCH_BEGIN/DUET_PATCH_END unified-diff envelope.`;

  return `Revise the implementation to address the required findings.

Approved task and scope:
${JSON.stringify(task, null, 2)}

Review:
${JSON.stringify(review, null, 2)}

Do not run Git commands, install dependencies, access credentials, or use the
network. Make only necessary corrections.

${delivery}`;
}
