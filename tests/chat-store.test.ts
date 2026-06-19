import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DuetEvent, RunRecord, TaskRecord } from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";

async function withStore<T>(
  fn: (store: Store, file: string) => Promise<T> | T,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-chat-store-"));
  const file = path.join(directory, "state.sqlite");
  const store = new Store(file);
  try {
    await fn(store, file);
  } finally {
    try {
      store.close();
    } catch {
      // The test may have already closed it (restart scenario).
    }
    // Best-effort temp cleanup: Windows can hold the WAL -shm handle after
    // close (esp. in multi-connection migration tests). A leaked temp dir is
    // harmless; assertions already ran before teardown.
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      // ignore EBUSY/EPERM from a briefly-held SQLite handle
    }
  }
}

test("conversation and turn CRUD round-trips with ordered sequence", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
      title: "first",
    });
    assert.equal(conversation.interfaceAgent, "codex");
    assert.equal(conversation.status, "active");
    assert.equal(store.getConversation(conversation.id).id, conversation.id);

    const user = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "what is happening?",
    });
    const manager = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "manager",
      interfaceAgent: "codex",
      content: "two tasks are running.",
      usageJson: JSON.stringify({ costUsd: 0.02, costKnown: true }),
    });
    assert.equal(user.seq, 1);
    assert.equal(manager.seq, 2);

    const turns = store.listConversationTurns(conversation.id);
    assert.deepEqual(
      turns.map((t) => t.role),
      ["user", "manager"],
    );
    assert.equal(store.getConversationTurn(manager.id).content, "two tasks are running.");
    assert.equal(store.listConversations()[0].id, conversation.id);
  });
});

test("stored content is capped at write", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    const userTurn = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "u".repeat(25_000),
    });
    const managerTurn = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "manager",
      content: "m".repeat(150_000),
    });
    assert.equal(userTurn.content.length, 20_000);
    assert.equal(userTurn.truncated, true);
    assert.equal(userTurn.originalLength, 25_000);
    assert.equal(managerTurn.content.length, 100_000);
    assert.equal(managerTurn.truncated, true);
    assert.equal(managerTurn.originalLength, 150_000);

    const shortTurn = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "short",
    });
    assert.equal(shortTurn.truncated, false);
    assert.equal(shortTurn.originalLength, undefined);

    store.updateConversation(conversation.id, { summary: "s".repeat(25_000) });
    assert.equal(store.getConversation(conversation.id).summary?.length, 20_000);
  });
});

test("failed manager turns are stored with status and bounded error_json", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    const failed = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "manager",
      interfaceAgent: "codex",
      content: "",
      status: "failed",
      errorJson: JSON.stringify({
        code: "READ_ONLY_VIOLATION",
        message: "x".repeat(20_000),
      }),
    });
    assert.equal(failed.role, "manager");
    assert.equal(failed.status, "failed");
    assert.ok(failed.errorJson);
    assert.ok(failed.errorJson!.length <= 8_000);
  });
});

test("chat events carry a snippet only, never the full body", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    const body = "long manager reply ".repeat(1_000);
    const turn = store.appendConversationTurn({
      conversationId: conversation.id,
      role: "manager",
      interfaceAgent: "codex",
      content: body,
    });
    const events = store.listEvents({}) as DuetEvent[];
    const completed = events.find(
      (event) => event.type === "chat.turn.completed",
    );
    assert.ok(completed, "expected a chat.turn.completed event");
    const payload = completed!.payload as { snippet: string; turnId: string };
    assert.equal(payload.turnId, turn.id);
    assert.ok(payload.snippet.length <= 120);
    assert.ok(
      JSON.stringify(completed!.payload).length < body.length,
      "event payload must not include the full message body",
    );
  });
});

