import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildManagerChatContext,
  type ChatContextOptions,
} from "../src/chat/context.js";
import { ChatEngine, defaultManagerBudget } from "../src/chat/engine.js";
import type {
  AgentResult,
  ProviderName,
  RunRecord,
  TaskRecord,
  VerificationResult,
} from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";
import type { ProviderAdapter } from "../src/providers/adapter.js";

async function withStore<T>(
  fn: (store: Store, directory: string) => Promise<T> | T,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-chat-context-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    await fn(store, directory);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function runRecords(directory: string): {
  run: RunRecord;
  task: TaskRecord;
} {
  const stamp = new Date().toISOString();
  const run: RunRecord = {
    id: "context-run",
    repoPath: directory,
    repoRoot: directory,
    goal: "Add useful manager chat context.",
    status: "approved",
    leadProvider: "codex",
    baseBranch: "main",
    baseCommit: "abc123",
    integrationBranch: "duet/context-run/integration",
    plan: {
      summary: "Context plan",
      risks: ["Too much context"],
      tasks: [
        {
          id: "task-1",
          title: "Build bounded context",
          objective: "Summarize run state without leaking giant artifacts.",
          acceptanceCriteria: ["Prompt is bounded"],
          allowedPaths: ["src/chat/**"],
          dependencies: [],
        },
      ],
    },
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const task: TaskRecord = {
    runId: run.id,
    id: "task-1",
    ordinal: 0,
    plan: run.plan!.tasks[0],
    status: "completed",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    review: {
      verdict: "approve",
      summary: "Looks bounded.",
      findings: [],
    },
    reviewedArtifact: {
      treeId: "tree-1",
      diffHash: "diff-hash-1",
      diff: `GIANT_DIFF_${"x".repeat(20_000)}`,
      changedPaths: ["src/chat/context.ts"],
    },
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return { run, task };
}

function tinyOptions(
  overrides: Partial<ChatContextOptions> = {},
): Partial<ChatContextOptions> {
  return {
    totalPromptCap: 1_000,
    conversationSectionCap: 300,
    runSectionCap: 300,
    eventsSectionCap: 200,
    verificationMessagesSectionCap: 200,
    recentTurnLimit: 3,
    recentEventLimit: 2,
    verificationLimit: 2,
    messageLimit: 2,
    ...overrides,
  };
}

test("context includes recent conversation turns chronologically without a run", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
      title: "unlinked",
    });
    for (let index = 1; index <= 6; index += 1) {
      store.appendConversationTurn({
        conversationId: conversation.id,
        role: "user",
        content: `message ${index}`,
      });
    }

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { recentTurnLimit: 3 },
    );

    assert.match(context.prompt, /## Manager Rules/);
    assert.match(context.prompt, /reasoning partner/i);
    assert.match(context.prompt, /Conversation and reasoning come first/i);
    assert.match(context.prompt, /Do not restate your role or limitations/i);
    assert.match(context.prompt, /untrusted/);
    assert.match(context.prompt, /## Action Proposal Format/);
    assert.match(context.prompt, /Proposals are suggestions only/);
    assert.match(context.prompt, /server synthesizes/);
    assert.match(context.prompt, /create_plan.*set_strategy.*set_alias are only valid in global chat/);
    assert.match(context.prompt, /general workflow or tooling questions, answer them directly/i);
    assert.match(context.prompt, /Do not tack a proposal onto a conversational answer/i);
    assert.match(context.prompt, /If a planner operation is already queued or running/i);
    assert.match(context.prompt, /## Conversation/);
    assert.doesNotMatch(context.prompt, /message 1/);
    assert.match(context.prompt, /message 4/);
    assert.ok(
      context.prompt.indexOf("message 4") < context.prompt.indexOf("message 6"),
    );
    assert.ok(context.metadata.omitted.includes("Run And Tasks"));
  });
});

