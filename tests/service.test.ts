import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { RunRecord, TaskRecord } from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";
import { DuetService } from "../src/service/server.js";
import { logicalIdempotencyKey } from "../src/service/client.js";

function fixture(directory: string): { run: RunRecord; task: TaskRecord } {
  const stamp = new Date().toISOString();
  const run: RunRecord = {
    id: "service-run",
    repoPath: directory,
    repoRoot: directory,
    goal: "inspect service",
    status: "approved",
    leadProvider: "claude",
    baseBranch: "main",
    baseCommit: "abc",
    integrationBranch: "duet/service-run/integration",
    plan: {
      summary: "service",
      tasks: [
        {
          id: "task",
          title: "Task",
          objective: "test",
          acceptanceCriteria: ["pass"],
          allowedPaths: ["src/**"],
          dependencies: [],
        },
      ],
      risks: [],
    },
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return {
    run,
    task: {
      runId: run.id,
      id: "task",
      ordinal: 0,
      plan: run.plan!.tasks[0],
      status: "ready",
      provider: "codex",
      reviewerProvider: "claude",
      revisionCount: 0,
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

test("local API enforces auth, idempotency, origin, and durable events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-service-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const { run, task } = fixture(directory);
  store.createRun(run, [task]);
  store.addArtifact(run.id, "sample.log", "abcdef");
  const secret = "service-test-secret";
  const service = new DuetService({
    store,
    secret,
    instanceId: "test-instance",
    idleTimeoutMs: 60_000,
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${secret}` };
  try {
    assert.equal((await fetch(`${base}/api/v1/runs`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/v1/runs`, {
          headers: { ...auth, origin: "http://evil.invalid" },
        })
      ).status,
      400,
    );

    const listed = await fetch(`${base}/api/v1/runs`, { headers: auth });
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as { data: RunRecord[] };
    assert.equal(listedBody.data[0].id, run.id);

    const body = JSON.stringify({ expectedVersion: 1 });
    const headers = {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "cancel-service-run",
    };
    const first = await fetch(`${base}/api/v1/runs/${run.id}/cancel`, {
      method: "POST",
      headers,
      body,
    });
    const second = await fetch(`${base}/api/v1/runs/${run.id}/cancel`, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    const firstBody = (await first.json()) as { data: { id: string } };
    const secondBody = (await second.json()) as { data: { id: string } };
    assert.equal(firstBody.data.id, secondBody.data.id);
    const stale = await fetch(`${base}/api/v1/runs/${run.id}/cancel`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "stale-cancel-run" },
      body,
    });
    assert.equal(stale.status, 202);

    const artifacts = store.listArtifacts(run.id);
    const ranged = await fetch(
      `${base}/api/v1/artifacts/${artifacts[0].id}`,
      { headers: { ...auth, range: "bytes=1-3" } },
    );
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "bcd");

    const events = await fetch(`${base}/api/v1/events`, { headers: auth });
    const eventBody = (await events.json()) as {
      data: Array<{ type: string }>;
    };
    assert.ok(eventBody.data.some((event) => event.type === "run.created"));
    assert.ok(
      eventBody.data.some((event) => event.type === "operation.created"),
    );
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SSE replays committed events and dashboard tickets are single use", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-sse-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const { run, task } = fixture(directory);
  store.createRun(run, [task]);
  const secret = "sse-test-secret";
  const service = new DuetService({
    store,
    secret,
    instanceId: "sse-instance",
    idleTimeoutMs: 60_000,
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${secret}` };
  const controller = new AbortController();
  try {
    const stream = await fetch(`${base}/api/v1/events?after=0`, {
      headers: { ...auth, accept: "text/event-stream" },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    const read = await stream.body!.getReader().read();
    assert.match(new TextDecoder().decode(read.value), /event: duet\.event/);
    controller.abort();

    const ticketResponse = await fetch(`${base}/api/v1/dashboard/ticket`, {
      method: "POST",
      headers: {
        ...auth,
        "content-type": "application/json",
        "idempotency-key": "dashboard-ticket",
      },
      body: "{}",
    });
    const ticket = (await ticketResponse.json()) as {
      data: { ticket: string };
    };
    const exchange = await fetch(`${base}/dashboard/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ticket.data),
    });
    assert.equal(exchange.status, 204);
    const cookie = exchange.headers.get("set-cookie");
    assert.ok(cookie);
    const dashboardRead = await fetch(`${base}/api/v1/runs`, {
      headers: { cookie: cookie!.split(";")[0] },
    });
    assert.equal(dashboardRead.status, 200);
    const dashboardMutation = await fetch(`${base}/api/v1/service/stop`, {
      method: "POST",
      headers: {
        cookie: cookie!.split(";")[0],
        "content-type": "application/json",
        "idempotency-key": "dashboard-stop",
      },
      body: "{}",
    });
    assert.equal(dashboardMutation.status, 403);
    const reused = await fetch(`${base}/dashboard/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ticket.data),
    });
    assert.equal(reused.status, 401);
  } finally {
    controller.abort();
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("approval and merge APIs require one-use fingerprint-bound tickets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-ticket-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const fixtureRecords = fixture(directory);
  fixtureRecords.run.status = "awaiting_plan_approval";
  store.createRun(fixtureRecords.run, [fixtureRecords.task]);
  const secret = "ticket-test-secret";
  const service = new DuetService({
    store,
    secret,
    instanceId: "ticket-instance",
    idleTimeoutMs: 60_000,
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  try {
    const withoutTicket = await fetch(
      `${base}/api/v1/runs/${fixtureRecords.run.id}/approve`,
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": "approve-without-ticket" },
        body: JSON.stringify({ expectedVersion: 1, stage: "plan" }),
      },
    );
    assert.equal(withoutTicket.status, 400);

    const ticketResponse = await fetch(
      `${base}/api/v1/runs/${fixtureRecords.run.id}/action-ticket`,
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": "approval-ticket-create" },
        body: JSON.stringify({
          expectedVersion: 1,
          action: "approve_plan",
        }),
      },
    );
    assert.equal(ticketResponse.status, 200);
    const ticket = (await ticketResponse.json()) as {
      data: { ticket: string };
    };
    const approvalBody = JSON.stringify({
      expectedVersion: 1,
      stage: "plan",
      actionTicket: ticket.data.ticket,
    });
    const approved = await fetch(
      `${base}/api/v1/runs/${fixtureRecords.run.id}/approve`,
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": "approval-ticket-consume" },
        body: approvalBody,
      },
    );
    assert.equal(approved.status, 200);

    const replay = await fetch(
      `${base}/api/v1/runs/${fixtureRecords.run.id}/approve`,
      {
        method: "POST",
        headers: { ...auth, "idempotency-key": "approval-ticket-replay" },
        body: JSON.stringify({
          expectedVersion: 2,
          stage: "plan",
          actionTicket: ticket.data.ticket,
        }),
      },
    );
    assert.equal(replay.status, 400);
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("logical client idempotency keys are stable for the same command", () => {
  const body = { expectedVersion: 4, action: "execute" };
  assert.equal(
    logicalIdempotencyKey("/api/v1/runs/run/execute", body),
    logicalIdempotencyKey("/api/v1/runs/run/execute", body),
  );
  assert.notEqual(
    logicalIdempotencyKey("/api/v1/runs/run/execute", body),
    logicalIdempotencyKey("/api/v1/runs/run/execute", {
      ...body,
      expectedVersion: 5,
    }),
  );
});
