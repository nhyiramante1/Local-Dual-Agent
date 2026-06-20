import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseProposalBlock,
  tryValidateAndSynthesize,
} from "../src/chat/proposals.js";
import type {
  ConversationRecord,
  RunRecord,
  TaskRecord,
} from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";

async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-proposals-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    await fn(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function seed(store: Store): ConversationRecord {
  const stamp = "2026-06-01T00:00:00.000Z";
  const run: RunRecord = {
    id: "run-1",
    repoPath: "/repo",
    repoRoot: "/repo",
    goal: "seed goal",
    status: "running",
    leadProvider: "codex",
    baseBranch: "main",
    baseCommit: "abc",
    integrationBranch: "duet/run-1/integration",
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const task: TaskRecord = {
    runId: run.id,
    id: "task-1",
    ordinal: 0,
    plan: {
      id: "task-1",
      title: "Task",
      objective: "Do it",
      acceptanceCriteria: ["done"],
      allowedPaths: ["src/**"],
      dependencies: [],
    },
    status: "ready",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.createRun(run, [task]);
  return store.createConversation({
    id: randomUUID(),
    runId: run.id,
    interfaceAgent: "codex",
  });
}

test("parseProposalBlock returns none when no proposal block exists", () => {
  assert.deepEqual(parseProposalBlock("plain answer"), { kind: "none" });
});

test("parseProposalBlock accepts one final proposal block and strips it", () => {
  const parsed = parseProposalBlock(
    [
      "I can retry this task.",
      "",
      "```duet-proposal",
      '{"action":"retry_task","runId":"run-1","taskId":"task-1","rationale":"try again"}',
      "```",
    ].join("\n"),
  );
  assert.equal(parsed.kind, "parsed");
  if (parsed.kind !== "parsed") return;
  assert.equal(parsed.strippedText, "I can retry this task.");
  assert.equal(parsed.raw.action, "retry_task");
  assert.equal(parsed.raw.runId, "run-1");
  assert.equal(parsed.raw.taskId, "task-1");
  assert.equal(parsed.raw.rationale, "try again");
});

test("parseProposalBlock rejects duplicate, nested, trailing, and malformed blocks", () => {
  assert.equal(
    parseProposalBlock(
      "```duet-proposal\n{}\n```\n```duet-proposal\n{}\n```",
    ).kind,
    "invalid",
  );
  assert.equal(
    parseProposalBlock("```duet-proposal\n{\"action\":\"execute_run\",\"x\":\"```\"}\n```")
      .kind,
    "invalid",
  );
  assert.equal(
    parseProposalBlock(
      "```duet-proposal\n{\"action\":\"execute_run\"}\n```\ntrailing",
    ).kind,
    "invalid",
  );
  assert.equal(parseProposalBlock("```duet-proposal\nnot-json\n```").kind, "invalid");
});

test("tryValidateAndSynthesize ignores model command fields and uses templates", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    const proposal = tryValidateAndSynthesize(
      {
        action: "retry_task",
        runId: "run-1",
        taskId: "task-1",
        rationale: "retry safely",
        command: "rm -rf /",
        commandCli: "rm -rf /",
        cli: "rm -rf /",
        tier: "fingerprint",
        commandJson: "{\"evil\":true}",
      } as never,
      conversation,
      store,
    );
    assert.ok(proposal);
    assert.equal(proposal.commandCli, "duet retry run-1 task-1");
    assert.equal(
      proposal.commandJson,
      JSON.stringify({ action: "retry_task", runId: "run-1", taskId: "task-1" }),
    );
    assert.equal(proposal.tier, "ordinary");
  });
});

test("tryValidateAndSynthesize rejects unknown actions and invalid IDs", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    assert.equal(
      tryValidateAndSynthesize(
        { action: "create_plan", runId: "run-1" },
        conversation,
        store,
      ),
      null,
    );
    assert.equal(
      tryValidateAndSynthesize(
        { action: "execute_run", runId: "missing" },
        conversation,
        store,
      ),
      null,
    );
    assert.equal(
      tryValidateAndSynthesize(
        { action: "retry_task", runId: "run-1", taskId: "missing" },
        conversation,
        store,
      ),
      null,
    );
  });
});

test("tryValidateAndSynthesize assigns fingerprint tiers to approval and merge actions", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    for (const action of ["approve_plan", "approve_merge", "merge_run"] as const) {
      const proposal = tryValidateAndSynthesize(
        { action, runId: "run-1" },
        conversation,
        store,
      );
      assert.ok(proposal);
      assert.equal(proposal.tier, "fingerprint");
    }
  });
});
