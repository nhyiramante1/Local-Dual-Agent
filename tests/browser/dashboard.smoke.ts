import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium, type Browser, type Page } from "@playwright/test";

import type {
  ProviderName,
  ManagerProviderName,
  RunRecord,
  TaskRecord,
} from "../../src/core/domain.js";
import { Store } from "../../src/persistence/store.js";
import type { ProviderAdapter } from "../../src/providers/adapter.js";
import {
  defaultManagerBudget,
  type ManagerBudget,
} from "../../src/chat/engine.js";
import { DuetService } from "../../src/service/server.js";
import type { ManagerProviderInfo } from "../../src/service/server.js";
import { runCommand } from "../../src/process/run-command.js";

const SECRET = "dashboard-smoke-secret";
const FIXED = "2026-06-01T00:00:00.000Z";
const XSS = "<img src=x onerror=\"window.__xss=1\">manager reply";
const PROPOSAL_XSS = "<img src=x onerror=\"window.__proposalXss=1\">copy the command";

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

interface Harness {
  base: string;
  store: Store;
  service: DuetService;
  calls: { n: number };
  arm: () => void;
  release: () => void;
  ticket: () => Promise<string>;
  cleanup: () => Promise<void>;
}

let browser: Browser | null = null;

test.before(async () => {
  const fallbackBrowsers = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  try {
    browser = await chromium.launch({ headless: true });
    return;
  } catch (error) {
    const bundledMessage = error instanceof Error ? error.message : String(error);
    for (const executablePath of fallbackBrowsers) {
      if (!existsSync(executablePath)) continue;
      try {
        browser = await chromium.launch({ executablePath, headless: true });
        return;
      } catch {
        // Try the next installed Chromium-family browser.
      }
    }
    throw new Error(
      `Chromium is required for dashboard smoke tests. Run: npx playwright install chromium\n${bundledMessage}`,
    );
  }
});

test.after(async () => {
  await browser?.close();
});

function makeGate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

function runRecord(id: string, goal: string, repoRoot: string): RunRecord {
  return {
    id,
    repoPath: repoRoot,
    repoRoot,
    goal,
    status: "running",
    leadProvider: "claude",
    baseBranch: "main",
    baseCommit: "abc0000",
    integrationBranch: `duet/${id}/integration`,
    plan: { summary: goal, tasks: [], risks: [] },
    configJson: "{}",
    cancellationRequested: false,
    createdAt: FIXED,
    updatedAt: FIXED,
  };
}

function taskRecord(runId: string, id: string, title: string): TaskRecord {
  return {
    runId,
    id,
    ordinal: 0,
    plan: {
      id,
      title,
      objective: `do ${title}`,
      acceptanceCriteria: ["works"],
      allowedPaths: ["src/**"],
      dependencies: [],
    },
    status: "ready",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    cancellationRequested: false,
    createdAt: FIXED,
    updatedAt: FIXED,
  };
}

async function gitInit(dir: string): Promise<void> {
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "smoke@example.invalid"],
    ["config", "user.name", "Smoke"],
    ["commit", "--allow-empty", "-m", "seed"],
  ]) {
    const result = await runCommand("git", args, { cwd: dir });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  }
}

