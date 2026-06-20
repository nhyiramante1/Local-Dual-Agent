import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type {
  DuetEvent,
  OperationRecord,
  ProviderName,
  RunRecord,
  TaskRecord,
} from "../src/core/domain.js";
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

function seedRunWithTask(store: Store, runId = "proposal-run"): void {
  const stamp = "2026-06-01T00:00:00.000Z";
  const run: RunRecord = {
    id: runId,
    repoPath: "/repo",
    repoRoot: "/repo",
    goal: "proposal run",
    status: "approved",
    leadProvider: "codex",
    baseBranch: "main",
    baseCommit: "abc",
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
      title: "Task",
      objective: "Do it",
      acceptanceCriteria: ["done"],
      allowedPaths: ["src/**"],
      dependencies: [],
    },
    status: "failed",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.createRun(run, [task]);
}

function proposalReply(
  action: string,
  fields: Record<string, unknown> = {},
): string {
  return [
    "I can suggest the next Duet action.",
    "",
    "```duet-proposal",
    JSON.stringify({ action, ...fields }),
    "```",
  ].join("\n");
}

function createStoredProposal(
  store: Store,
  conversationId: string,
  options: {
    id?: string;
    action?: "execute_run" | "retry_task" | "approve_plan" | "approve_merge";
    taskId?: string;
    expiresAt?: string;
    summary?: string;
  } = {},
): string {
  const turn = store.appendConversationTurn({
    conversationId,
    role: "manager",
    interfaceAgent: "codex",
    content: "I can suggest an action.",
  });
  const action = options.action ?? "execute_run";
  const taskId = options.taskId ?? (action === "retry_task" ? "task-1" : undefined);
  const id = options.id ?? randomUUID();
  store.createProposal({
    id,
    conversationId,
    turnId: turn.id,
    runId: "proposal-run",
    taskId,
    action,
    summary: options.summary ?? "Suggestion only.",
    commandCli:
      action === "retry_task"
        ? "duet retry proposal-run task-1"
        : action === "approve_plan"
          ? "duet approve proposal-run --stage plan"
          : action === "approve_merge"
            ? "duet approve proposal-run --stage merge"
          : "duet run proposal-run",
    commandJson: JSON.stringify({ action, runId: "proposal-run", taskId }),
    tier:
      action === "approve_plan" || action === "approve_merge"
        ? "fingerprint"
        : "ordinary",
    expiresAt:
      options.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  return id;
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

test("valid manager proposal creates one server-synthesized proposal", async () => {
  const h = await startService({
    text: proposalReply("retry_task", {
      runId: "proposal-run",
      taskId: "task-1",
      rationale: "Retry the failed task.",
      command: "rm -rf /",
      commandCli: "rm -rf /",
      cli: "rm -rf /",
      tier: "fingerprint",
      commandJson: { evil: true },
    }),
  });
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base);
    const response = await postTurn(
      h.base,
      conversationId,
      "please retry",
      "chatkey-proposal-valid",
    );
    assert.equal(response.status, 202);
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    const turns = h.store.listConversationTurns(conversationId);
    const manager = turns.find((turn) => turn.role === "manager");
    assert.ok(manager);
    assert.equal(manager.content, "I can suggest the next Duet action.");
    assert.doesNotMatch(manager.content, /duet-proposal/);

    const proposals = h.store.listProposals(conversationId);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].turnId, manager.id);
    assert.equal(proposals[0].action, "retry_task");
    assert.equal(proposals[0].commandCli, "duet retry proposal-run task-1");
    assert.equal(
      proposals[0].commandJson,
      JSON.stringify({
        action: "retry_task",
        runId: "proposal-run",
        taskId: "task-1",
      }),
    );
    assert.equal(proposals[0].tier, "ordinary");
  } finally {
    await h.cleanup();
  }
});