test("conversations and turns survive a service restart (re-open DB)", async () => {
  await withStore(async (store, file) => {
    const id = randomUUID();
    store.createConversation({ id, interfaceAgent: "codex", title: "kept" });
    store.appendConversationTurn({
      conversationId: id,
      role: "user",
      content: "remember me",
    });
    store.close();

    // Re-open the same database: the migration must be idempotent and data intact.
    const reopened = new Store(file);
    try {
      const conversation = reopened.getConversation(id);
      assert.equal(conversation.title, "kept");
      const turns = reopened.listConversationTurns(id);
      assert.equal(turns.length, 1);
      assert.equal(turns[0].content, "remember me");
    } finally {
      reopened.close();
    }
  });
});

test("v3 database upgrades to v4 without disturbing existing runs", async () => {
  await withStore((store, file) => {
    const stamp = new Date().toISOString();
    const run: RunRecord = {
      id: "legacy-run",
      repoPath: "/repo",
      repoRoot: "/repo",
      goal: "legacy goal",
      status: "awaiting_plan_approval",
      leadProvider: "claude",
      baseBranch: "main",
      baseCommit: "abc123",
      integrationBranch: "duet/legacy-run/integration",
      configJson: "{}",
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    store.createRun(run);
    const before = JSON.stringify(store.getRun("legacy-run"));
    store.close();

    // Simulate a pre-5A v3 database: chat tables absent, user_version = 3.
    const raw = new DatabaseSync(file);
    raw.exec(
      "PRAGMA foreign_keys = OFF; " +
        "DROP TABLE IF EXISTS manager_action_proposals; " +
        "DROP TABLE IF EXISTS conversation_turns; " +
        "DROP TABLE IF EXISTS conversations; " +
        "PRAGMA user_version = 3;",
    );
    raw.close();

    // Re-open with current code: migration adds the chat tables, bumps to v4,
    // and leaves the existing run byte-for-byte intact.
    const upgraded = new Store(file);
    try {
      assert.equal(JSON.stringify(upgraded.getRun("legacy-run")), before);
      const conversation = upgraded.createConversation({
        id: randomUUID(),
        runId: "legacy-run",
        interfaceAgent: "codex",
      });
      assert.equal(conversation.runId, "legacy-run");
    } finally {
      upgraded.close();
    }
  });
});

function seedRunWithTask(store: Store, runId = "run-1"): void {
  const stamp = "2026-06-01T00:00:00.000Z";
  const run: RunRecord = {
    id: runId,
    repoPath: "/repo",
    repoRoot: "/repo",
    goal: "seed goal",
    status: "running",
    leadProvider: "claude",
    baseBranch: "main",
    baseCommit: "abc0000",
    integrationBranch: `duet/${runId}/integration`,
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const task: TaskRecord = {
    runId,
    id: "task-1",
    ordinal: 0,
    plan: {
      id: "task-1",
      title: "Task one",
      objective: "do it",
      acceptanceCriteria: ["works"],
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
}

function seedProposalContext(store: Store): {
  conversationId: string;
  turnId: string;
} {
  seedRunWithTask(store);
  const conversation = store.createConversation({
    id: randomUUID(),
    runId: "run-1",
    interfaceAgent: "codex",
  });
  const turn = store.appendConversationTurn({
    conversationId: conversation.id,
    role: "manager",
    interfaceAgent: "codex",
    content: "I can retry task-1.",
  });
  return { conversationId: conversation.id, turnId: turn.id };
}

function futureIso(ms = 900_000): string {
  return new Date(Date.now() + ms).toISOString();
}

test("proposal CRUD links to conversation/turn and lists active only", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    const proposal = store.createProposal({
      id: randomUUID(),
      conversationId,
      turnId,
      runId: "run-1",
      taskId: "task-1",
      action: "retry_task",
      summary: "Retry task-1",
      commandCli: "duet retry run-1 task-1",
      commandJson: JSON.stringify({
        action: "retry_task",
        runId: "run-1",
        taskId: "task-1",
      }),
      tier: "ordinary",
      expiresAt: futureIso(),
    });
    assert.equal(proposal.status, "proposed");
    assert.equal(proposal.turnId, turnId);
    assert.equal(store.getProposal(proposal.id).action, "retry_task");
    assert.deepEqual(
      store.listProposals(conversationId).map((p) => p.id),
      [proposal.id],
    );
  });
});

test("listProposals filters expired without mutating; expireProposals persists status", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    const stale = store.createProposal({
      id: randomUUID(),
      conversationId,
      turnId,
      runId: "run-1",
      action: "execute_run",
      summary: "Run it",
      commandCli: "duet run run-1",
      commandJson: JSON.stringify({ action: "execute_run", runId: "run-1" }),
      tier: "ordinary",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    assert.equal(store.listProposals(conversationId).length, 0);
    assert.equal(store.getProposal(stale.id).status, "proposed");
    assert.equal(store.expireProposals(), 1);
    assert.equal(store.getProposal(stale.id).status, "expired");
  });
});

