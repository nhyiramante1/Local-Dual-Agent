import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type {
  DuetEvent,
  OperationRecord,
  RunRecord,
} from "../src/core/domain.js";
import { DuetError } from "../src/core/errors.js";
import {
  createDuetMcpServer,
  serverInstructions,
} from "../src/mcp/server.js";
import {
  duetToolNames,
  type DuetApi,
} from "../src/mcp/types.js";
import { Store } from "../src/persistence/store.js";
import { DuetService } from "../src/service/server.js";

function fixtureRun(index = 0): RunRecord {
  const stamp = new Date(2026, 0, index + 1).toISOString();
  return {
    id: `20260101010${index}-abc12${index}`,
    repoPath: `C:\\repo ${index}`,
    repoRoot: `C:\\repo ${index}`,
    goal: `Goal ${index}`,
    status: index % 2 === 0 ? "approved" : "failed",
    leadProvider: index % 2 === 0 ? "claude" : "codex",
    baseBranch: "main",
    baseCommit: "abc",
    integrationBranch: `duet/${index}/integration`,
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

class FakeApi implements DuetApi {
  readonly posts: Array<{
    route: string;
    body: unknown;
    idempotencyKey?: string;
  }> = [];
  readonly operations = new Map<string, {
    input: string;
    operation: OperationRecord;
  }>();
  runs = Array.from({ length: 130 }, (_, index) => fixtureRun(index));
  artifact = "abcdefghijklmnopqrstuvwxyz";

  async get<T>(route: string): Promise<T> {
    if (route === "/api/v1/runs") return this.runs as T;
    if (route.startsWith("/api/v1/events")) {
      return [
        {
          seq: 7,
          id: randomUUID(),
          type: "run.created",
          severity: "info",
          occurredAt: new Date().toISOString(),
          payload: { text: "<untrusted>" },
        } satisfies DuetEvent,
      ] as T;
    }
    if (route.startsWith("/api/v1/operations/")) {
      const operation = [...this.operations.values()][0]?.operation ?? {
        id: route.split("/").at(-1)!,
        kind: "plan",
        status: "queued",
        serviceInstanceId: "test",
        inputHash: "hash",
        resultJson: JSON.stringify({ value: "x".repeat(25_000) }),
        createdAt: new Date().toISOString(),
      };
      return operation as T;
    }
    if (/\/messages$/.test(route)) {
      return Array.from({ length: 101 }, (_, index) => ({
        id: index,
        kind: "worker",
        body: `<message>${"x".repeat(9_000)}</message>`,
        createdAt: new Date().toISOString(),
      })) as T;
    }
    if (/\/verification$/.test(route)) return [] as T;
    if (/\/artifacts$/.test(route)) return [] as T;
    if (/\/conflicts$/.test(route)) return [] as T;
    if (/\/diff$/.test(route)) {
      return { diff: `<diff>${"d".repeat(60_000)}</diff>` } as T;
    }
    if (/\/runs\/[^/]+$/.test(route)) {
      return {
        run: this.runs[0],
        tasks: [],
        usage: { totalTurns: 0 },
        approvals: { plan: false, merge: false },
        leases: [],
      } as T;
    }
    throw new Error(`Unexpected GET ${route}`);
  }

  async post<T>(
    route: string,
    body: unknown,
    options: { idempotencyKey?: string } = {},
  ): Promise<T> {
    this.posts.push({ route, body, idempotencyKey: options.idempotencyKey });
    const key = options.idempotencyKey ?? "";
    const input = JSON.stringify(body);
    const existing = this.operations.get(key);
    if (existing) {
      if (existing.input !== input) {
        throw new DuetError(
          "Idempotency key was reused with a different request.",
          "IDEMPOTENCY_CONFLICT",
        );
      }
      return existing.operation as T;
    }
    const operation: OperationRecord = {
      id: randomUUID(),
      kind: "plan",
      status: "queued",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    };
    this.operations.set(key, { input, operation });
    return operation as T;
  }

  async readArtifact(
    artifactId: number,
    offset: number,
    maximumLength: number,
  ) {
    const content = this.artifact.slice(offset, offset + maximumLength);
    return {
      content,
      offset,
      nextOffset: offset + content.length,
      totalLength: this.artifact.length,
      truncated: offset + content.length < this.artifact.length,
    };
  }
}

class HttpApi implements DuetApi {
  constructor(
    private readonly base: string,
    private readonly secret: string,
  ) {}

  async get<T>(route: string): Promise<T> {
    return await this.request<T>(route, { method: "GET" });
  }

  async post<T>(
    route: string,
    body: unknown,
    options: { idempotencyKey?: string } = {},
  ): Promise<T> {
    return await this.request<T>(route, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": options.idempotencyKey ?? randomUUID(),
      },
      body: JSON.stringify(body),
    });
  }

  async readArtifact(): Promise<never> {
    throw new Error("Not used in this test.");
  }

  private async request<T>(route: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${route}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.secret}`,
        "x-duet-client": "duet-mcp",
        ...(init.headers ?? {}),
      },
    });
    const envelope = (await response.json()) as {
      data?: T;
      error?: { code: string; message: string };
    };
    if (!response.ok || envelope.error) {
      throw new DuetError(
        envelope.error?.message ?? response.statusText,
        envelope.error?.code ?? "HTTP_ERROR",
      );
    }
    return envelope.data as T;
  }
}

async function connected(api: DuetApi) {
  const server = createDuetMcpServer(async () => api);
  const client = new Client(
    { name: "duet-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test("MCP advertises only the restricted six-tool surface and instructions", async () => {
  const api = new FakeApi();
  const connection = await connected(api);
  try {
    assert.equal(connection.client.getInstructions(), serverInstructions);
    assert.deepEqual(
      Object.keys(connection.client.getServerCapabilities() ?? {}),
      ["tools"],
    );
    const listed = await connection.client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      duetToolNames,
    );
    assert.ok(
      listed.tools
        .filter((tool) => tool.name !== "duet_create_plan")
        .every((tool) => tool.annotations?.readOnlyHint === true),
    );
    const planning = listed.tools.find(
      (tool) => tool.name === "duet_create_plan",
    )!;
    assert.equal(planning.annotations?.readOnlyHint, false);
    assert.match(planning.description ?? "", /PAID/);
    assert.ok(
      !listed.tools.some((tool) =>
        /approve|execute|cancel|cleanup|resolve|merge/.test(tool.name),
      ),
    );
  } finally {
    await connection.close();
  }
});

test("MCP inspection is bounded and artifact reads paginate", async () => {
  const api = new FakeApi();
  const connection = await connected(api);
  try {
    const list = await connection.client.callTool({
      name: "duet_list_runs",
      arguments: { limit: 100 },
    });
    assert.equal(list.isError, undefined);
    assert.equal(
      (list.structuredContent?.runs as unknown[]).length,
      100,
    );
    assert.equal(list.structuredContent?.truncated, true);

    const detail = await connection.client.callTool({
      name: "duet_get_run",
      arguments: {
        runId: api.runs[0].id,
        sections: ["messages", "diff"],
      },
    });
    const sections = detail.structuredContent?.sections as {
      messages: {
        messages: Array<{ body: { text: string; truncated: boolean } }>;
        truncated: boolean;
      };
      diff: { text: string; truncated: boolean };
    };
    assert.ok(sections.messages.messages.length < 100);
    assert.ok(JSON.stringify(sections.messages).length <= 51_000);
    assert.equal(sections.messages.truncated, true);
    assert.equal(sections.messages.messages[0].body.truncated, true);
    assert.equal(sections.diff.truncated, true);
    assert.match(sections.messages.messages[0].body.text, /^<message>/);

    const artifact = await connection.client.callTool({
      name: "duet_read_artifact",
      arguments: { artifactId: 4, offset: 5, maximumLength: 4 },
    });
    assert.deepEqual(artifact.structuredContent, {
      artifactId: 4,
      content: "fghi",
      offset: 5,
      nextOffset: 9,
      totalLength: 26,
      truncated: true,
    });
  } finally {
    await connection.close();
  }
});

test("MCP schemas reject malformed IDs, paths, limits and oversized goals", async () => {
  const connection = await connected(new FakeApi());
  try {
    for (const request of [
      {
        name: "duet_get_run",
        arguments: { runId: "../escape" },
      },
      {
        name: "duet_read_artifact",
        arguments: { artifactId: 1, maximumLength: 65_537 },
      },
      {
        name: "duet_create_plan",
        arguments: {
          intentId: randomUUID(),
          repositoryPath: "relative",
          goal: "x".repeat(20_001),
          planningLead: "claude",
          maxTasks: 7,
          runWallClockSeconds: 60,
          maxAgentTurns: 1,
          claudeMaxUsdPerTurn: 1,
          claudeMaxUsdPerRun: 1,
          codexMaxInputTokens: 1,
          codexMaxOutputTokens: 1,
        },
      },
    ]) {
      const result = await connection.client.callTool(request);
      assert.equal(result.isError, true);
    }
  } finally {
    await connection.close();
  }
});

test("service failures return structured MCP errors", async () => {
  const api = new FakeApi();
  api.get = async () => {
    throw new DuetError(
      "Duet service is not running.",
      "SERVICE_NOT_RUNNING",
    );
  };
  const connection = await connected(api);
  try {
    const result = await connection.client.callTool({
      name: "duet_list_runs",
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent, {
      error: {
        code: "SERVICE_NOT_RUNNING",
        message: "Duet service is not running.",
      },
    });
  } finally {
    await connection.close();
  }
});

test("paid plan intent is idempotent and conflicting reuse is rejected", async () => {
  const api = new FakeApi();
  const connection = await connected(api);
  const intentId = randomUUID();
  const base = {
    intentId,
    repositoryPath: "C:\\repo with spaces",
    goal: "Create a bounded plan",
    planningLead: "codex",
    maxTasks: 3,
    runWallClockSeconds: 600,
    maxAgentTurns: 8,
    claudeMaxUsdPerTurn: 0.5,
    claudeMaxUsdPerRun: 2,
    codexMaxInputTokens: 100_000,
    codexMaxOutputTokens: 10_000,
  };
  try {
    const first = await connection.client.callTool({
      name: "duet_create_plan",
      arguments: base,
    });
    const second = await connection.client.callTool({
      name: "duet_create_plan",
      arguments: base,
    });
    assert.equal(
      first.structuredContent?.operationId,
      second.structuredContent?.operationId,
    );
    assert.equal(api.operations.size, 1);
    assert.equal(api.posts[0].idempotencyKey, `mcp-plan-${intentId}`);
    const conflict = await connection.client.callTool({
      name: "duet_create_plan",
      arguments: { ...base, goal: "Changed goal" },
    });
    assert.equal(conflict.isError, true);
    assert.equal(api.operations.size, 1);
  } finally {
    await connection.close();
  }
});

test("two MCP processes share duetd state and do not duplicate a pending plan turn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-mcp-service-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  const secret = "mcp-shared-service-secret";
  const service = new DuetService({
    store,
    secret,
    instanceId: "mcp-shared-service",
    idleTimeoutMs: 60_000,
  });
  const port = await service.listen();
  const apiOne = new HttpApi(`http://127.0.0.1:${port}`, secret);
  const apiTwo = new HttpApi(`http://127.0.0.1:${port}`, secret);
  const first = await connected(apiOne);
  const second = await connected(apiTwo);
  let finishPlan!: (run: RunRecord) => void;
  const pendingPlan = new Promise<RunRecord>((resolve) => {
    finishPlan = resolve;
  });
  let planningTurns = 0;
  service.app.plan = async () => {
    planningTurns += 1;
    return await pendingPlan;
  };
  const intentId = randomUUID();
  const input = {
    intentId,
    repositoryPath: directory,
    goal: "Keep the provider turn pending",
    planningLead: "claude",
    maxTasks: 2,
    runWallClockSeconds: 600,
    maxAgentTurns: 4,
    claudeMaxUsdPerTurn: 0.5,
    claudeMaxUsdPerRun: 1,
    codexMaxInputTokens: 50_000,
    codexMaxOutputTokens: 5_000,
  };
  try {
    const submitted = await first.client.callTool({
      name: "duet_create_plan",
      arguments: input,
    });
    const repeated = await second.client.callTool({
      name: "duet_create_plan",
      arguments: input,
    });
    assert.equal(
      submitted.structuredContent?.operationId,
      repeated.structuredContent?.operationId,
    );
    assert.equal(planningTurns, 1);
    assert.equal(
      (await apiOne.get<{ clientId: string }>("/api/v1/diagnostics")).clientId,
      "duet-mcp",
    );
    const polled = await second.client.callTool({
      name: "duet_get_operation",
      arguments: {
        operationId: submitted.structuredContent?.operationId,
      },
    });
    assert.ok(
      ["queued", "running"].includes(
        (polled.structuredContent?.operation as { status: string }).status,
      ),
    );
    const conflict = await second.client.callTool({
      name: "duet_create_plan",
      arguments: { ...input, goal: "Different input" },
    });
    assert.equal(conflict.isError, true);
  } finally {
    finishPlan({
      ...fixtureRun(0),
      id: "202601010101-shared",
      repoPath: directory,
      repoRoot: directory,
    });
    const operationId = store.listActiveOperations()[0]?.id;
    if (operationId) await service.activities.wait(operationId);
    await first.close();
    await second.close();
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stdio transport writes only newline-delimited JSON-RPC to stdout", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    stdout += chunk;
  });
  const server = createDuetMcpServer(async () => new FakeApi());
  await server.connect(new StdioServerTransport(input, output));
  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio-test", version: "1.0.0" },
    },
  })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await server.close();
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    const message = JSON.parse(line) as { jsonrpc?: string };
    assert.equal(message.jsonrpc, "2.0");
  }
});