test("malformed or invalid proposal output degrades to plain chat without a proposal", async () => {
  for (const [name, text] of [
    [
      "malformed",
      "I can run it.\n\n```duet-proposal\nnot-json\n```",
    ],
    [
      "unknown-action",
      proposalReply("create_plan", { runId: "proposal-run" }),
    ],
    [
      "missing-task",
      proposalReply("retry_task", { runId: "proposal-run" }),
    ],
    [
      "trailing",
      `${proposalReply("execute_run", { runId: "proposal-run" })}\nextra`,
    ],
  ] as const) {
    const h = await startService({ text });
    try {
      seedRunWithTask(h.store);
      const conversationId = await createConversation(h.base);
      const response = await postTurn(
        h.base,
        conversationId,
        name,
        `chatkey-proposal-invalid-${name}`,
      );
      assert.equal(response.status, 202);
      const op = ((await response.json()) as { data: OperationRecord }).data;
      await h.service.chat.wait(op.id);

      assert.equal(h.store.getOperation(op.id).status, "succeeded");
      assert.equal(h.store.listProposals(conversationId).length, 0);
    } finally {
      await h.cleanup();
    }
  }
});

test("action-like chat can create a proposal without mutating run state", async () => {
  const h = await startService({
    text: proposalReply("approve_plan", {
      runId: "proposal-run",
      rationale: "Approve the plan if it still looks right.",
    }),
  });
  try {
    seedRunWithTask(h.store);
    const before = h.store.getRun("proposal-run");
    const conversationId = await createConversation(h.base);
    const response = await postTurn(
      h.base,
      conversationId,
      "/approve plan",
      "chatkey-proposal-approve",
    );
    assert.equal(response.status, 202);
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);

    const after = h.store.getRun("proposal-run");
    assert.equal(after.status, before.status);
    assert.equal(after.version, before.version);
    assert.equal(h.store.isApproved("proposal-run", "plan"), false);
    const proposals = h.store.listProposals(conversationId);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].action, "approve_plan");
    assert.equal(proposals[0].tier, "fingerprint");
    assert.equal(
      proposals[0].commandCli,
      "duet approve proposal-run --stage plan",
    );
  } finally {
    await h.cleanup();
  }
});

test("idempotency replay does not duplicate proposals or paid turns", async () => {
  const h = await startService({
    text: proposalReply("execute_run", { runId: "proposal-run" }),
  });
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base);
    const first = await postTurn(
      h.base,
      conversationId,
      "run it",
      "chatkey-proposal-idempotent",
    );
    assert.equal(first.status, 202);
    const op1 = ((await first.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op1.id);

    const second = await postTurn(
      h.base,
      conversationId,
      "run it",
      "chatkey-proposal-idempotent",
    );
    assert.equal(second.status, 202);
    const op2 = ((await second.json()) as { data: OperationRecord }).data;

    assert.equal(op2.id, op1.id);
    assert.equal(h.calls.n, 1);
    assert.equal(h.store.listProposals(conversationId).length, 1);
  } finally {
    await h.cleanup();
  }
});

test("proposal persistence failure rolls back the successful manager turn", async () => {
  const h = await startService({
    text: proposalReply("execute_run", { runId: "proposal-run" }),
  });
  try {
    seedRunWithTask(h.store);
    const createProposal = h.store.createProposal.bind(h.store);
    h.store.createProposal = (() => {
      throw new Error("proposal insert failed");
    }) as typeof h.store.createProposal;
    const conversationId = await createConversation(h.base);
    const response = await postTurn(
      h.base,
      conversationId,
      "run it",
      "chatkey-proposal-db-fail",
    );
    assert.equal(response.status, 202);
    const op = ((await response.json()) as { data: OperationRecord }).data;
    await h.service.chat.wait(op.id);
    h.store.createProposal = createProposal;

    assert.equal(h.store.getOperation(op.id).status, "failed");
    assert.equal(h.store.listProposals(conversationId).length, 0);
    const turns = h.store.listConversationTurns(conversationId);
    assert.equal(turns.filter((turn) => turn.role === "manager").length, 1);
    assert.equal(turns.find((turn) => turn.role === "manager")?.status, "failed");
  } finally {
    await h.cleanup();
  }
});