async function startHarness(
  options: {
    managerBudget?: ManagerBudget;
    gitRepo?: boolean;
    managerProvider?: ManagerProviderName;
    managerProviders?: ManagerProviderInfo[];
  } = {},
): Promise<Harness> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-dash-smoke-"));
  const repoA = path.join(directory, "repo-a");
  const repoB = path.join(directory, "repo-b");
  await mkdir(repoA, { recursive: true });
  await mkdir(repoB, { recursive: true });
  if (options.gitRepo) {
    await gitInit(repoA);
    await gitInit(repoB);
  }

  const store = new Store(path.join(directory, "state.sqlite"));
  const calls = { n: 0 };
  let gate: Gate | null = null;
  const provider: ProviderAdapter = {
    name: "codex" as ProviderName,
    async run(turn) {
      calls.n += 1;
      while (gate) {
        if (turn.shouldCancel?.()) {
          throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
        }
        await Promise.race([
          gate.promise,
          new Promise((resolve) => setTimeout(resolve, 10)),
        ]);
      }
      return {
        provider: "codex",
        sessionId: "sess-smoke",
        finalText: "manager reply from stub",
        stdout: "",
        stderr: "",
        durationMs: 1,
        usage: {
          costUsd: 0.01,
          costKnown: true,
          inputTokens: 10,
          outputTokens: 5,
        },
      };
    },
  };

  store.createRun(runRecord("run-a", "Add a healthz endpoint", repoA), [
    taskRecord("run-a", "task-a1", "Add route handler"),
    taskRecord("run-a", "task-a2", "Add unit test"),
  ]);
  store.updateRun("run-a", { status: "running", error: null });
  store.recordVerification("run-a", "task-a1", 1, {
    command: ["npm", "test"],
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1200,
    passed: true,
  });
  const convA = store.createConversation({
    id: "conv-a",
    runId: "run-a",
    interfaceAgent: "codex",
  });
  store.appendConversationTurn({
    conversationId: convA.id,
    role: "user",
    content: "What is happening?",
  });
  const managerTurn = store.appendConversationTurn({
    conversationId: convA.id,
    role: "manager",
    interfaceAgent: "codex",
    content: XSS,
    usageJson: JSON.stringify({ costUsd: 0.01, costKnown: true }),
  });
  store.createProposal({
    id: "proposal-a",
    conversationId: convA.id,
    turnId: managerTurn.id,
    runId: "run-a",
    taskId: "task-a1",
    action: "retry_task",
    summary: PROPOSAL_XSS,
    commandCli: "duet retry run-a task-a1",
    commandJson: JSON.stringify({
      action: "retry_task",
      runId: "run-a",
      taskId: "task-a1",
    }),
    tier: "ordinary",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  store.createProposal({
    id: "proposal-fingerprint",
    conversationId: convA.id,
    turnId: managerTurn.id,
    runId: "run-a",
    action: "approve_merge",
    summary: "Approve the merge after reviewing the final diff.",
    commandCli: "duet approve run-a --stage merge",
    commandJson: JSON.stringify({
      action: "approve_merge",
      runId: "run-a",
    }),
    tier: "fingerprint",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  store.createProposal({
    id: "proposal-consultation",
    conversationId: convA.id,
    turnId: managerTurn.id,
    action: "agent_consultation",
    summary: "Ask Claude and Codex whether the plan is safe.",
    commandCli: "Agent consultation consent request (execution is deferred in Phase 7A).",
    commandJson: JSON.stringify({
      action: "agent_consultation",
      agents: ["claude", "codex"],
      mode: "independent",
      profile: "cheap",
    }),
    tier: "ordinary",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  store.createRun(runRecord("run-b", "Refactor logging", repoB), [
    taskRecord("run-b", "task-b1", "Introduce logger"),
  ]);
  store.updateRun("run-b", { status: "running", error: null });

  const service = new DuetService({
    store,
    secret: SECRET,
    instanceId: "dashboard-smoke",
    idleTimeoutMs: 600_000,
    chatProviders: { claude: provider, codex: provider },
    managerBudget: options.managerBudget,
    managerProvider: options.managerProvider,
    managerProviders: options.managerProviders,
  });
  const port = await service.listen();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    store,
    service,
    calls,
    arm: () => {
      gate = makeGate();
    },
    release: () => {
      const current = gate;
      gate = null;
      current?.release();
    },
    ticket: async () => {
      const res = await fetch(`${base}/api/v1/dashboard/ticket`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(res.status, 200);
      return ((await res.json()) as { data: { ticket: string } }).data.ticket;
    },
    cleanup: async () => {
      const current = gate;
      gate = null;
      current?.release();
      await assertEventually(async () => {
        assert.equal(store.listActiveOperations().length, 0);
      }, 5_000).catch(() => {
        // If cleanup is running after an assertion failure, close best-effort.
      });
      await service.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  assert.ok(browser, "browser was not started");
  const page = await browser.newPage();
  try {
    await page.route("**/favicon.ico", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function open(page: Page, h: Harness): Promise<void> {
  await page.goto(`${h.base}/#${await h.ticket()}`);
  await waitForClass(page, "#health", /ok/);
}

async function selectRun(page: Page, id: string): Promise<void> {
  await page.locator(`#runs button[data-id="${id}"]`).click();
  await waitForClass(page, `#runs button[data-id="${id}"]`, /sel/);
}

async function waitForChatEnabled(page: Page): Promise<void> {
  await assertEventually(async () => {
    assert.equal(await page.locator("#chat-input").isEnabled(), true);
    assert.equal(await page.locator("#chat-send").isEnabled(), true);
  });
}

async function chooseManager(page: Page, agent: string): Promise<void> {
  const target = page.locator(`#chat-${agent}`);
  if (await target.isVisible().catch(() => false)) {
    await target.click();
    return;
  }
  const current = (await page.locator("#chat-provider-current").textContent()) ?? "";
  if (current.toLowerCase().includes(agent.toLowerCase())) return;
  await page.locator("#chat-provider-current").click();
  await target.click();
}

function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text === "Failed to load resource: the server responded with a status of 404 (Not Found)") {
      return;
    }
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function waitForText(
  page: Page,
  selector: string,
  expected: string | RegExp,
): Promise<void> {
  await page.locator(selector).waitFor({ state: "attached" });
  await assertEventually(async () => {
    const text = (await page.locator(selector).textContent()) ?? "";
    if (typeof expected === "string") assert.ok(text.includes(expected), text);
    else assert.match(text, expected);
  });
}

async function waitForNoText(
  page: Page,
  selector: string,
  unexpected: string,
): Promise<void> {
  await assertEventually(async () => {
    const text = (await page.locator(selector).textContent()) ?? "";
    assert.ok(!text.includes(unexpected), text);
  });
}

async function waitForClass(
  page: Page,
  selector: string,
  expected: RegExp,
): Promise<void> {
  await page.locator(selector).waitFor({ state: "visible" });
  await assertEventually(async () => {
    assert.match((await page.locator(selector).getAttribute("class")) ?? "", expected);
  });
}

async function assertEventually(
  check: () => Promise<void> | void,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw last;
}

test("loads Run A panels and chat with no console errors", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      const errors = trackConsole(page);
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#summary", "Add a healthz endpoint");
      await waitForText(page, "#tasks", "Add route handler");
      await waitForText(page, "#verification", "PASS");
      await waitForText(page, "#events", "run.created");
      await waitForText(page, "#chat-turns", "What is happening?");
      assert.deepEqual(errors, []);
    });
  } finally {
    await h.cleanup();
  }
});

test("shared manager context tab shows provider health notes", async () => {
  const h = await startHarness();
  try {
    h.store.addManagerSharedContext({
      runId: "run-a",
      kind: "provider_health",
      provider: "groq",
      content: "Groq is rate limited. Try Gemini.",
    });
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await page.locator('[data-section="memory"]').click();
      await waitForText(page, "#manager-memory", "provider health");
      await waitForText(page, "#manager-memory", "Groq is rate limited");
    });
  } finally {
    await h.cleanup();
  }
});

test("dashboard renders dynamic manager provider buttons", async () => {
  const h = await startHarness({
    managerProviders: [
      { id: "codex", label: "Codex", available: true, nativeToolCalling: false, latency: "slow" },
      { id: "claude", label: "Claude", available: true, nativeToolCalling: false, latency: "slow" },
      { id: "glm", label: "GLM", available: true, nativeToolCalling: true, latency: "fast" },
    ],
  });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await page.locator("#chat-provider-current").click();
      await waitForText(page, "#manager-voices", "GLM");
      await waitForText(page, "#manager-voices", "fast");
      assert.equal(await page.locator('#manager-voices [data-agent="glm"]').count(), 1);
      await chooseManager(page, "glm");
      await page.locator("#chat-provider-current").click();
      assert.equal(await page.locator('#manager-voices [data-agent="glm"]').count(), 0);
      assert.ok(await page.locator('#manager-voices [data-agent="codex"]').count() > 0);
    });
  } finally {
    await h.cleanup();
  }
});

