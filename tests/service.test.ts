import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("SSE replays committed events and dashboard bootstrap supports ticket and reusable access modes", async () => {
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
    dashboardAccessToken: "persistent-dashboard-access",
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

    const persistentOne = await fetch(`${base}/dashboard/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "persistent-dashboard-access" }),
    });
    assert.equal(persistentOne.status, 204);
    const persistentTwo = await fetch(`${base}/dashboard/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "persistent-dashboard-access" }),
    });
    assert.equal(persistentTwo.status, 204);
  } finally {
    controller.abort();
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("service can bind a configured fixed localhost port", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-fixed-port-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const address = probe.address();
  const reservedPort = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const service = new DuetService({
    store,
    secret: "fixed-port-secret",
    instanceId: "fixed-port-instance",
    idleTimeoutMs: 60_000,
    listenPort: reservedPort,
  });
  try {
    const actualPort = await service.listen();
    assert.equal(actualPort, reservedPort);
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("service request validation accepts configured LAN host and rejects mismatched origins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-lan-host-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const service = new DuetService({
    store,
    secret: "lan-host-secret",
    instanceId: "lan-host-instance",
    idleTimeoutMs: 60_000,
    listenHost: "0.0.0.0",
    dashboardPublicHost: "192.168.1.50",
  });
  try {
    const validate = (
      service as unknown as {
        validateLocalRequest: (request: { headers: Record<string, string> }) => void;
      }
    ).validateLocalRequest.bind(service);
    assert.doesNotThrow(() => {
      validate({
        headers: {
          host: "192.168.1.50:58208",
          origin: "http://192.168.1.50:58208",
        },
      });
    });
    assert.throws(() => {
      validate({
        headers: {
          host: "192.168.1.50:58208",
          origin: "http://127.0.0.1:58208",
        },
      });
    });
  } finally {
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

test("SSE cursor boundary: after=minimum-1 receives events, after<minimum-1 triggers reset", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-cursor-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const { run, task } = fixture(directory);
  store.createRun(run, [task]);  // seq 1: run.created
  // Produce more events so that deleting the first two still leaves events behind
  for (let i = 0; i < 4; i++) store.addArtifact(run.id, "log", String(i));  // seq 2-5
  // Simulate compaction: drop the first two events so minimum becomes 3
  (store as unknown as { db: { exec: (sql: string) => void } }).db.exec(
    "DELETE FROM events WHERE seq <= 2",
  );
  const bounds = store.getEventBounds();
  assert.ok(bounds.minimum !== undefined && bounds.minimum >= 3, "minimum must be >= 3 after deletion");
  const secret = "cursor-test-secret";
  const service = new DuetService({ store, secret, instanceId: "cursor-test", idleTimeoutMs: 60_000 });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${secret}` };
  try {
    // after = minimum - 1: client will receive events starting at minimum → no reset
    const validResp = await fetch(`${base}/api/v1/events?after=${bounds.minimum! - 1}`, { headers: auth });
    assert.equal(validResp.status, 200, "after=minimum-1 must not trigger a reset");
    const validBody = (await validResp.json()) as { data: unknown[] };
    assert.ok(Array.isArray(validBody.data));

    // after = minimum - 2: event at minimum-1 was compacted → reset required
    const staleResp = await fetch(`${base}/api/v1/events?after=${bounds.minimum! - 2}`, { headers: auth });
    assert.equal(staleResp.status, 400, "after=minimum-2 must trigger EVENT_CURSOR_EXPIRED");
    const staleBody = (await staleResp.json()) as { error: { code: string } };
    assert.equal(staleBody.error.code, "EVENT_CURSOR_EXPIRED");
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("artifact containment check resolves symlinks in root before comparison", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-symlink-"));
  const realHome = path.join(directory, "real-home");
  const symlinkHome = path.join(directory, "link-home");
  await mkdir(path.join(realHome, "artifacts"), { recursive: true });
  await symlink(realHome, symlinkHome, "junction");
  const artifactContent = "symlink artifact content";
  const artifactFile = path.join(realHome, "artifacts", "artifact.log");
  await writeFile(artifactFile, artifactContent);
  const prevDuetHome = process.env.DUET_HOME;
  process.env.DUET_HOME = symlinkHome;
  try {
    const store = new Store(path.join(directory, "state.sqlite"));
    const { run, task } = fixture(directory);
    store.createRun(run, [task]);
    // Store the artifact using the symlinked path — root and candidate diverge without realpath
    store.addFileArtifact(run.id, "log", path.join(symlinkHome, "artifacts", "artifact.log"));
    const artifacts = store.listArtifacts(run.id);
    const secret = "symlink-test-secret";
    const service = new DuetService({ store, secret, instanceId: "symlink-test", idleTimeoutMs: 60_000 });
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Bearer ${secret}` };
    try {
      const resp = await fetch(`${base}/api/v1/artifacts/${artifacts[0].id}`, { headers: auth });
      assert.equal(resp.status, 200, "artifact behind symlinked root must not be rejected as path traversal");
      assert.equal(await resp.text(), artifactContent);
    } finally {
      await service.close();
      store.close();
    }
  } finally {
    if (prevDuetHome === undefined) delete process.env.DUET_HOME;
    else process.env.DUET_HOME = prevDuetHome;
    await rm(directory, { recursive: true, force: true });
  }
});