test("conversation detail returns active proposals with turns and conversation", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "retry_task",
      taskId: "task-1",
    });

    const detail = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}`,
      { headers: bearer() },
    );
    assert.equal(detail.status, 200);
    const data = ((await detail.json()) as {
      data: {
        conversation: { id: string };
        turns: Array<{ id: string }>;
        proposals: Array<{ id: string; commandCli: string }>;
      };
    }).data;

    assert.equal(data.conversation.id, conversationId);
    assert.ok(data.turns.length >= 1);
    assert.deepEqual(
      data.proposals.map((proposal) => proposal.id),
      [proposalId],
    );
    assert.equal(data.proposals[0].commandCli, "duet retry proposal-run task-1");
  } finally {
    await h.cleanup();
  }
});

test("conversation detail omits expired and dismissed proposals without mutating", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const expiredId = createStoredProposal(h.store, conversationId, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const dismissedId = createStoredProposal(h.store, conversationId);
    h.store.dismissProposal(conversationId, dismissedId);
    const eventCountBefore = h.store.listEvents({}).length;

    const detail = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}`,
      { headers: bearer() },
    );
    assert.equal(detail.status, 200);
    const data = ((await detail.json()) as {
      data: { proposals: Array<{ id: string }> };
    }).data;

    assert.deepEqual(data.proposals, []);
    assert.equal(h.store.getProposal(expiredId).status, "proposed");
    assert.equal(h.store.listEvents({}).length, eventCountBefore);
  } finally {
    await h.cleanup();
  }
});