test("dashboard skips unavailable default manager providers", async () => {
  const h = await startHarness({
    managerProvider: "glm",
    managerProviders: [
      { id: "glm", label: "GLM", available: false, nativeToolCalling: true, latency: "fast" },
      { id: "groq", label: "Groq", available: true, nativeToolCalling: true, latency: "fast" },
      { id: "codex", label: "Codex", available: true, nativeToolCalling: false, latency: "slow" },
      { id: "claude", label: "Claude", available: true, nativeToolCalling: false, latency: "slow" },
    ],
  });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await waitForText(page, "#chat-provider-current", "Groq");
      await waitForText(page, "#chat-turns", "No global conversation yet");
      await page.locator("#chat-provider-current").click();
      await page.locator("#chat-glm").click();
      await waitForText(page, "#chat-status", "GLM is not configured");
      await waitForText(page, "#chat-provider-current", "Groq");
    });
  } finally {
    await h.cleanup();
  }
});

test("switching A -> B -> A clears stale state and does not duplicate events", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#events", "run.created");
      await selectRun(page, "run-b");
      await waitForText(page, "#summary", "Refactor logging");
      await waitForNoText(page, "#chat-turns", "What is happening?");
      await selectRun(page, "run-a");
      await waitForText(page, "#summary", "Add a healthz endpoint");
      await assertEventually(async () => {
        assert.equal(
          await page.locator("#events .ty", { hasText: "run.created" }).count(),
          1,
        );
      });
    });
  } finally {
    await h.cleanup();
  }
});