test("SSE forced disconnect cleans up intervals and stream tracking", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-sse-close-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const { run, task } = fixture(directory);
  store.createRun(run, [task]);
  const secret = "sse-close-secret";
  const service = new DuetService({ store, secret, instanceId: "sse-close", idleTimeoutMs: 60_000 });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${secret}` };
  try {
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/v1/events`, {
      headers: { ...auth, accept: "text/event-stream" },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    // Consume first chunk to confirm the stream is live
    await stream.body!.getReader().read();
    assert.equal(
      (service as unknown as { activeStreams: number }).activeStreams,
      1,
      "stream must be tracked while open",
    );
    // Force-disconnect the client
    controller.abort();
    // Allow the close event to propagate through the event loop
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (service as unknown as { activeStreams: number }).activeStreams,
      0,
      "activeStreams must be 0 after forced disconnect",
    );
    assert.equal(
      (service as unknown as { streams: Set<unknown> }).streams.size,
      0,
      "streams set must be empty after forced disconnect",
    );
    // Service must still respond normally — no crashed intervals
    const health = await fetch(`${base}/api/v1/health`, { headers: auth });
    assert.equal(health.status, 200);
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("artifact containment rejects symlink escaping managed storage root", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-escape-"));
  const realHome = path.join(directory, "home");
  const outside = path.join(directory, "outside");
  await mkdir(path.join(realHome, "artifacts"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "secret content");
  // Create a junction/symlink inside the artifacts root pointing to the outside directory
  const escapeLink = path.join(realHome, "artifacts", "escape");
  await symlink(outside, escapeLink, "junction");
  const prevDuetHome = process.env.DUET_HOME;
  process.env.DUET_HOME = realHome;
  try {
    const store = new Store(path.join(directory, "state.sqlite"));
    const { run, task } = fixture(directory);
    store.createRun(run, [task]);
    // Artifact path traverses through the symlink to a file outside the root
    store.addFileArtifact(run.id, "log", path.join(realHome, "artifacts", "escape", "secret.txt"));
    const artifacts = store.listArtifacts(run.id);
    const secret = "escape-test-secret";
    const service = new DuetService({ store, secret, instanceId: "escape-test", idleTimeoutMs: 60_000 });
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Bearer ${secret}` };
    try {
      const resp = await fetch(`${base}/api/v1/artifacts/${artifacts[0].id}`, { headers: auth });
      assert.equal(resp.status, 400, "symlink escaping the artifacts root must be rejected");
      const body = (await resp.json()) as { error: { code: string } };
      assert.equal(body.error.code, "PATH_TRAVERSAL");
    } finally {
      await service.close();
      store.close();
    }
  } finally {
    if (prevDuetHome === undefined) delete process.env.DUET_HOME;
    else process.env.DUET_HOME = prevDuetHome;
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