test("proposal dismiss route is idempotent and removes proposal from detail", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId);
    const route = `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/dismiss`;

    const first = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "dismiss-proposal-1" },
      body: "{}",
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as {
      data: { proposalId: string; status: string };
    };
    assert.deepEqual(firstBody.data, { proposalId, status: "dismissed" });

    const second = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "dismiss-proposal-1" },
      body: "{}",
    });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), firstBody);

    const detail = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}`,
      { headers: bearer() },
    );
    const data = ((await detail.json()) as {
      data: { proposals: Array<{ id: string }> };
    }).data;
    assert.deepEqual(data.proposals, []);
    assert.equal(h.store.getProposal(proposalId).status, "dismissed");
  } finally {
    await h.cleanup();
  }
});

test("proposal dismiss route rejects idempotency conflicts and ownership mismatch", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const firstConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const secondConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
      title: "other",
    });
    const proposalId = createStoredProposal(h.store, firstConversation);
    const route = `${h.base}/api/v1/chat/conversations/${firstConversation}/proposals/${proposalId}/dismiss`;

    const first = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "dismiss-conflict-1" },
      body: "{}",
    });
    assert.equal(first.status, 200);
    const conflict = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "dismiss-conflict-1" },
      body: JSON.stringify({ changed: true }),
    });
    assert.equal(conflict.status, 409);

    const otherRoute = `${h.base}/api/v1/chat/conversations/${secondConversation}/proposals/${proposalId}/dismiss`;
    const mismatch = await fetch(otherRoute, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "dismiss-mismatch-1" },
      body: "{}",
    });
    assert.equal(mismatch.status, 404);
  } finally {
    await h.cleanup();
  }
});

test("dashboard session can dismiss proposals but still cannot mutate runs", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "approve_plan",
    });
    const beforeRun = h.store.getRun("proposal-run");
    const beforeTasks = h.store.listTasks("proposal-run").map((task) => ({
      id: task.id,
      status: task.status,
      version: task.version,
    }));
    const beforeOperations = h.store.listActiveOperations().length;
    const cookie = await sessionCookie(h.base);

    const dismiss = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/dismiss`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": "session-dismiss-1",
        },
        body: "{}",
      },
    );
    assert.equal(dismiss.status, 200);

    const runMutation = await fetch(
      `${h.base}/api/v1/runs/proposal-run/cancel`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": "session-run-mutation-1",
        },
        body: JSON.stringify({ expectedVersion: beforeRun.version }),
      },
    );
    assert.equal(runMutation.status, 403);

    const afterRun = h.store.getRun("proposal-run");
    assert.equal(afterRun.status, beforeRun.status);
    assert.equal(afterRun.version, beforeRun.version);
    assert.equal(h.store.isApproved("proposal-run", "plan"), false);
    assert.deepEqual(
      h.store.listTasks("proposal-run").map((task) => ({
        id: task.id,
        status: task.status,
        version: task.version,
      })),
      beforeTasks,
    );
    assert.equal(h.store.listActiveOperations().length, beforeOperations);
    assert.equal(h.store.getProposal(proposalId).status, "dismissed");
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare returns current readiness without mutating state", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "retry_task",
      taskId: "task-1",
    });
    const beforeRun = h.store.getRun("proposal-run");
    const beforeEvents = h.store.listEvents({}).length;
    const beforeOperations = h.store.listActiveOperations().length;

    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(response.status, 200);
    const data = ((await response.json()) as {
      data: {
        proposalId: string;
        action: string;
        tier: string;
        available: boolean;
        commandCli: string;
        run: { id: string; status: string; version: number };
        task: { id: string; status: string; version: number };
        requirements: string[];
        warnings: string[];
      };
    }).data;

    assert.equal(data.proposalId, proposalId);
    assert.equal(data.action, "retry_task");
    assert.equal(data.tier, "ordinary");
    assert.equal(data.available, true);
    assert.equal(data.commandCli, "duet retry proposal-run task-1");
    assert.deepEqual(data.run, {
      id: "proposal-run",
      status: "approved",
      version: beforeRun.version,
    });
    assert.equal(data.task.id, "task-1");
    assert.ok(data.requirements.some((item) => /terminal/i.test(item)));
    assert.ok(data.warnings.some((item) => /does not reserve/i.test(item)));
    assert.equal(h.store.getRun("proposal-run").version, beforeRun.version);
    assert.equal(h.store.listEvents({}).length, beforeEvents);
    assert.equal(h.store.listActiveOperations().length, beforeOperations);
    assert.equal(h.store.getProposal(proposalId).status, "proposed");
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare reports unavailable stale proposals without expiring them", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const expiredId = createStoredProposal(h.store, conversationId, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const dismissedId = createStoredProposal(h.store, conversationId);
    h.store.dismissProposal(conversationId, dismissedId);
    const beforeEvents = h.store.listEvents({}).length;

    for (const proposalId of [expiredId, dismissedId]) {
      const response = await fetch(
        `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/prepare`,
        { headers: bearer() },
      );
      assert.equal(response.status, 200);
      const data = ((await response.json()) as {
        data: { available: boolean; blockedReason: string };
      }).data;
      assert.equal(data.available, false);
      assert.match(data.blockedReason, /no longer active/i);
    }
    assert.equal(h.store.getProposal(expiredId).status, "proposed");
    assert.equal(h.store.listEvents({}).length, beforeEvents);
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare rejects ownership mismatch and allows dashboard sessions", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const firstConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const secondConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
      title: "other",
    });
    const proposalId = createStoredProposal(h.store, firstConversation);
    const mismatch = await fetch(
      `${h.base}/api/v1/chat/conversations/${secondConversation}/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(mismatch.status, 404);

    const cookie = await sessionCookie(h.base);
    const sessionPrepare = await fetch(
      `${h.base}/api/v1/chat/conversations/${firstConversation}/proposals/${proposalId}/prepare`,
      { headers: { cookie } },
    );
    assert.equal(sessionPrepare.status, 200);
    const runMutation = await fetch(
      `${h.base}/api/v1/runs/proposal-run/cancel`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": "session-prepare-run-mutation",
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      },
    );
    assert.equal(runMutation.status, 403);
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare describes fingerprint requirements without action tickets", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "approve_merge",
    });
    const beforeEvents = h.store.listEvents({}).length;
    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(response.status, 200);
    const data = ((await response.json()) as {
      data: {
        tier: string;
        commandCli: string;
        requirements: string[];
        warnings: string[];
      };
    }).data;
    assert.equal(data.tier, "fingerprint");
    assert.equal(data.commandCli, "duet approve proposal-run --stage merge");
    assert.ok(data.requirements.some((item) => /fingerprint/i.test(item)));
    assert.ok(data.warnings.some((item) => /CLI-only/i.test(item)));
    assert.equal(
      h.store
        .listEvents({})
        .filter((event) => event.type.startsWith("action_ticket.")).length,
      0,
    );
    assert.equal(h.store.listEvents({}).length, beforeEvents);
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare blocks while the linked run has an active operation", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "retry_task",
      taskId: "task-1",
    });
    h.store.createOperation({
      id: "active-proposal-op",
      runId: "proposal-run",
      kind: "retry",
      status: "running",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });

    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(response.status, 200);
    const data = ((await response.json()) as {
      data: { available: boolean; blockedReason: string };
    }).data;
    assert.equal(data.available, false);
    assert.match(data.blockedReason, /active operation active-proposal-op/);
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare returns 404 for a non-existent conversation", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId);
    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/nonexistent-conversation/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "CONVERSATION_NOT_FOUND");
  } finally {
    await h.cleanup();
  }
});

test("proposal prepare reports unavailable when the linked run no longer exists", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    // Conversation has no runId so it survives the run deletion below.
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
    });
    const proposalId = createStoredProposal(h.store, conversationId);
    // Disable FK enforcement temporarily so the cascade does not remove the
    // proposal when we hard-delete the run, simulating a post-creation deletion.
    const db = (h.store as unknown as { db: { exec: (sql: string) => void } }).db;
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("DELETE FROM runs WHERE id = 'proposal-run'");
    db.exec("PRAGMA foreign_keys = ON");

    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/prepare`,
      { headers: bearer() },
    );
    assert.equal(response.status, 200);
    const data = ((await response.json()) as {
      data: { available: boolean; blockedReason: string };
    }).data;
    assert.equal(data.available, false);
    assert.match(data.blockedReason, /run no longer exists/i);
  } finally {
    await h.cleanup();
  }
});