test("switching Manager voice preserves the selected run", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await chooseManager(page, "claude");
      await waitForText(page, "#chat-provider-current", "Claude");
      await waitForClass(page, `#runs button[data-id="run-a"]`, /sel/);
      await waitForText(page, "#summary", "Add a healthz endpoint");
    });
  } finally {
    await h.cleanup();
  }
});

test("seeded XSS turn renders as text, not executed HTML", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "manager reply");
      assert.equal(await page.locator("#chat-turns img").count(), 0);
      assert.equal(
        await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
        undefined,
      );
    });
  } finally {
    await h.cleanup();
  }
});

test("tool trace renders compact statuses and folder-first search details", async () => {
  const h = await startHarness();
  try {
    const conversation = h.store.getConversation("conv-a");
    h.store.appendConversationTurn({
      conversationId: conversation.id,
      role: "manager",
      interfaceAgent: "codex",
      content: "I found likely game-related items in Downloads.",
      usageJson: JSON.stringify({
        toolRuntime: true,
        toolTrace: [
          {
            name: "search_files",
            ok: true,
            elapsedMs: 12,
            arguments: {
              path: "C:\\Users\\nhyir\\Downloads",
              kind: "file",
              namePattern: "*.exe",
            },
            result: {
              matchCount: 2,
              entriesScanned: 741,
              folderMatches: [
                { path: "C:\\Users\\nhyir\\Downloads\\Grand Theft Auto V Enhanced", matchCount: 1 },
              ],
              matches: [
                { path: "C:\\Users\\nhyir\\Downloads\\Grand Theft Auto V Enhanced\\Redistributables\\Rockstar-Games-Launcher.exe", type: "file" },
              ],
            },
          },
          {
            name: "check_path",
            ok: false,
            elapsedMs: 1,
            arguments: {
              path: "C:\\missing",
            },
            result: {
              code: "PATH_NOT_FOUND",
              message: "Path does not exist.",
            },
          },
        ],
      }),
    });
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "I found likely game-related items in Downloads.");
      await waitForText(page, "#chat-turns", "2 matches");
      await waitForText(page, "#chat-turns", "path not found");
      await waitForText(page, "#chat-turns", "Path does not exist.");
      await page.locator(".tool-trace-details summary").first().click();
      await waitForText(page, "#chat-turns", "top folders");
      await waitForText(page, "#chat-turns", "Grand Theft Auto V Enhanced");
    });
  } finally {
    await h.cleanup();
  }
});