test("tool-runtime context omits the legacy proposal format and labels turns as history", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "what can you do",
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );

    // Legacy fenced-block instructions must not appear in the tool runtime.
    assert.doesNotMatch(context.prompt, /## Action Proposal Format/);
    assert.doesNotMatch(context.prompt, /duet-proposal/);
    // Native tool guidance replaces it.
    assert.match(context.prompt, /## Manager Tools/);
    assert.match(context.prompt, /Default to conversation/i);
    assert.match(context.prompt, /bare acknowledgements/i);
    // Recent turns are explicitly framed as history, not the current request.
    assert.match(context.prompt, /history of THIS thread/i);
    assert.match(context.prompt, /current request is the LAST user turn/i);
  });
});

test("tool-runtime context includes evidence rubric and search-inference guidance", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );

    // Evidence rubric: all three confidence levels must be named.
    assert.match(context.prompt, /\bconfirmed\b/);
    assert.match(context.prompt, /\blikely\b/);
    assert.match(context.prompt, /\bunclear\b/);
    // The rubric must instruct the model not to present likely/unclear as confirmed.
    assert.match(context.prompt, /Never present a likely or unclear finding as confirmed/i);

    // Over-inference guard: installer/launcher binaries are weak evidence.
    assert.match(context.prompt, /Installer binaries/i);
    assert.match(context.prompt, /launcher/i);
    assert.match(context.prompt, /weak evidence/i);
    assert.match(context.prompt, /check_git_repo or check_path before calling something a project/i);

    // Candidate-folders-first: surface candidates before drilling into files.
    assert.match(context.prompt, /candidate folders/i);
    assert.match(context.prompt, /folderMatches/);
    assert.match(context.prompt, /Descend into a specific folder only when/i);

    // Always answer in prose — never end a turn with only tool calls (the cause
    // of the misleading backend fallback when the model returns empty text).
    assert.match(context.prompt, /Always finish your turn with a short prose answer/i);
    assert.match(context.prompt, /Never end a turn with only tool calls/i);

    // Over-inference guard: do not describe folder contents/purpose from names.
    assert.match(context.prompt, /Report only the exact names and paths the tools returned/i);
    assert.match(context.prompt, /a directory listing is not evidence of what is inside/i);

    // Section cap is sufficient — the Manager Tools block must not be truncated.
    const toolsBody = context.prompt.match(/## Manager Tools\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
    assert.ok(
      !toolsBody.includes("[truncated from "),
      `Manager Tools section was truncated: ${toolsBody.slice(-120)}`,
    );

    // Guidance must NOT appear in the legacy (non-tool-runtime) path.
    const legacy = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: false },
    );
    assert.doesNotMatch(legacy.prompt, /Reading filesystem evidence/i);
    assert.doesNotMatch(legacy.prompt, /Installer binaries/i);
  });
});

test("shared manager context appears as cross-provider evidence", async () => {
  await withStore((store) => {
    const groqConversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    const turn = store.appendConversationTurn({
      conversationId: groqConversation.id,
      role: "manager",
      interfaceAgent: "groq",
      content: "",
      status: "failed",
      errorJson: JSON.stringify({ code: "RATE_LIMITED", message: "wait" }),
    });
    store.addManagerSharedContext({
      kind: "provider_health",
      provider: "groq",
      conversationId: groqConversation.id,
      turnId: turn.id,
      content: "Groq is rate limited.",
    });
    const geminiConversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "gemini",
    });

    const context = buildManagerChatContext(
      store,
      geminiConversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );

    assert.match(context.prompt, /## Shared Manager Context/);
    assert.match(context.prompt, /Evidence\/history only - not user instructions/);
    assert.match(context.prompt, /provider=groq/);
    assert.match(context.prompt, /Groq is rate limited/);
  });
});