test("ordinary proposal start creates one operation and marks proposal started", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "retry_task",
      taskId: "task-1",
    });
    const run = h.store.getRun("proposal-run");
    const task = h.store.listTasks("proposal-run")[0];
    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`,
      {
        method: "POST",
        headers: { ...bearer(), "idempotency-key": "start-proposal-1" },
        body: JSON.stringify({
          confirm: "start",
          expectedRunVersion: run.version,
          expectedTaskVersion: task.version,
        }),
      },
    );
    assert.equal(response.status, 202);
    const operation = ((await response.json()) as { data: OperationRecord }).data;

    assert.equal(operation.kind, "retry");
    assert.equal(operation.runId, "proposal-run");
    assert.equal(h.store.getProposal(proposalId).status, "started");
    assert.deepEqual(h.store.listProposals(conversationId), []);
    assert.ok(h.store.getOperation(operation.id));
    assert.ok(
      h.store
        .listEvents({})
        .some(
          (event) =>
            event.type === "chat.proposal.started" &&
            event.operationId === operation.id,
        ),
    );
  } finally {
    await h.cleanup();
  }
});

test("proposal start idempotency replays and different key conflicts", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "execute_run",
    });
    const run = h.store.getRun("proposal-run");
    const route = `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`;
    const body = JSON.stringify({
      confirm: "start",
      expectedRunVersion: run.version,
    });

    const first = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-proposal-same" },
      body,
    });
    assert.equal(first.status, 202);
    const firstOperation = ((await first.json()) as { data: OperationRecord }).data;

    const replay = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-proposal-same" },
      body,
    });
    assert.equal(replay.status, 202);
    const replayOperation = ((await replay.json()) as { data: OperationRecord }).data;
    assert.equal(replayOperation.id, firstOperation.id);

    const conflict = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-proposal-different" },
      body,
    });
    assert.equal(conflict.status, 409);
    assert.equal(h.store.getProposal(proposalId).status, "started");
  } finally {
    await h.cleanup();
  }
});

test("proposal start rejects missing confirmation and stale versions", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "retry_task",
      taskId: "task-1",
    });
    const route = `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`;

    const missingConfirm = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-missing-confirm" },
      body: JSON.stringify({
        expectedRunVersion: h.store.getRun("proposal-run").version,
        expectedTaskVersion: h.store.listTasks("proposal-run")[0].version,
      }),
    });
    assert.equal(missingConfirm.status, 400);

    const staleRun = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-stale-run" },
      body: JSON.stringify({
        confirm: "start",
        expectedRunVersion: 999,
        expectedTaskVersion: h.store.listTasks("proposal-run")[0].version,
      }),
    });
    assert.equal(staleRun.status, 409);

    const staleTask = await fetch(route, {
      method: "POST",
      headers: { ...bearer(), "idempotency-key": "start-stale-task" },
      body: JSON.stringify({
        confirm: "start",
        expectedRunVersion: h.store.getRun("proposal-run").version,
        expectedTaskVersion: 999,
      }),
    });
    assert.equal(staleTask.status, 409);
    assert.equal(h.store.getProposal(proposalId).status, "proposed");
    assert.equal(h.store.listActiveOperations().length, 0);
  } finally {
    await h.cleanup();
  }
});

test("proposal start rejects fingerprint, inactive, active-run, and ownership mismatch", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const firstConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const secondConversation = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
      title: "other",
    });
    const run = h.store.getRun("proposal-run");
    const fingerprint = createStoredProposal(h.store, firstConversation, {
      action: "approve_plan",
    });
    const inactive = createStoredProposal(h.store, firstConversation);
    h.store.dismissProposal(firstConversation, inactive);
    const activeRun = createStoredProposal(h.store, firstConversation);

    const start = async (conversationId: string, proposalId: string, key: string) =>
      await fetch(
        `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`,
        {
          method: "POST",
          headers: { ...bearer(), "idempotency-key": key },
          body: JSON.stringify({
            confirm: "start",
            expectedRunVersion: run.version,
          }),
        },
      );

    assert.equal((await start(firstConversation, fingerprint, "start-fingerprint")).status, 400);
    assert.equal((await start(firstConversation, inactive, "start-inactive")).status, 400);
    assert.equal((await start(secondConversation, activeRun, "start-mismatch")).status, 404);

    h.store.createOperation({
      id: "start-active-op",
      runId: "proposal-run",
      kind: "execute",
      status: "running",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });
    assert.equal((await start(firstConversation, activeRun, "start-active-run")).status, 409);
    assert.equal(
      h.store
        .listEvents({})
        .filter((event) => event.type.startsWith("action_ticket.")).length,
      0,
    );
  } finally {
    await h.cleanup();
  }
});

test("proposal start rejects proposals swept to expired status by expireProposals", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    // Create a proposal whose expiresAt is already in the past so the sweep
    // will pick it up. The status is still 'proposed' at this point.
    const proposalId = createStoredProposal(h.store, conversationId, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    assert.equal(h.store.getProposal(proposalId).status, "proposed");

    // Simulate the periodic expiry sweep.
    const swept = h.store.expireProposals();
    assert.equal(swept, 1);
    assert.equal(h.store.getProposal(proposalId).status, "expired");

    const run = h.store.getRun("proposal-run");
    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`,
      {
        method: "POST",
        headers: { ...bearer(), "idempotency-key": "start-swept-proposal" },
        body: JSON.stringify({ confirm: "start", expectedRunVersion: run.version }),
      },
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "PROPOSAL_NOT_ACTIVE");
  } finally {
    await h.cleanup();
  }
});

