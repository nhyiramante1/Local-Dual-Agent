import { createHash } from "node:crypto";

import type { RunRecord, TaskRecord } from "../core/domain.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function hashObject(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function approvalBinding(
  run: RunRecord,
  tasks: TaskRecord[],
  stage: "plan" | "merge",
): string {
  if (stage === "plan") {
    return hashObject({
      stage,
      plan: run.plan,
      config: JSON.parse(run.configJson) as unknown,
      repoRoot: run.repoRoot,
      baseBranch: run.baseBranch,
      baseCommit: run.baseCommit,
      scopes: tasks.map((task) => ({
        id: task.id,
        allowedPaths: task.plan.allowedPaths,
        dependencies: task.plan.dependencies,
        syntheticDependencies: task.plan.syntheticDependencies ?? [],
      })),
    });
  }
  return hashObject({
    stage,
    repoRoot: run.repoRoot,
    sourceBranch: run.baseBranch,
    sourceHead: run.baseCommit,
    integrationBranch: run.integrationBranch,
    integrationCommit: run.finalCommit,
    tasks: tasks.map((task) => ({
      id: task.id,
      taskCommit: task.taskCommit,
      integratedCommit: task.integratedCommit,
      treeId: task.reviewedArtifact?.treeId,
      diffHash: task.reviewedArtifact?.diffHash,
    })),
  });
}