test("dismiss verifies conversation ownership", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    const proposal = store.createProposal({
      id: randomUUID(),
      conversationId,
      turnId,
      runId: "run-1",
      action: "merge_run",
      summary: "Merge",
      commandCli: "duet merge run-1",
      commandJson: JSON.stringify({ action: "merge_run", runId: "run-1" }),
      tier: "fingerprint",
      expiresAt: futureIso(),
    });
    assert.throws(
      () => store.dismissProposal("not-this-conversation", proposal.id),
      /not in conversation|PROPOSAL_NOT_FOUND/,
    );
    store.dismissProposal(conversationId, proposal.id);
    assert.equal(store.getProposal(proposal.id).status, "dismissed");
    assert.equal(store.listProposals(conversationId).length, 0);
  });
});

test("createProposal rejects unknown run/task references", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    assert.throws(() =>
      store.createProposal({
        id: randomUUID(),
        conversationId,
        turnId,
        runId: "missing-run",
        action: "execute_run",
        summary: "x",
        commandCli: "duet run missing-run",
        commandJson: "{}",
        tier: "ordinary",
        expiresAt: futureIso(),
      }),
    );
    assert.throws(() =>
      store.createProposal({
        id: randomUUID(),
        conversationId,
        turnId,
        runId: "run-1",
        taskId: "missing-task",
        action: "retry_task",
        summary: "x",
        commandCli: "duet retry run-1 missing-task",
        commandJson: "{}",
        tier: "ordinary",
        expiresAt: futureIso(),
      }),
    );
  });
});

test("createProposal rejects turn from another conversation", async () => {
  await withStore((store) => {
    seedRunWithTask(store);
    const convA = store.createConversation({
      id: randomUUID(),
      runId: "run-1",
      interfaceAgent: "codex",
    });
    const convB = store.createConversation({
      id: randomUUID(),
      runId: "run-1",
      interfaceAgent: "codex",
    });
    const turnFromB = store.appendConversationTurn({
      conversationId: convB.id,
      role: "user",
      content: "hi",
    });
    assert.throws(
      () =>
        store.createProposal({
          id: randomUUID(),
          conversationId: convA.id,
          turnId: turnFromB.id,
          runId: "run-1",
          action: "execute_run",
          summary: "x",
          commandCli: "duet run run-1",
          commandJson: "{}",
          tier: "ordinary",
          expiresAt: futureIso(),
        }),
      /does not belong to conversation|INVALID_PROPOSAL/,
    );
  });
});

test("createProposal rejects run that mismatches conversation run", async () => {
  await withStore((store) => {
    seedRunWithTask(store, "run-1");
    seedRunWithTask(store, "run-2");
    const conv = store.createConversation({
      id: randomUUID(),
      runId: "run-1",
      interfaceAgent: "codex",
    });
    const turn = store.appendConversationTurn({
      conversationId: conv.id,
      role: "user",
      content: "hi",
    });
    assert.throws(
      () =>
        store.createProposal({
          id: randomUUID(),
          conversationId: conv.id,
          turnId: turn.id,
          runId: "run-2",
          action: "execute_run",
          summary: "x",
          commandCli: "duet run run-2",
          commandJson: "{}",
          tier: "ordinary",
          expiresAt: futureIso(),
        }),
      /does not match conversation run|INVALID_PROPOSAL/,
    );
  });
});