test("dashboard session can start proposals through chat routes but not mutate runs directly", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "execute_run",
    });
    const cookie = await sessionCookie(h.base);
    const run = h.store.getRun("proposal-run");

    // Proposal /start submits run work — sessions must be rejected.
    const start = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": "session-start-proposal",
        },
        body: JSON.stringify({
          confirm: "start",
          expectedRunVersion: run.version,
        }),
      },
    );
    assert.equal(start.status, 202);
    const operation = ((await start.json()) as { data: OperationRecord }).data;
    assert.equal(operation.kind, "execute");
    assert.equal(h.store.getProposal(proposalId).status, "started");
    assert.equal(h.store.getProposal(proposalId).operationId, operation.id);

    const runMutation = await fetch(
      `${h.base}/api/v1/runs/proposal-run/cancel`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": "session-start-run-mutation",
        },
        body: JSON.stringify({ expectedVersion: run.version }),
      },
    );
    assert.equal(runMutation.status, 403);
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
  assert.match(dashboardJs, /renderProposalCard/);
  assert.match(dashboardJs, /data-proposal-dismiss/);
  assert.match(dashboardJs, /data-proposal-prepare/);
  assert.match(dashboardJs, /Check readiness/);
  assert.match(dashboardJs, /\/prepare/);
  assert.match(dashboardJs, /data-proposal-start/);
  assert.match(dashboardJs, /Start operation/);
  assert.match(dashboardJs, /\/start/);
  assert.match(dashboardJs, /\/proposals\/"\+encodeURIComponent\(proposalId\)\+"\/dismiss/);
  assert.match(dashboardJs, /Copy CLI/);
  assert.match(dashboardJs, /return Boolean\(chat\.activeOperation\)/);
  assert.match(dashboardJs, /loadRuns\(\{selectCurrent:true\}\)/);
  assert.doesNotMatch(dashboardJs, /if\(selected\) await selectRun\(selected\)/);
  assert.doesNotMatch(dashboardJs, /setChatEnabled\(true\)/);
  assert.doesNotMatch(dashboardJs, /activeOperationId/);
  assert.doesNotMatch(dashboardJs, /action-ticket/);
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

