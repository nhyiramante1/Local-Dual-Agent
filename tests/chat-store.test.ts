import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DuetEvent, RunRecord } from "../src/core/domain.js";
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
    await rm(directory, { recursive: true, force: true });
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
      "DROP TABLE conversation_turns; DROP TABLE conversations; PRAGMA user_version = 3;",
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