test("proposal cards render safely and copy the exact CLI command", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      const errors = trackConsole(page);
      await open(page, h);
      await page.evaluate(`
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.__copied = text;
            },
          },
        });
      `);
      await selectRun(page, "run-a");
      const ordinary = '[data-proposal-id="proposal-a"]';
      await waitForText(page, ordinary, "Suggested action");
      await waitForText(page, ordinary, "retry task");
      await waitForText(page, ordinary, "task task-a1");
      await waitForText(page, ordinary, "duet retry run-a task-a1");
      await waitForText(page, ordinary, "copy the command");
      assert.equal(await page.locator(`${ordinary} img`).count(), 0);
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __proposalXss?: number }).__proposalXss,
        ),
        undefined,
      );

      await page.locator(`${ordinary} button`, { hasText: "Copy CLI" }).click();
      await waitForText(page, "#chat-status", "Command copied");
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __copied?: string }).__copied,
        ),
        "duet retry run-a task-a1",
      );

      const consultation = '[data-proposal-id="proposal-consultation"]';
      await waitForText(page, consultation, "agent consultation");
      await waitForText(page, consultation, "read-only");
      await waitForText(page, consultation, "their replies appear here in the chat");
      // Executable now: the consent card has a one-click Start affordance and no
      // fingerprint readiness step.
      assert.equal(await page.locator(`${consultation} [data-proposal-start]`).count(), 1);
      assert.equal(await page.locator(`${consultation} [data-proposal-prepare]`).count(), 0);
      assert.deepEqual(errors, []);
    });
  } finally {
    await h.cleanup();
  }
});

test("proposal readiness renders available ordinary and fingerprint requirements", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      const beforeRun = h.store.getRun("run-a");
      const beforeEvents = h.store.listEvents({}).length;
      const ordinary = page
        .locator(".proposal-card")
        .filter({ hasText: "duet retry run-a task-a1" });
      await ordinary.locator("button", { hasText: "Check readiness" }).click();
      await waitForText(page, '[data-proposal-id="proposal-a"]', "Ready to copy");
      await waitForText(page, '[data-proposal-id="proposal-a"]', "The CLI will re-check run and task state");
      const startInput = page.locator('[data-proposal-id="proposal-a"] [data-proposal-start-input]');
      const startButton = page.locator('[data-proposal-id="proposal-a"] [data-proposal-start]');
      await assertEventually(async () => {
        assert.equal(await startButton.isDisabled(), true);
      });
      await startInput.fill("almost");
      assert.equal(await startButton.isDisabled(), true);
      await startInput.fill("start");
      assert.equal(await startButton.isEnabled(), true);

      const fingerprint = page
        .locator(".proposal-card")
        .filter({ hasText: "duet approve run-a --stage merge" });
      await fingerprint.locator("button", { hasText: "Check readiness" }).click();
      await waitForText(page, '[data-proposal-id="proposal-fingerprint"]', "Duet will print a fingerprint");
      await waitForText(page, '[data-proposal-id="proposal-fingerprint"]', "Fingerprint-gated actions remain CLI-only");
      assert.equal(
        await page.locator('[data-proposal-id="proposal-fingerprint"] [data-proposal-start]').count(),
        0,
      );

      assert.equal(h.store.getRun("run-a").version, beforeRun.version);
      assert.equal(
        h.store
          .listEvents({})
          .filter((event) => event.type.startsWith("action_ticket.")).length,
        0,
      );
      assert.equal(h.store.listEvents({}).length, beforeEvents);
    });
  } finally {
    await h.cleanup();
  }
});

test("starting an ordinary proposal polls the operation and removes the card", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      const errors = trackConsole(page);
      await open(page, h);
      await selectRun(page, "run-a");
      await page
        .locator('[data-proposal-id="proposal-a"] button', {
          hasText: "Check readiness",
        })
        .click();
      const startInput = page.locator('[data-proposal-id="proposal-a"] [data-proposal-start-input]');
      const startButton = page.locator('[data-proposal-id="proposal-a"] [data-proposal-start]');
      await startInput.fill("start");
      await startButton.click();
      await waitForText(page, "#chat-status", /Duet operation (running|failed|succeeded)/);
      await assertEventually(async () => {
        assert.equal(h.store.getProposal("proposal-a").status, "started");
      });
      await waitForNoText(page, "#chat-turns", "duet retry run-a task-a1");
      assert.equal(
        h.store
          .listEvents({})
          .filter((event) => event.type.startsWith("action_ticket.")).length,
        0,
      );
      assert.ok(h.store.listActiveOperations("run-a").length <= 1);
      assert.deepEqual(errors, []);
    });
  } finally {
    await h.cleanup();
  }
});