test("global conversation accepts turns and is discoverable without a runId filter", async () => {
  const h = await startService();
  try {
    // Create a global (unscoped) conversation.
    const conversationId = await createConversation(h.base, { interfaceAgent: "codex" });
    const conversation = h.store.getConversation(conversationId);
    assert.equal(conversation.runId, undefined);

    // POST a turn to the global conversation.
    const turnResponse = await postTurn(h.base, conversationId, "what can you do?", "global-turn-key-1");
    assert.equal(turnResponse.status, 202);

    // GET /chat/conversations without runId filter returns the global conversation.
    const listResponse = await fetch(`${h.base}/api/v1/chat/conversations`, { headers: bearer() });
    assert.equal(listResponse.status, 200);
    const listed = ((await listResponse.json()) as { data: Array<{ id: string; runId?: string }> }).data;
    assert.ok(listed.some((item) => item.id === conversationId && !item.runId));
  } finally {
    await h.cleanup();
  }
});

test("global conversation can generate proposals pointing to a specific run", async () => {
  const h = await startService({
    text: proposalReply("execute_run", { runId: "proposal-run" }),
  });
  try {
    seedRunWithTask(h.store);
    // Global conversation has no runId — the proposal's runId is validated against the store.
    const conversationId = await createConversation(h.base, { interfaceAgent: "codex" });

    const turnResponse = await postTurn(h.base, conversationId, "suggest an action", "global-proposal-turn-1");
    assert.equal(turnResponse.status, 202);
    const op = ((await turnResponse.json()) as { data: { id: string } }).data;

    // Wait for the operation to complete.
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const opState = h.store.listActiveOperations();
      if (!opState.some((o) => o.id === op.id)) break;
      attempts++;
    }

    const proposals = h.store.listProposals(conversationId);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].action, "execute_run");
    assert.equal(proposals[0].runId, "proposal-run");
  } finally {
    await h.cleanup();
  }
});

