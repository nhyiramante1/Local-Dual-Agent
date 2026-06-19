import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { DuetEvent, OperationRecord, ProviderName, RunRecord } from "../src/core/domain.js";
import { DuetError } from "../src/core/errors.js";
import { Store } from "../src/persistence/store.js";
import type { AgentTurn, ProviderAdapter } from "../src/providers/adapter.js";
import { defaultManagerBudget, type ManagerBudget } from "../src/chat/engine.js";
import { dashboardHtml, dashboardJs } from "../src/dashboard/assets.js";
import { DuetService } from "../src/service/server.js";
import { runCommand } from "../src/process/run-command.js";

const secret = "chat-test-secret";

interface Harness {
  base: string;
  store: Store;
  service: DuetService;
  calls: { n: number };
  cleanup: () => Promise<void>;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startService(options: {
  fail?: boolean;
  text?: string;
  managerBudget?: ManagerBudget;
  onProviderRun?: (turn: AgentTurn) => Promise<void> | void;
} = {}): Promise<Harness> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-chat-svc-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const calls = { n: 0 };
  const provider: ProviderAdapter = {
    name: "codex" as ProviderName,
    async run(turn) {
      calls.n += 1;
      await options.onProviderRun?.(turn);
      if (options.fail) {
        throw new DuetError(`provider failed: ${"x".repeat(5_000)}`, "CODEX_FAILED");
      }
      return {
        provider: "codex",
        sessionId: "sess-1",
        finalText: options.text ?? "manager reply",
        stdout: "",
        stderr: "",
        durationMs: 3,
        usage: { costUsd: 0.01, costKnown: true, inputTokens: 100, outputTokens: 50 },
      };
    },
  };
  const service = new DuetService({
    store,
    secret,
    instanceId: "chat-instance",
    idleTimeoutMs: 60_000,
    chatProviders: { claude: provider, codex: provider },
    managerBudget: options.managerBudget,
  });
  const port = await service.listen();
  return {
    base: `http://127.0.0.1:${port}`,
    store,
    service,
    calls,
    cleanup: async () => {
      await service.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
}

function bearer(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function postConversation(
  base: string,
  body: Record<string, unknown>,
  key: string,
  headers: Record<string, string> = bearer(),
): Promise<Response> {
  const response = await fetch(`${base}/api/v1/chat/conversations`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": key },
    body: JSON.stringify(body),
  });
  return response;
}

async function createConversation(
  base: string,
  body: Record<string, unknown> = { interfaceAgent: "codex" },
): Promise<string> {
  const response = await postConversation(
    base,
    body,
    `conversation-${randomUUID()}`,
  );
  assert.equal(response.status, 201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function postTurn(
  base: string,
  conversationId: string,
  message: string,
  key: string,
  headers: Record<string, string> = bearer(),
): Promise<Response> {
  return await fetch(
    `${base}/api/v1/chat/conversations/${conversationId}/turns`,
    {
      method: "POST",
      headers: { ...headers, "idempotency-key": key },
      body: JSON.stringify({ message }),
    },
  );
}

async function sessionCookie(base: string): Promise<string> {
  const ticketRes = await fetch(`${base}/api/v1/dashboard/ticket`, {
    method: "POST",
    headers: bearer(),
    body: "{}",
  });
  const ticket = ((await ticketRes.json()) as { data: { ticket: string } }).data
    .ticket;
  const exchange = await fetch(`${base}/dashboard/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  const cookie = exchange.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie!.split(";")[0];
}

test("conversation creation is idempotent and validates run links", async () => {
  const h = await startService();
  try {
    const first = await postConversation(
      h.base,
      { interfaceAgent: "codex", title: "same" },
      "convkey-1",
    );
    assert.equal(first.status, 201);
    const conversation1 = ((await first.json()) as { data: { id: string } })
      .data;

    const second = await postConversation(
      h.base,
      { interfaceAgent: "codex", title: "same" },
      "convkey-1",
    );
    assert.equal(second.status, 201);
    const conversation2 = ((await second.json()) as { data: { id: string } })
      .data;
    assert.equal(conversation2.id, conversation1.id);
    assert.equal(h.store.listConversations().length, 1);

    const conflict = await postConversation(
      h.base,
      { interfaceAgent: "claude", title: "changed" },
      "convkey-1",
    );
    assert.equal(conflict.status, 409);

    const missingRun = await postConversation(
      h.base,
      { interfaceAgent: "codex", runId: "missing-run" },
      "convkey-2",
    );
    assert.equal(missingRun.status, 404);
    assert.equal(h.store.listConversations().length, 1);
  } finally {
    await h.cleanup();
  }
});

test("same idempotency key returns the same operation and calls provider once", async () => {
  const h = await startService();
  try {
    const conversationId = await createConversation(h.base);
    const first = await postTurn(h.base, conversationId, "what is happening?", "chatkey-1");
    assert.equal(first.status, 202);
    const op1 = ((await first.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op1.id);

    const second = await postTurn(h.base, conversationId, "what is happening?", "chatkey-1");
    assert.equal(second.status, 202);
    const op2 = ((await second.json()) as { data: OperationRecord }).data;

    assert.equal(op2.id, op1.id);
    assert.equal(h.calls.n, 1);
  } finally {
    await h.cleanup();
  }
});

test("same idempotency key with a different body conflicts", async () => {
  const h = await startService();
  try {
    const conversationId = await createConversation(h.base);
    const first = await postTurn(h.base, conversationId, "alpha", "chatkey-2");
    assert.equal(first.status, 202);
    await h.service.chat.wait(
      ((await first.json()) as { data: OperationRecord }).data.id,
    );
    const second = await postTurn(h.base, conversationId, "beta", "chatkey-2");
    assert.equal(second.status, 409);
  } finally {
    await h.cleanup();
  }
});

test("active conversations reject overlapping manager turns", async () => {
  const started = deferred();
  const release = deferred();
  const h = await startService({
    onProviderRun: async () => {
      started.resolve();
      await release.promise;
    },
  });
  try {
    const conversationId = await createConversation(h.base);
    const first = await postTurn(h.base, conversationId, "first", "chatkey-active-1");
    assert.equal(first.status, 202);
    const op1 = ((await first.json()) as { data: OperationRecord }).data;
    await started.promise;

    const second = await postTurn(
      h.base,
      conversationId,
      "second",
      "chatkey-active-2",
    );
    assert.equal(second.status, 409);
    const body = (await second.json()) as {
      error: { code: string };
    };
    assert.equal(body.error.code, "CHAT_TURN_ACTIVE");
    assert.equal(h.calls.n, 1);

    release.resolve();
    await h.service.chat.wait(op1.id);
  } finally {
    release.resolve();
    await h.cleanup();
  }
});

test("budget cap blocks before the provider is called", async () => {
  const h = await startService({
    managerBudget: { ...defaultManagerBudget, maxTurnsPerDay: 0 },
  });
  try {
    const conversationId = await createConversation(h.base);
    const response = await postTurn(h.base, conversationId, "hi", "chatkey-3");
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    assert.equal(h.calls.n, 0); // provider never invoked
    const operation = h.store.getOperation(op.id);
    assert.equal(operation.status, "failed");
    assert.match(operation.errorJson ?? "", /BUDGET_EXCEEDED/);
    const turns = h.store.listConversationTurns(conversationId);
    const manager = turns.find((t) => t.role === "manager");
    assert.equal(manager?.status, "failed");
  } finally {
    await h.cleanup();
  }
});

test("active manager turns reserve the shared daily turn budget", async () => {
  const started = deferred();
  const release = deferred();
  const h = await startService({
    managerBudget: { ...defaultManagerBudget, maxTurnsPerDay: 1 },
    onProviderRun: async () => {
      started.resolve();
      await release.promise;
    },
  });
  try {
    const codexConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
    });
    const claudeConversation = await createConversation(h.base, {
      interfaceAgent: "claude",
    });

    const first = await postTurn(
      h.base,
      codexConversation,
      "first",
      "chatkey-budget-reserve-1",
    );
    assert.equal(first.status, 202);
    const op1 = ((await first.json()) as { data: OperationRecord }).data;
    await started.promise;

    const second = await postTurn(
      h.base,
      claudeConversation,
      "second",
      "chatkey-budget-reserve-2",
    );
    assert.equal(second.status, 202);
    const op2 = ((await second.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op2.id);

    assert.equal(h.calls.n, 1);
    const operation = h.store.getOperation(op2.id);
    assert.equal(operation.status, "failed");
    assert.match(operation.errorJson ?? "", /BUDGET_EXCEEDED/);

    release.resolve();
    await h.service.chat.wait(op1.id);
  } finally {
    release.resolve();
    await h.cleanup();
  }
});

test("codex token budget cap blocks before the provider is called", async () => {
  const h = await startService({
    managerBudget: {
      ...defaultManagerBudget,
      codexMaxOutputTokensPerDay: 10,
    },
  });
  try {
    const conversationId = await createConversation(h.base);
    h.store.appendConversationTurn({
      conversationId,
      role: "manager",
      interfaceAgent: "codex",
      content: "prior answer",
      usageJson: JSON.stringify({ inputTokens: 1, outputTokens: 10 }),
    });

    const response = await postTurn(
      h.base,
      conversationId,
      "will this spend?",
      "chatkey-codex-budget",
    );
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    assert.equal(h.calls.n, 0);
    const operation = h.store.getOperation(op.id);
    assert.equal(operation.status, "failed");
    assert.match(operation.errorJson ?? "", /BUDGET_EXCEEDED/);
  } finally {
    await h.cleanup();
  }
});

test("run-scoped manager turns fail if the provider writes to the repository", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "duet-chat-repo-"));
  let h: Harness | undefined;
  try {
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Duet Test"]);
    await git(repo, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(repo, "file.txt"), "base\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "base"]);
    const baseCommit = await git(repo, ["rev-parse", "HEAD"]);

    h = await startService({
      onProviderRun: async (turn) => {
        await writeFile(path.join(turn.cwd, "provider-write.txt"), "changed\n");
      },
    });
    const stamp = new Date().toISOString();
    const run: RunRecord = {
      id: "chat-run",
      repoPath: repo,
      repoRoot: repo,
      goal: "chat about the repo",
      status: "awaiting_plan_approval",
      leadProvider: "codex",
      baseBranch: "main",
      baseCommit,
      integrationBranch: "duet/chat-run/integration",
      configJson: "{}",
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    h.store.createRun(run);

    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "chat-run",
    });
    const response = await postTurn(
      h.base,
      conversationId,
      "inspect safely",
      "chatkey-readonly",
    );
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    assert.equal(h.calls.n, 1);
    const operation = h.store.getOperation(op.id);
    assert.equal(operation.status, "failed");
    assert.match(operation.errorJson ?? "", /READ_ONLY_VIOLATION/);
    assert.equal(operation.runId, "chat-run");
    assert.ok(
      h.store
        .listEvents({ runId: "chat-run" })
        .some(
          (event) =>
            event.type === "operation.created" && event.operationId === op.id,
        ),
      "run-filtered events include manager_turn operation lifecycle",
    );
    const turns = h.store.listConversationTurns(conversationId);
    const failed = turns.find((turn) => turn.role === "manager");
    assert.equal(failed?.status, "failed");
  } finally {
    if (h) await h.cleanup();
    await rm(repo, { recursive: true, force: true });
  }
});

test("provider failure stores a failed manager turn with bounded operation error", async () => {
  const h = await startService({ fail: true });
  try {
    const conversationId = await createConversation(h.base);
    const response = await postTurn(h.base, conversationId, "hi", "chatkey-4");
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    assert.equal(h.calls.n, 1);
    const operation = h.store.getOperation(op.id);
    assert.equal(operation.status, "failed");
    // operation error is bounded so operation.* events cannot leak a giant error
    const parsed = JSON.parse(operation.errorJson!) as { message: string };
    assert.ok(parsed.message.length <= 520);

    const turns = h.store.listConversationTurns(conversationId);
    const manager = turns.find((t) => t.role === "manager");
    assert.equal(manager?.status, "failed");
    assert.ok(manager?.errorJson);
  } finally {
    await h.cleanup();
  }
});

test("an interrupted manager operation does not corrupt prior turns", async () => {
  const h = await startService();
  try {
    const conversationId = await createConversation(h.base);
    h.store.appendConversationTurn({
      conversationId,
      role: "user",
      content: "earlier question",
    });
    h.store.appendConversationTurn({
      conversationId,
      role: "manager",
      interfaceAgent: "codex",
      content: "earlier answer",
    });
    // Simulate an in-flight manager_turn from a previous service instance.
    h.store.createOperation({
      id: randomUUID(),
      kind: "manager_turn",
      status: "running",
      serviceInstanceId: "previous-instance",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });
    const interrupted = h.store.interruptActiveOperations("current-instance");
    assert.equal(interrupted, 1);

    const turns = h.store.listConversationTurns(conversationId);
    assert.deepEqual(
      turns.map((t) => `${t.role}:${t.content}`),
      ["user:earlier question", "manager:earlier answer"],
    );
  } finally {
    await h.cleanup();
  }
});

test("chat API rejects malformed message and interface agent values", async () => {
  const h = await startService();
  try {
    const badAgent = await postConversation(
      h.base,
      { interfaceAgent: "assistant" },
      "chatkey-bad-agent",
    );
    assert.equal(badAgent.status, 400);

    const conversationId = await createConversation(h.base);
    const badMessage = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/turns`,
      {
        method: "POST",
        headers: { ...bearer(), "idempotency-key": "chatkey-bad-message" },
        body: JSON.stringify({ message: { nested: true } }),
      },
    );
    assert.equal(badMessage.status, 400);
    assert.equal(h.calls.n, 0);
    assert.equal(h.store.listActiveOperations().length, 0);
  } finally {
    await h.cleanup();
  }
});

test("force stop cancels active manager turns without cancelling the run", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "duet-chat-cancel-repo-"));
  const started = deferred();
  let h: Harness | undefined;
  try {
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Duet Test"]);
    await git(repo, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(repo, "file.txt"), "base\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "base"]);
    const baseCommit = await git(repo, ["rev-parse", "HEAD"]);

    h = await startService({
      onProviderRun: async (turn) => {
        started.resolve();
        while (!turn.shouldCancel?.()) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      },
    });
    const stamp = new Date().toISOString();
    const run: RunRecord = {
      id: "chat-cancel-run",
      repoPath: repo,
      repoRoot: repo,
      goal: "chat cancellation",
      status: "awaiting_plan_approval",
      leadProvider: "codex",
      baseBranch: "main",
      baseCommit,
      integrationBranch: "duet/chat-cancel-run/integration",
      configJson: "{}",
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    h.store.createRun(run);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "chat-cancel-run",
    });
    const response = await postTurn(
      h.base,
      conversationId,
      "please wait",
      "chatkey-cancel-turn",
    );
    assert.equal(response.status, 202);
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await started.promise;

    const stop = await fetch(`${h.base}/api/v1/service/stop`, {
      method: "POST",
      headers: bearer(),
      body: JSON.stringify({ force: true }),
    });
    assert.equal(stop.status, 202);
    await h.service.chat.wait(op.id);

    assert.equal(h.store.getOperation(op.id).status, "cancelled");
    assert.equal(
      h.store.getRun("chat-cancel-run").status,
      "awaiting_plan_approval",
    );
    assert.equal(h.store.getRun("chat-cancel-run").cancellationRequested, false);
  } finally {
    if (h) await h.cleanup();
    await rm(repo, { recursive: true, force: true });
  }
});