test("proposal readiness shows blocked reasons safely", async () => {
  const h = await startHarness();
  try {
    h.store.createOperation({
      id: 'active-<img src=x onerror="window.__blockedXss=1">',
      runId: "run-a",
      kind: "retry",
      status: "running",
      serviceInstanceId: "dashboard-smoke",
      inputHash: "hash",
      createdAt: FIXED,
    });
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      const ordinary = page
        .locator(".proposal-card")
        .filter({ hasText: "duet retry run-a task-a1" });
      await ordinary.locator("button", { hasText: "Check readiness" }).click();
      await waitForText(page, '[data-proposal-id="proposal-a"]', "Not ready");
      await waitForText(page, '[data-proposal-id="proposal-a"]', "already has active operation");
      assert.equal(await page.locator('[data-proposal-id="proposal-a"] img').count(), 0);
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { __blockedXss?: number }).__blockedXss,
        ),
        undefined,
      );
      assert.equal(h.store.getProposal("proposal-a").status, "proposed");
      assert.equal(h.store.getRun("run-a").status, "running");
    });
  } finally {
    await h.cleanup();
  }
});

test("stale proposal readiness collapses instead of showing a live not-ready card", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      const card = page.locator('[data-proposal-id="proposal-a"]');
      await waitForText(page, '[data-proposal-id="proposal-a"]', "duet retry run-a task-a1");
      await page.route("**/api/v1/chat/conversations/conv-a/proposals/proposal-a/prepare", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            apiVersion: "v1",
            requestId: "smoke-stale-prepare",
            data: {
              proposalId: "proposal-a",
              action: "retry_task",
              tier: "ordinary",
              runId: "run-a",
              taskId: "task-a1",
              commandCli: "duet retry run-a task-a1",
              available: false,
              requirements: [],
              warnings: ["This suggestion is no longer active."],
              blockedReason: "This suggestion is no longer active.",
            },
          }),
        });
      });
      await card.locator("button", { hasText: "Check readiness" }).click();
      await waitForText(page, '[data-proposal-id="proposal-a"]', "Suggestion is no longer active");
      await waitForNoText(page, '[data-proposal-id="proposal-a"]', "Not ready");
      assert.equal(await card.locator('button', { hasText: "Check readiness" }).isDisabled(), true);
      assert.equal(await card.locator('button', { hasText: "Copy CLI" }).isDisabled(), true);
    });
  } finally {
    await h.cleanup();
  }
});

test("run-scoped manager empty state shows planning status", async () => {
  const h = await startHarness();
  try {
    h.store.updateRun("run-a", { status: "planning", error: null });
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await chooseManager(page, "claude");
      await waitForText(page, "#chat-turns", "claude is planning");
      await waitForText(page, "#chat-turns", "Watch the Timeline");

      h.store.updateRun("run-a", { status: "awaiting_plan_approval", error: null });
      await selectRun(page, "run-a");
      await chooseManager(page, "claude");
      await waitForText(page, "#chat-turns", "Plan ready for approval");
      await waitForText(page, "#chat-turns", "Review the Plan panel");
    });
  } finally {
    await h.cleanup();
  }
});

test("dismissing a proposal removes only chat-state suggestion data", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, '[data-proposal-id="proposal-a"]', "duet retry run-a task-a1");
      const beforeRun = h.store.getRun("run-a");
      const beforeTasks = h.store.listTasks("run-a").map((task) => ({
        id: task.id,
        status: task.status,
        version: task.version,
      }));
      const beforeOperations = h.store.listActiveOperations().length;

      await page.locator('[data-proposal-id="proposal-a"] button', { hasText: "Dismiss" }).click();
      await waitForNoText(page, "#chat-turns", "duet retry run-a task-a1");

      const afterRun = h.store.getRun("run-a");
      assert.equal(afterRun.status, beforeRun.status);
      assert.equal(afterRun.version, beforeRun.version);
      assert.equal(h.store.isApproved("run-a", "plan"), false);
      assert.deepEqual(
        h.store.listTasks("run-a").map((task) => ({
          id: task.id,
          status: task.status,
          version: task.version,
        })),
        beforeTasks,
      );
      assert.equal(h.store.listActiveOperations().length, beforeOperations);
      assert.equal(h.store.getProposal("proposal-a").status, "dismissed");
    });
  } finally {
    await h.cleanup();
  }
});