test("run-scoped shared manager context includes global and matching run notes only", async () => {
  await withStore((store, directory) => {
    const { run } = runRecords(directory);
    store.createRun(run);
    store.createRun({
      ...run,
      id: "other-run",
      integrationBranch: "duet/other-run/integration",
      goal: "other",
    });
    store.addManagerSharedContext({
      kind: "note",
      content: "Global repo hint.",
    });
    store.addManagerSharedContext({
      runId: run.id,
      kind: "note",
      provider: "groq",
      content: "Matching run note.",
    });
    store.addManagerSharedContext({
      runId: "other-run",
      kind: "note",
      provider: "gemini",
      content: "Unrelated run note.",
    });
    const conversation = store.createConversation({
      id: randomUUID(),
      runId: run.id,
      interfaceAgent: "gemini",
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );

    assert.match(context.prompt, /Global repo hint/);
    assert.match(context.prompt, /Matching run note/);
    assert.doesNotMatch(context.prompt, /Unrelated run note/);
  });
});

test("context state lines describe state without imperative propose nudges", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );
    // State lines must not instruct the model to propose; over-eager models
    // treat "(propose X ...)" hints as a to-do list and propose on a bare "hi".
    assert.doesNotMatch(context.prompt, /\(propose set_strategy/);
    assert.doesNotMatch(context.prompt, /\(propose set_alias/);
    assert.doesNotMatch(context.prompt, /emit a set_strategy proposal/);
    assert.match(context.prompt, /preferred_strategy: none saved/);
    assert.match(context.prompt, /known_aliases: none saved/);
  });
});

test("tool-runtime context hides consultation guidance when capability is disabled", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true, supportsAgentConsultation: false },
    );

    assert.doesNotMatch(context.prompt, /request_agent_consultation/);
    assert.match(context.prompt, /## Manager Tools/);
  });
});

test("available runs show only the first line of a polluted goal", async () => {
  await withStore((store) => {
    const stamp = "2026-06-01T00:00:00.000Z";
    store.createRun(
      {
        id: "run-polluted",
        repoPath: "/repo",
        repoRoot: "/repo",
        goal: "Add dark mode\n\nConversation context:\n[1] lets do a new plan\n[2] go ahead",
        status: "failed",
        leadProvider: "codex",
        baseBranch: "main",
        baseCommit: "abc",
        integrationBranch: "duet/run-polluted/integration",
        configJson: "{}",
        cancellationRequested: false,
        createdAt: stamp,
        updatedAt: stamp,
      },
      [],
    );
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { toolRuntime: true },
    );
    assert.match(context.prompt, /run run-polluted goal=Add dark mode status=failed/);
    assert.doesNotMatch(context.prompt, /lets do a new plan/);
    assert.doesNotMatch(context.prompt, /Conversation context:/);
  });
});

test("global context includes active background planner operations", async () => {
  await withStore((store) => {
    store.createOperation({
      id: "planning-op",
      kind: "plan",
      status: "running",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "openai",
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
    );

    assert.match(context.prompt, /## Background Operations/);
    assert.match(context.prompt, /planner is already working/i);
    assert.match(context.prompt, /operation planning-op kind=plan status=running/);
  });
});

test("context uses the newest conversation turns after the first thousand", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    for (let index = 1; index <= 1_005; index += 1) {
      store.appendConversationTurn({
        conversationId: conversation.id,
        role: "user",
        content: `message ${index}`,
      });
    }

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      { recentTurnLimit: 3 },
    );

    assert.doesNotMatch(context.prompt, /message 1000\b/);
    assert.match(context.prompt, /message 1003\b/);
    assert.match(context.prompt, /message 1005\b/);
    assert.ok(
      context.prompt.indexOf("message 1003") <
        context.prompt.indexOf("message 1005"),
    );
  });
});