test("dashboard session can create chat turns but not run mutations", async () => {
  const h = await startService();
  try {
    const conversationId = await createConversation(h.base);
    const cookie = await sessionCookie(h.base);

    const turn = await postTurn(h.base, conversationId, "via session", "chatkey-5", {
      cookie,
      "content-type": "application/json",
    });
    assert.equal(turn.status, 202);

    const mutation = await fetch(`${h.base}/api/v1/runs/run-x/cancel`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": "chatkey-6",
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    assert.equal(mutation.status, 403);
  } finally {
    await h.cleanup();
  }
});

test("dashboard session can manage read-only run chat for both interface agents", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "duet-dashboard-chat-repo-"));
  const h = await startService();
  try {
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Duet Test"]);
    await git(repo, ["config", "user.email", "duet@example.invalid"]);
    await writeFile(path.join(repo, "file.txt"), "base\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "base"]);
    const baseCommit = await git(repo, ["rev-parse", "HEAD"]);
    const stamp = new Date().toISOString();
    const run: RunRecord = {
      id: "dashboard-chat-run",
      repoPath: repo,
      repoRoot: repo,
      goal: "show manager chat in the dashboard",
      status: "awaiting_plan_approval",
      leadProvider: "codex",
      baseBranch: "main",
      baseCommit,
      integrationBranch: "duet/dashboard-chat-run/integration",
      configJson: "{}",
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    h.store.createRun(run);
    const cookie = await sessionCookie(h.base);
    const headers = {
      cookie,
      "content-type": "application/json",
    };

    const codex = await postConversation(
      h.base,
      {
        runId: run.id,
        interfaceAgent: "codex",
        title: "Dashboard manager chat",
      },
      "dashboard-chat-conv-codex",
      headers,
    );
    assert.equal(codex.status, 201);
    const codexConversation = ((await codex.json()) as { data: { id: string } })
      .data;

    const claude = await postConversation(
      h.base,
      {
        runId: run.id,
        interfaceAgent: "claude",
        title: "Dashboard manager chat",
      },
      "dashboard-chat-conv-claude",
      headers,
    );
    assert.equal(claude.status, 201);

    const list = await fetch(
      `${h.base}/api/v1/chat/conversations?runId=${run.id}`,
      { headers: { cookie } },
    );
    assert.equal(list.status, 200);
    const conversations = ((await list.json()) as {
      data: Array<{ runId: string; interfaceAgent: string }>;
    }).data;
    assert.deepEqual(
      conversations.map((conversation) => conversation.interfaceAgent).sort(),
      ["claude", "codex"],
    );
    assert.ok(
      conversations.every((conversation) => conversation.runId === run.id),
    );

    const turn = await postTurn(
      h.base,
      codexConversation.id,
      "/approve plan is still a read-only chat message",
      "dashboard-chat-turn-codex",
      headers,
    );
    assert.equal(turn.status, 202);
    const operation = ((await turn.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(operation.id);

    assert.equal(h.store.getOperation(operation.id).status, "succeeded");
    assert.equal(h.store.getRun(run.id).status, "awaiting_plan_approval");
    assert.equal(h.store.isApproved(run.id, "plan"), false);
  } finally {
    await h.cleanup();
    await rm(repo, { recursive: true, force: true });
  }
});

test("dashboard manager chat asset stays read-only and chat-only", () => {
  assert.match(dashboardHtml, /Manager Chat/);
  assert.match(dashboardHtml, /read-only manager/i);
  assert.match(dashboardJs, /\/chat\/conversations/);
  assert.match(dashboardJs, /function rememberConversation/);
  assert.match(dashboardJs, /updatedAt/);
  assert.match(dashboardJs, /eventCursor/);
  assert.match(dashboardJs, /renderedEventSeqs/);
  assert.match(dashboardJs, /eventRunId/);
  assert.match(dashboardJs, /if \(eventStream\) eventStream\.close\(\)/);
  assert.match(dashboardJs, /connectEvents\(\)/);
  assert.match(dashboardJs, /return Boolean\(chat\.activeOperation\)/);
  assert.match(dashboardJs, /loadRuns\(\{selectCurrent:true\}\)/);
  assert.doesNotMatch(dashboardJs, /if\(selected\) await selectRun\(selected\)/);
  assert.doesNotMatch(dashboardJs, /setChatEnabled\(true\)/);
  assert.doesNotMatch(dashboardJs, /activeOperationId/);
  assert.doesNotMatch(dashboardJs, /\/approve/);
  assert.doesNotMatch(dashboardJs, /\/merge/);
  assert.doesNotMatch(dashboardJs, /\/cancel/);
  assert.doesNotMatch(dashboardJs, /\/resolve/);
  assert.doesNotMatch(dashboardJs, /\/cleanup/);
});

test("cross-origin chat POST is rejected", async () => {
  const h = await startService();
  try {
    const response = await fetch(`${h.base}/api/v1/chat/conversations`, {
      method: "POST",
      headers: { ...bearer(), origin: "http://evil.invalid" },
      body: JSON.stringify({ interfaceAgent: "codex" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await h.cleanup();
  }
});

test("chat event payloads carry snippets only, not full bodies or full errors", async () => {
  const longReply = "long manager reply ".repeat(1_000);
  const ok = await startService({ text: longReply });
  try {
    const conversationId = await createConversation(ok.base);
    const response = await postTurn(ok.base, conversationId, "hi", "chatkey-7");
    await ok.service.chat.wait(
      ((await response.json()) as { data: OperationRecord }).data.id,
    );
    const events = ok.store.listEvents({}) as DuetEvent[];
    const completed = events.find((e) => e.type === "chat.turn.completed");
    assert.ok(completed);
    const payload = JSON.stringify(completed!.payload);
    assert.ok(payload.length < longReply.length);
    assert.ok((completed!.payload as { snippet: string }).snippet.length <= 120);
  } finally {
    await ok.cleanup();
  }

  const failed = await startService({ fail: true });
  try {
    const conversationId = await createConversation(failed.base);
    const response = await postTurn(failed.base, conversationId, "hi", "chatkey-8");
    await failed.service.chat.wait(
      ((await response.json()) as { data: OperationRecord }).data.id,
    );
    const events = failed.store.listEvents({}) as DuetEvent[];
    for (const event of events.filter((e) => e.type.startsWith("operation."))) {
      assert.ok(
        JSON.stringify(event.payload).length < 1_000,
        "operation event payload must not carry the full provider error",
      );
    }
  } finally {
    await failed.cleanup();
  }
});