test("dashboard session can dismiss the same proposal twice without run mutation", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      const result = await page.evaluate(async () => {
        const first = await fetch(
          "/api/v1/chat/conversations/conv-a/proposals/proposal-a/dismiss",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "smoke-dismiss-repeat-1",
            },
            body: "{}",
            credentials: "same-origin",
          },
        );
        const second = await fetch(
          "/api/v1/chat/conversations/conv-a/proposals/proposal-a/dismiss",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "smoke-dismiss-repeat-2",
            },
            body: "{}",
            credentials: "same-origin",
          },
        );
        const mutate = await fetch("/api/v1/runs/run-a/cancel", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "smoke-dismiss-cancel-1",
          },
          body: JSON.stringify({ expectedVersion: 1 }),
          credentials: "same-origin",
        });
        return { first: first.status, second: second.status, mutate: mutate.status };
      });
      assert.deepEqual(result, { first: 200, second: 200, mutate: 403 });
      assert.equal(h.store.getProposal("proposal-a").status, "dismissed");
      assert.equal(
        h.store
          .listEvents({})
          .filter((event) => event.type === "chat.proposal.dismissed").length,
        1,
      );
      assert.equal(h.store.getRun("run-a").version, 2);
    });
  } finally {
    await h.cleanup();
  }
});

test("sending shows pending, disables input, then renders the reply after release", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "What is happening?");
      await waitForChatEnabled(page);
      h.arm();
      await page.locator("#chat-input").fill("status please");
      await page.locator("#chat-send").click();
      await waitForText(page, "#chat-turns", "status please");
      await assertEventually(async () => {
        assert.equal(await page.locator("#chat-input").isDisabled(), true);
      });
      h.release();
      await waitForText(page, "#chat-turns", "manager reply from stub");
      await assertEventually(async () => {
        assert.equal(await page.locator("#chat-input").isEnabled(), true);
        assert.equal(await page.locator("#chat-send").isEnabled(), true);
      });
    });
  } finally {
    h.release();
    await h.cleanup();
  }
});

test("stop button cancels an active manager turn", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "What is happening?");
      await waitForChatEnabled(page);
      h.arm();
      await page.locator("#chat-input").fill("please keep searching");
      await page.locator("#chat-send").click();
      await waitForText(page, "#chat-turns", "please keep searching");
      await assertEventually(async () => {
        assert.equal(h.store.listActiveOperations().length > 0, true);
      });
      // The composer Stop is scoped to the current manager turn: it hits the
      // per-operation cancel route, not the global cancel-active.
      const cancelResponse = page.waitForResponse((response) =>
        /\/operations\/[^/]+\/cancel$/.test(response.url()) && response.request().method() === "POST",
      );
      await page.locator("#chat-send").click();
      await cancelResponse;
      h.release();
      await assertEventually(async () => {
        assert.equal(await page.locator("#chat-input").isEnabled(), true);
      });
    });
  } finally {
    h.release();
    await h.cleanup();
  }
});

test("input stays disabled while a turn is pending even when switching run/voice", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "What is happening?");
      await waitForChatEnabled(page);
      h.arm();
      await page.locator("#chat-input").fill("hold please");
      await page.locator("#chat-input").press("Enter");
      await assertEventually(async () => {
        assert.equal(await page.locator("#chat-input").isDisabled(), true);
      });
      await chooseManager(page, "claude");
      assert.equal(await page.locator("#chat-input").isDisabled(), true);
      await selectRun(page, "run-b");
      assert.equal(await page.locator("#chat-input").isDisabled(), true);
      h.release();
      await assertEventually(async () => {
        assert.equal(h.store.listActiveOperations().length, 0);
      });
    });
  } finally {
    h.release();
    await h.cleanup();
  }
});