test("createProposal rejects unknown action and tier", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    assert.throws(
      () =>
        store.createProposal({
          id: randomUUID(),
          conversationId,
          turnId,
          action: "do_something_evil" as never,
          summary: "x",
          commandCli: "rm -rf /",
          commandJson: "{}",
          tier: "ordinary",
          expiresAt: futureIso(),
        }),
      /Unknown proposal action|INVALID_PROPOSAL/,
    );
    assert.throws(
      () =>
        store.createProposal({
          id: randomUUID(),
          conversationId,
          turnId,
          action: "execute_run",
          summary: "x",
          commandCli: "duet run run-1",
          commandJson: "{}",
          tier: "nuclear" as never,
          expiresAt: futureIso(),
        }),
      /Unknown proposal tier|INVALID_PROPOSAL/,
    );
  });
});

test("createProposal rejects malformed expiresAt", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    assert.throws(
      () =>
        store.createProposal({
          id: randomUUID(),
          conversationId,
          turnId,
          action: "execute_run",
          summary: "x",
          commandCli: "duet run run-1",
          commandJson: "{}",
          tier: "ordinary",
          expiresAt: "not-a-date",
        }),
      /valid ISO|INVALID_PROPOSAL/,
    );
  });
});

test("dismiss is idempotent: second call does not emit a duplicate event", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    const proposal = store.createProposal({
      id: randomUUID(),
      conversationId,
      turnId,
      runId: "run-1",
      action: "cancel_run",
      summary: "Cancel",
      commandCli: "duet cancel run-1",
      commandJson: JSON.stringify({ action: "cancel_run", runId: "run-1" }),
      tier: "ordinary",
      expiresAt: futureIso(),
    });
    store.dismissProposal(conversationId, proposal.id);
    store.dismissProposal(conversationId, proposal.id);
    const dismissEvents = (store.listEvents({}) as DuetEvent[]).filter(
      (e) => e.type === "chat.proposal.dismissed",
    );
    assert.equal(dismissEvents.length, 1, "exactly one dismiss event");
    assert.equal(store.getProposal(proposal.id).status, "dismissed");
  });
});

test("oversized commandCli and commandJson are capped at storage", async () => {
  await withStore((store) => {
    const { conversationId, turnId } = seedProposalContext(store);
    const proposal = store.createProposal({
      id: randomUUID(),
      conversationId,
      turnId,
      runId: "run-1",
      action: "execute_run",
      summary: "x",
      commandCli: "x".repeat(5_000),
      commandJson: "y".repeat(10_000),
      tier: "ordinary",
      expiresAt: futureIso(),
    });
    assert.ok(
      proposal.commandCli.length <= 1_000,
      "commandCli must be capped at 1000",
    );
    assert.ok(
      proposal.commandJson.length <= 4_000,
      "commandJson must be capped at 4000",
    );
  });
});

test("v4 database upgrades to v5 without disturbing existing chat/runs", async () => {
  await withStore((store, file) => {
    seedRunWithTask(store);
    const conversation = store.createConversation({
      id: "conv-keep",
      runId: "run-1",
      interfaceAgent: "codex",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "keep me",
    });
    const before = JSON.stringify(store.getConversation("conv-keep"));
    store.close();

    // Simulate a pre-5B v4 database: proposals table absent, user_version = 4.
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE manager_action_proposals; PRAGMA user_version = 4;");
    raw.close();

    const upgraded = new Store(file);
    try {
      assert.equal(
        JSON.stringify(upgraded.getConversation("conv-keep")),
        before,
      );
      const turn = upgraded.listConversationTurns("conv-keep")[0];
      const proposal = upgraded.createProposal({
        id: randomUUID(),
        conversationId: "conv-keep",
        turnId: turn.id,
        runId: "run-1",
        action: "execute_run",
        summary: "run",
        commandCli: "duet run run-1",
        commandJson: "{}",
        tier: "ordinary",
        expiresAt: futureIso(),
      });
      assert.equal(proposal.status, "proposed");
    } finally {
      upgraded.close();
    }
  });
});
