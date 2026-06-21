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
    assert.match(context.prompt, /read-only and informational/);
    assert.match(context.prompt, /untrusted/);
    assert.match(context.prompt, /## Action Proposal Format/);
    assert.match(context.prompt, /Proposals are suggestions only/);
    assert.match(context.prompt, /server synthesizes/);
    assert.match(context.prompt, /create_plan and set_strategy are only valid in global chat/);
    assert.match(context.prompt, /## Conversation/);
    assert.doesNotMatch(context.prompt, /message 1/);
    assert.match(context.prompt, /message 4/);
    assert.ok(
      context.prompt.indexOf("message 4") < context.prompt.indexOf("message 6"),
    );
    assert.ok(context.metadata.omitted.includes("Run And Tasks"));
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