test("sending on a run without a conversation creates one", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-b");
      await waitForChatEnabled(page);
      await page.locator("#chat-input").fill("hello run b");
      await page.locator("#chat-send").click();
      await waitForText(page, "#chat-turns", "hello run b");
      await waitForText(page, "#chat-turns", "manager reply from stub");
      assert.equal(h.store.listConversations("run-b").length, 1);
    });
  } finally {
    await h.cleanup();
  }
});

test("clear context starts a fresh thread for the current run and voice", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "What is happening?");
      const before = h.store.listConversations("run-a").map((conversation) => conversation.id);
      await page.locator("#chat-clear").click();
      await waitForText(page, "#chat-turns", "No turns yet.");
      const after = h.store.listConversations("run-a").map((conversation) => conversation.id);
      assert.equal(after.length, before.length + 1);
      assert.notEqual(after[0], before[0]);
      await page.locator("#chat-input").fill("fresh thread");
      await page.locator("#chat-send").click();
      await waitForText(page, "#chat-turns", "fresh thread");
      await waitForText(page, "#chat-turns", "manager reply from stub");
    });
  } finally {
    await h.cleanup();
  }
});

test("action-like text stays chat and does not mutate the run", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForText(page, "#chat-turns", "What is happening?");
      await waitForChatEnabled(page);
      const before = h.store.getRun("run-a").version;
      await page.locator("#chat-input").fill("/approve plan");
      await page.locator("#chat-input").press("Enter");
      await waitForText(page, "#chat-turns", "/approve plan");
      await waitForText(page, "#chat-turns", "manager reply from stub");
      assert.equal(h.store.isApproved("run-a", "plan"), false);
      assert.equal(h.store.getRun("run-a").version, before);
    });
  } finally {
    await h.cleanup();
  }
});

test("budget exceeded renders a safe visible limit message", async () => {
  const h = await startHarness({
    managerBudget: { ...defaultManagerBudget, maxTurnsPerDay: 0 },
  });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForChatEnabled(page);
      await page.locator("#chat-input").fill("anything");
      await page.locator("#chat-send").click();
      await waitForText(page, "#chat-status", /BUDGET_EXCEEDED|budget|turn limit/i);
      assert.match((await page.locator("#chat-status").getAttribute("class")) ?? "", /muted/);
      assert.equal(h.calls.n, 0);
    });
  } finally {
    await h.cleanup();
  }
});

test("Enter sends, Shift+Enter inserts a newline, and IME composition does not send", async () => {
  const h = await startHarness({ gitRepo: true });
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      await waitForChatEnabled(page);
      const input = page.locator("#chat-input");
      await input.click();
      await input.fill("composing");
      await page.dispatchEvent("#chat-input", "keydown", {
        key: "Enter",
        isComposing: true,
      });
      assert.equal(await input.inputValue(), "composing");
      await input.fill("line one");
      await input.press("Shift+Enter");
      await input.type("line two");
      assert.match(await input.inputValue(), /\n/);
      await input.press("Enter");
      await waitForText(page, "#chat-turns", "line one");
      await waitForText(page, "#chat-turns", "manager reply from stub");
    });
  } finally {
    await h.cleanup();
  }
});

test("dashboard session can use chat routes but not run mutations", async () => {
  const h = await startHarness();
  try {
    await withPage(async (page) => {
      await open(page, h);
      await selectRun(page, "run-a");
      const result = await page.evaluate(async () => {
        const mutate = await fetch("/api/v1/runs/run-a/cancel", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "smoke-cancel-1",
          },
          body: JSON.stringify({ expectedVersion: 1 }),
          credentials: "same-origin",
        });
        const chat = await fetch("/api/v1/chat/conversations?runId=run-a", {
          credentials: "same-origin",
        });
        return { mutate: mutate.status, chat: chat.status };
      });
      assert.equal(result.mutate, 403);
      assert.equal(result.chat, 200);
    });
  } finally {
    await h.cleanup();
  }
});
