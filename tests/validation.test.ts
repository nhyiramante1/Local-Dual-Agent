import assert from "node:assert/strict";
import test from "node:test";

import {
  scopesOverlap,
  validateRunPlan,
} from "../src/providers/validation.js";

test("plan rejects repository escape and unsupported glob scopes", () => {
  for (const scope of ["../outside.txt", ".git/config", "src/*.ts", "**/*"]) {
    assert.throws(
      () =>
        validateRunPlan({
          summary: "unsafe",
          tasks: [
            {
              id: "task",
              title: "unsafe",
              objective: "unsafe",
              acceptanceCriteria: ["one"],
              allowedPaths: [scope],
              dependencies: [],
            },
          ],
          risks: [],
        }),
      /unsafe file scope/,
    );
  }
});

test("overlapping writers receive deterministic synthetic dependencies", () => {
  const plan = validateRunPlan({
    summary: "overlap",
    tasks: [
      {
        id: "b",
        title: "B",
        objective: "B",
        acceptanceCriteria: ["B"],
        allowedPaths: ["src/**"],
        dependencies: [],
      },
      {
        id: "a",
        title: "A",
        objective: "A",
        acceptanceCriteria: ["A"],
        allowedPaths: ["src/index.ts"],
        dependencies: [],
      },
    ],
    risks: [],
  });
  const taskB = plan.tasks.find((task) => task.id === "b")!;
  assert.deepEqual(taskB.syntheticDependencies, ["a"]);
  assert.deepEqual(taskB.dependencies, ["a"]);
});

test("scope overlap handles exact and recursive ownership", () => {
  assert.equal(scopesOverlap(["src/**"], ["src/a.ts"]), true);
  assert.equal(scopesOverlap(["src/**"], ["tests/**"]), false);
  assert.equal(scopesOverlap(["README.md"], ["README.md"]), true);
});

test("a six-task DAG validates in stable dependency order", () => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `Task ${index + 1}`,
    objective: "test",
    acceptanceCriteria: ["pass"],
    allowedPaths: [`part-${index + 1}.txt`],
    dependencies: index === 0 ? [] : [`task-${index}`],
  }));
  const plan = validateRunPlan({
    summary: "six",
    tasks,
    risks: [],
  });
  assert.equal(plan.tasks.length, 6);
  assert.deepEqual(plan.tasks[5].dependencies, ["task-5"]);
});