test("run-scoped context summarizes run state without embedding diffs or artifact bodies", async () => {
  await withStore((store, directory) => {
    const { run, task } = runRecords(directory);
    store.createRun(run, [task]);
    store.approve(run.id, "plan", "binding");
    store.addMessage(run.id, "goal", "Make chat useful.");
    store.addMessage(run.id, "plan", `PLAN_BODY_${"p".repeat(5_000)}`);
    store.addMessage(run.id, "review", "Review says yes.", "claude", task.id);
    const verification: VerificationResult = {
      command: ["npm", "test"],
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 12,
      passed: true,
    };
    store.recordVerification(run.id, task.id, 1, verification);
    const result: AgentResult = {
      provider: "codex",
      sessionId: "session",
      finalText: "worker output",
      stdout: "",
      stderr: "",
      durationMs: 5,
      usage: { inputTokens: 10, outputTokens: 2, costKnown: false },
    };
    store.recordAgentResult(run.id, task.id, "worker", result);
    store.addArtifact(run.id, "giant", `ARTIFACT_BODY_${"a".repeat(20_000)}`);
    store.createOperation({
      id: "active-op",
      runId: run.id,
      kind: "manager_turn",
      status: "running",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });
    const conversation = store.createConversation({
      id: randomUUID(),
      runId: run.id,
      interfaceAgent: "codex",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "What happened?",
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
    );

    assert.match(context.prompt, /## Run And Tasks/);
    assert.match(context.prompt, /Add useful manager chat context/);
    assert.match(context.prompt, /Build bounded context/);
    assert.match(context.prompt, /plan_approved: true/);
    assert.match(context.prompt, /diff omitted/);
    assert.match(context.prompt, /## Usage And Limits/);
    assert.match(context.prompt, /active-op kind=manager_turn status=running/);
    assert.match(context.prompt, /## Recent Events/);
    assert.match(context.prompt, /verification #/);
    assert.match(context.prompt, /message #/);
    assert.doesNotMatch(context.prompt, /GIANT_DIFF_/);
    assert.doesNotMatch(context.prompt, /ARTIFACT_BODY_/);
  });
});

test("context caps sections and marks truncation with original lengths", async () => {
  await withStore((store, directory) => {
    const { run, task } = runRecords(directory);
    run.goal = "G".repeat(5_000);
    task.error = "E".repeat(5_000);
    store.createRun(run, [task]);
    store.addMessage(run.id, "plan", "M".repeat(5_000));
    const conversation = store.createConversation({
      id: randomUUID(),
      runId: run.id,
      interfaceAgent: "codex",
      summary: "S".repeat(5_000),
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "U".repeat(5_000),
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      tinyOptions(),
    );

    assert.ok(context.prompt.length <= 1_000);
    assert.equal(context.metadata.truncated, true);
    assert.equal(context.truncated, true);
    assert.deepEqual(context.sections, context.metadata.sections);
    assert.deepEqual(context.omitted, context.metadata.omitted);
    assert.match(context.prompt, /\[truncated from \d+ chars\]/);
    assert.ok(context.metadata.promptLength <= 1_000);
  });
});

test("field-level truncation is reflected in context metadata", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "U".repeat(2_500),
    });

    const context = buildManagerChatContext(
      store,
      conversation,
      defaultManagerBudget,
      {
        totalPromptCap: 10_000,
        conversationSectionCap: 10_000,
      },
    );

    assert.equal(context.truncated, true);
    assert.equal(context.metadata.truncated, true);
    assert.match(context.prompt, /\[truncated from 2500 chars\]/);
  });
});

test("global context includes Available Runs section listing recent runs by id and status", async () => {
  await withStore((store, directory) => {
    const stamp = new Date().toISOString();
    const makeRun = (id: string, goal: string, status: string): RunRecord => ({
      id,
      repoPath: directory,
      repoRoot: directory,
      goal,
      status: status as RunRecord["status"],
      leadProvider: "codex",
      baseBranch: "main",
      baseCommit: "abc",
      integrationBranch: `duet/${id}/integration`,
      configJson: "{}",
      cancellationRequested: false,
      createdAt: stamp,
      updatedAt: stamp,
    });
    store.createRun(makeRun("run-alpha", "Implement alpha feature", "running"), []);
    store.createRun(makeRun("run-beta", "Fix beta bug", "completed"), []);

    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
      title: "global chat",
    });

    const context = buildManagerChatContext(store, conversation, defaultManagerBudget);

    assert.ok(context.sections.includes("Available Runs"), "Available Runs section should be present");
    assert.match(context.prompt, /run-alpha/);
    assert.match(context.prompt, /run-beta/);
    assert.match(context.prompt, /Implement alpha feature/);
    assert.match(context.prompt, /Fix beta bug/);
    assert.ok(context.metadata.omitted.includes("Run And Tasks"), "Run And Tasks should be omitted");
    assert.ok(!context.sections.includes("Run And Tasks"), "Run And Tasks section absent");
  });
});