test("openai provider mock completes a manager turn successfully", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-chat-openai-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const openaiProvider: ProviderAdapter = {
    name: "openai" as const,
    async run() {
      return {
        provider: "openai",
        sessionId: "chatcmpl-test",
        finalText: "Hello from OpenAI mock.",
        stdout: "",
        stderr: "",
        durationMs: 5,
        usage: { inputTokens: 20, outputTokens: 10, costKnown: false },
      };
    },
  };
  const chatProviders = { claude: openaiProvider, codex: openaiProvider, openai: openaiProvider };
  const service = new DuetService({
    store,
    secret,
    instanceId: "openai-test",
    idleTimeoutMs: 60_000,
    chatProviders,
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const conversationId = await createConversation(base, { interfaceAgent: "openai" });
    const conversation = store.getConversation(conversationId);
    assert.equal(conversation.interfaceAgent, "openai");

    const turnResponse = await postTurn(base, conversationId, "hello", "openai-turn-1");
    assert.equal(turnResponse.status, 202);
    const op = ((await turnResponse.json()) as { data: { id: string } }).data;

    let attempts = 0;
    while (attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!store.listActiveOperations().some((o) => o.id === op.id)) break;
      attempts++;
    }

    const turns = store.listConversationTurns(conversationId);
    const managerTurn = turns.find((t) => t.role === "manager");
    assert.ok(managerTurn, "manager turn should be stored");
    assert.equal(managerTurn?.content, "Hello from OpenAI mock.");
    assert.equal(managerTurn?.interfaceAgent, "openai");
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("proposal start stores operationId on the proposal and listProposalsHistory includes it", async () => {
  const h = await startService();
  try {
    seedRunWithTask(h.store);
    const conversationId = await createConversation(h.base, {
      interfaceAgent: "codex",
      runId: "proposal-run",
    });
    const proposalId = createStoredProposal(h.store, conversationId, {
      action: "execute_run",
    });
    const run = h.store.getRun("proposal-run");
    const response = await fetch(
      `${h.base}/api/v1/chat/conversations/${conversationId}/proposals/${proposalId}/start`,
      {
        method: "POST",
        headers: { ...bearer(), "idempotency-key": "start-history-test-1" },
        body: JSON.stringify({ confirm: "start", expectedRunVersion: run.version }),
      },
    );
    assert.equal(response.status, 202);
    const operation = ((await response.json()) as { data: OperationRecord }).data;

    const proposal = h.store.getProposal(proposalId);
    assert.equal(proposal.status, "started");
    assert.equal(proposal.operationId, operation.id);

    const history = h.store.listProposalsHistory(conversationId);
    const record = history.find((p) => p.id === proposalId);
    assert.ok(record, "started proposal should appear in history");
    assert.equal(record?.operationId, operation.id);
  } finally {
    await h.cleanup();
  }
});

test("missing openai adapter returns CONFIGURATION_ERROR when interfaceAgent is openai", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-chat-noopenai-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const fallback: ProviderAdapter = {
    name: "codex" as const,
    async run() {
      return {
        provider: "codex",
        sessionId: "s",
        finalText: "",
        stdout: "",
        stderr: "",
        durationMs: 1,
        usage: {},
      };
    },
  };
  // chatProviders has no "openai" key — only claude and codex.
  const service = new DuetService({
    store,
    secret,
    instanceId: "noopenai-test",
    idleTimeoutMs: 60_000,
    chatProviders: { claude: fallback, codex: fallback },
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const conversationId = await createConversation(base, { interfaceAgent: "openai" });

    const turnResponse = await postTurn(base, conversationId, "test", "noopenai-turn-1");
    assert.equal(turnResponse.status, 202);
    const op = ((await turnResponse.json()) as { data: { id: string } }).data;

    let attempts = 0;
    while (attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!store.listActiveOperations().some((o) => o.id === op.id)) break;
      attempts++;
    }

    const turns = store.listConversationTurns(conversationId);
    const failedTurn = turns.find((t) => t.role === "manager");
    assert.ok(failedTurn, "a failed manager turn should be recorded");
    assert.equal(failedTurn?.status, "failed");
    assert.ok(failedTurn?.errorJson?.includes("CONFIGURATION_ERROR"));
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
