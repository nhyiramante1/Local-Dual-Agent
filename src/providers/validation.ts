import type {
  ReviewResult,
  RunPlan,
  TaskPlan,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";

function stringArray(value: unknown, allowEmpty = false): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export function safePathScope(pattern: string): boolean {
  const normalized = pattern.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const wildcardIndex = normalized.indexOf("*");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalized) &&
    !segments.includes("..") &&
    !segments.includes(".git") &&
    !normalized.includes("//") &&
    (wildcardIndex === -1 ||
      (normalized.endsWith("/**") &&
        wildcardIndex === normalized.length - 2))
  );
}

function scopeRoot(scope: string): { path: string; recursive: boolean } {
  const normalized = scope.replaceAll("\\", "/");
  return normalized.endsWith("/**")
    ? { path: normalized.slice(0, -3), recursive: true }
    : { path: normalized, recursive: false };
}

export function scopesOverlap(left: string[], right: string[]): boolean {
  return left.some((leftScope) =>
    right.some((rightScope) => {
      const a = scopeRoot(leftScope);
      const b = scopeRoot(rightScope);
      if (!a.recursive && !b.recursive) return a.path === b.path;
      if (a.recursive && b.recursive) {
        return (
          a.path === b.path ||
          a.path.startsWith(`${b.path}/`) ||
          b.path.startsWith(`${a.path}/`)
        );
      }
      const directory = a.recursive ? a.path : b.path;
      const file = a.recursive ? b.path : a.path;
      return file === directory || file.startsWith(`${directory}/`);
    }),
  );
}

function validateTask(task: unknown): TaskPlan {
  const candidate = task as Partial<TaskPlan>;
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/i.test(candidate.id) ||
    typeof candidate.title !== "string" ||
    typeof candidate.objective !== "string" ||
    !stringArray(candidate.acceptanceCriteria) ||
    !stringArray(candidate.allowedPaths) ||
    !stringArray(candidate.dependencies, true) ||
    (candidate.preferredProvider !== undefined &&
      candidate.preferredProvider !== "claude" &&
      candidate.preferredProvider !== "codex")
  ) {
    throw new DuetError(
      "Planning agent returned an invalid task schema.",
      "INVALID_PLAN",
    );
  }
  if (!candidate.allowedPaths.every(safePathScope)) {
    throw new DuetError(
      "Plan contains an unsafe file scope. Use exact paths or directory/**; absolute paths, '..', .git, and other globs are forbidden.",
      "UNSAFE_PLAN_SCOPE",
    );
  }
  return {
    id: candidate.id,
    title: candidate.title,
    objective: candidate.objective,
    acceptanceCriteria: candidate.acceptanceCriteria,
    allowedPaths: candidate.allowedPaths.map((item) =>
      item.replaceAll("\\", "/"),
    ),
    dependencies: candidate.dependencies,
    preferredProvider: candidate.preferredProvider,
    syntheticDependencies: [],
  };
}

function stableTopological(tasks: TaskPlan[]): TaskPlan[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Map(
    tasks.map((task) => [task.id, new Set(task.dependencies)]),
  );
  const ordered: TaskPlan[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort();
    if (ready.length === 0) {
      throw new DuetError("Task dependency graph contains a cycle.", "INVALID_PLAN");
    }
    for (const id of ready) {
      ordered.push(byId.get(id)!);
      remaining.delete(id);
      for (const dependencies of remaining.values()) dependencies.delete(id);
    }
  }
  return ordered;
}

export function validateRunPlan(
  value: unknown,
  maxTasks = 6,
): RunPlan {
  const candidate = value as Partial<RunPlan>;
  if (
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.tasks) ||
    candidate.tasks.length < 1 ||
    candidate.tasks.length > maxTasks ||
    !stringArray(candidate.risks, true)
  ) {
    throw new DuetError(
      `Planning agent must return between 1 and ${maxTasks} tasks.`,
      "INVALID_PLAN",
    );
  }
  const tasks = candidate.tasks.map(validateTask);
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    throw new DuetError("Task IDs must be unique.", "INVALID_PLAN");
  }
  for (const task of tasks) {
    const invalid = task.dependencies.filter(
      (dependency) => dependency === task.id || !ids.has(dependency),
    );
    if (invalid.length > 0) {
      throw new DuetError(
        `Task ${task.id} has invalid dependencies: ${invalid.join(", ")}`,
        "INVALID_PLAN",
      );
    }
  }

  const ordered = stableTopological(tasks);
  for (let later = 0; later < ordered.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      const predecessor = ordered[earlier];
      const task = ordered[later];
      if (
        scopesOverlap(predecessor.allowedPaths, task.allowedPaths) &&
        !task.dependencies.includes(predecessor.id)
      ) {
        task.dependencies.push(predecessor.id);
        task.syntheticDependencies!.push(predecessor.id);
      }
    }
  }
  stableTopological(tasks);
  return {
    summary: candidate.summary,
    tasks,
    risks: candidate.risks,
  };
}

export function validateReview(value: unknown): ReviewResult {
  const review = value as Partial<ReviewResult>;
  if (
    (review.verdict !== "approve" &&
      review.verdict !== "request_changes") ||
    typeof review.summary !== "string" ||
    !Array.isArray(review.findings) ||
    !review.findings.every(
      (finding) =>
        finding &&
        ["critical", "high", "medium", "low"].includes(finding.severity) &&
        typeof finding.description === "string" &&
        typeof finding.required === "boolean" &&
        (finding.file === undefined || typeof finding.file === "string"),
    )
  ) {
    throw new DuetError(
      "Reviewing agent returned an invalid review schema.",
      "INVALID_REVIEW",
    );
  }
  return review as ReviewResult;
}