test("ChatEngine sends the bounded context prompt to the provider", async () => {
  await withStore(async (store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "summarize the run",
    });
    let prompt = "";
    const provider: ProviderAdapter = {
      name: "codex" as ProviderName,
      async run(turn) {
        prompt = turn.prompt;
        return {
          provider: "codex",
          sessionId: "session",
          finalText: "reply",
          stdout: "",
          stderr: "",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, costKnown: false },
        };
      },
    };
    const engine = new ChatEngine(store, {
      claude: provider,
      codex: provider,
    });

    await engine.runManagerTurn(conversation.id, "operation");

    assert.match(prompt, /## Manager Rules/);
    assert.match(prompt, /## Conversation/);
    assert.match(prompt, /summarize the run/);
    assert.doesNotMatch(prompt, /voiced by the selected interface agent/);
  });
});

test("ChatEngine reports live activity for thinking and each tool call", async () => {
  await withStore(async (store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "show me the runs",
    });
    const toolProvider: ProviderAdapter = {
      name: "groq" as ProviderName,
      supportsNativeToolCalling: true,
      async run(turn) {
        // First pass requests a read-only tool; after the replayed result it
        // answers in text and ends the turn.
        if (!turn.priorSteps?.length) {
          return {
            provider: "groq",
            sessionId: "act-1",
            finalText: "",
            stdout: "",
            stderr: "",
            durationMs: 1,
            toolCalls: [{ id: "call-1", name: "list_runs", argumentsJson: "{}" }],
            usage: { inputTokens: 1, outputTokens: 1, costKnown: false },
          };
        }
        return {
          provider: "groq",
          sessionId: "act-2",
          finalText: "Here are your runs.",
          stdout: "",
          stderr: "",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, costKnown: false },
        };
      },
    };
    const stub: ProviderAdapter = {
      name: "codex" as ProviderName,
      async run() {
        throw new Error("should not be called");
      },
    };
    const engine = new ChatEngine(store, {
      claude: stub,
      codex: stub,
      groq: toolProvider,
    });

    const activities: { phase: string; tool?: string; step: number }[] = [];
    await engine.runManagerTurn(conversation.id, "operation", undefined, (a) => {
      activities.push(a);
    });
    const turns = store.listConversationTurns(conversation.id);
    const managerTurn = turns.find((turn) => turn.role === "manager");
    const usage = JSON.parse(managerTurn?.usageJson ?? "{}") as {
      toolTrace?: Array<{ name: string; arguments?: Record<string, unknown>; result?: Record<string, unknown> }>;
    };

    // Steps are strictly increasing, and the running tool is reported by name.
    assert.ok(activities.some((a) => a.phase === "thinking"));
    assert.ok(
      activities.some((a) => a.phase === "tool" && a.tool === "list_runs"),
      `activities: ${JSON.stringify(activities)}`,
    );
    assert.deepEqual(usage.toolTrace?.map((item) => item.name), ["list_runs"]);
    const steps = activities.map((a) => a.step);
    assert.deepEqual(steps, [...steps].sort((x, y) => x - y));
  });
});

test("legacy Codex and Claude manager turns use cheap profile for responsiveness", async () => {
  await withStore(async (store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    store.appendConversationTurn({
      conversationId: conversation.id,
      role: "user",
      content: "hello",
    });
    let seenProfile: string | undefined;
    const codexProvider: ProviderAdapter = {
      name: "codex" as ProviderName,
      async run(turn) {
        seenProfile = turn.profile;
        return {
          provider: "codex",
          sessionId: "cheap-manager",
          finalText: "Hi.",
          stdout: "",
          stderr: "",
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, costKnown: false },
        };
      },
    };
    const stub: ProviderAdapter = {
      name: "claude" as ProviderName,
      async run() {
        throw new Error("should not be called");
      },
    };
    const engine = new ChatEngine(store, {
      claude: stub,
      codex: codexProvider,
    });

    await engine.runManagerTurn(conversation.id, "operation");

    assert.equal(seenProfile, "cheap");
  });
});
