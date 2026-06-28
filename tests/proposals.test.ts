import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseProposalBlock,
  stripMalformedProposalArtifacts,
  tryValidateAndSynthesize,
  userIntentAllowsCreatePlan,
} from "../src/chat/proposals.js";
import { executeManagerTool } from "../src/chat/tools.js";
import type {
  ConversationRecord,
  ProposalAction,
  RunRecord,
  TaskRecord,
} from "../src/core/domain.js";
import { Store } from "../src/persistence/store.js";

async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-proposals-"));
  const store = new Store(path.join(directory, "state.sqlite"));
  try {
    await fn(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function seed(store: Store): ConversationRecord {
  const stamp = "2026-06-01T00:00:00.000Z";
  const run: RunRecord = {
    id: "run-1",
    repoPath: "/repo",
    repoRoot: "/repo",
    goal: "seed goal",
    status: "running",
    leadProvider: "codex",
    baseBranch: "main",
    baseCommit: "abc",
    integrationBranch: "duet/run-1/integration",
    configJson: "{}",
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const task: TaskRecord = {
    runId: run.id,
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
    status: "ready",
    provider: "codex",
    reviewerProvider: "claude",
    revisionCount: 0,
    cancellationRequested: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  store.createRun(run, [task]);
  return store.createConversation({
    id: randomUUID(),
    runId: run.id,
    interfaceAgent: "codex",
  });
}

test("parseProposalBlock returns none when no proposal block exists", () => {
  assert.deepEqual(parseProposalBlock("plain answer"), { kind: "none" });
});

test("parseProposalBlock accepts one final proposal block and strips it", () => {
  const parsed = parseProposalBlock(
    [
      "I can retry this task.",
      "",
      "```duet-proposal",
      '{"action":"retry_task","runId":"run-1","taskId":"task-1","rationale":"try again"}',
      "```",
    ].join("\n"),
  );
  assert.equal(parsed.kind, "parsed");
  if (parsed.kind !== "parsed") return;
  assert.equal(parsed.strippedText, "I can retry this task.");
  assert.equal(parsed.raw.action, "retry_task");
  assert.equal(parsed.raw.runId, "run-1");
  assert.equal(parsed.raw.taskId, "task-1");
  assert.equal(parsed.raw.rationale, "try again");
});

test("parseProposalBlock rejects duplicate, nested, trailing, and malformed blocks", () => {
  assert.equal(
    parseProposalBlock(
      "```duet-proposal\n{}\n```\n```duet-proposal\n{}\n```",
    ).kind,
    "invalid",
  );
  assert.equal(
    parseProposalBlock("```duet-proposal\n{\"action\":\"execute_run\",\"x\":\"```\"}\n```")
      .kind,
    "invalid",
  );
  assert.equal(
    parseProposalBlock(
      "```duet-proposal\n{\"action\":\"execute_run\"}\n```\ntrailing",
    ).kind,
    "invalid",
  );
  assert.equal(parseProposalBlock("```duet-proposal\nnot-json\n```").kind, "invalid");
});

test("stripMalformedProposalArtifacts removes leaked proposal-shaped output", () => {
  assert.equal(
    stripMalformedProposalArtifacts(
      'Good idea. I can discuss tweaks.\n```duet-proposal\n{"action":"create_plan"}',
    ),
    "Good idea. I can discuss tweaks.",
  );
  assert.equal(
    stripMalformedProposalArtifacts(
      'Good idea.\n{"action":"create_plan","goal":"x","repoPath":"C:\\\\repo"}',
    ),
    "Good idea.",
  );
  assert.equal(
    stripMalformedProposalArtifacts(
      "Here is what I found.\n<tool_call>search_files\n<arg_key>path</arg_key>\n</tool_call>",
    ),
    "Here is what I found.",
  );
  assert.equal(stripMalformedProposalArtifacts("plain answer"), "plain answer");
});

test("tryValidateAndSynthesize ignores model command fields and uses templates", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    const proposal = tryValidateAndSynthesize(
      {
        action: "retry_task",
        runId: "run-1",
        taskId: "task-1",
        rationale: "retry safely",
        command: "rm -rf /",
        commandCli: "rm -rf /",
        cli: "rm -rf /",
        tier: "fingerprint",
        commandJson: "{\"evil\":true}",
      } as never,
      conversation,
      store,
    );
    assert.ok(proposal);
    assert.equal(proposal.commandCli, "duet retry run-1 task-1");
    assert.equal(
      proposal.commandJson,
      JSON.stringify({ action: "retry_task", runId: "run-1", taskId: "task-1" }),
    );
    assert.equal(proposal.tier, "ordinary");
  });
});

test("tryValidateAndSynthesize rejects unknown actions and invalid IDs", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    assert.equal(
      tryValidateAndSynthesize(
        { action: "create_plan", runId: "run-1" },
        conversation,
        store,
        "create a plan for this",
      ),
      null,
    );
    assert.equal(
      tryValidateAndSynthesize(
        { action: "execute_run", runId: "missing" },
        conversation,
        store,
      ),
      null,
    );
    assert.equal(
      tryValidateAndSynthesize(
        { action: "retry_task", runId: "run-1", taskId: "missing" },
        conversation,
        store,
      ),
      null,
    );
  });
});

test("tryValidateAndSynthesize assigns fingerprint tiers to approval and merge actions", async () => {
  await withStore((store) => {
    const conversation = seed(store);
    for (const action of ["approve_plan", "approve_merge", "merge_run"] as const) {
      const proposal = tryValidateAndSynthesize(
        { action, runId: "run-1" },
        conversation,
        store,
      );
      assert.ok(proposal);
      assert.equal(proposal.tier, "fingerprint");
    }
  });
});

test("create_plan proposals require explicit planning intent in the latest user message", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "codex",
    });
    const proposal = tryValidateAndSynthesize(
      {
        action: "create_plan",
        goal: "Add docs",
        repoPath: "/repo",
        lead: "claude",
        profile: "balanced",
      },
      conversation,
      store,
      "Can you see the time today?",
    );
    assert.equal(proposal, null);
  });
});

test("create_plan proposals are blocked while a planner operation is active", async () => {
  await withStore((store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "openai",
    });
    store.createOperation({
      id: "planning-op",
      kind: "plan",
      status: "running",
      serviceInstanceId: "test",
      inputHash: "hash",
      createdAt: new Date().toISOString(),
    });
    const diagnostics: { reason?: string } = {};
    const proposal = tryValidateAndSynthesize(
      {
        action: "create_plan",
        goal: "Add docs",
        repoPath: "/repo",
        lead: "claude",
        profile: "balanced",
      },
      conversation,
      store,
      "create a plan",
      {},
      diagnostics,
    );

    assert.equal(proposal, null);
    assert.match(diagnostics.reason ?? "", /Planner operation planning-op is already running/);
  });
});

test("userIntentAllowsCreatePlan distinguishes planning requests from ordinary questions", () => {
  assert.equal(userIntentAllowsCreatePlan("Can you see the time today?"), false);
  assert.equal(userIntentAllowsCreatePlan("What can you do?"), false);
  assert.equal(userIntentAllowsCreatePlan("Help me start a plan for this repo"), true);
  assert.equal(userIntentAllowsCreatePlan("/plan build the feature"), true);
});

test("userIntentAllowsCreatePlan recognizes broader natural planning phrasing", () => {
  assert.equal(userIntentAllowsCreatePlan("For planning, please propose the approach and dependencies"), true);
  assert.equal(userIntentAllowsCreatePlan("can you plan it out for the repo"), true);
  assert.equal(userIntentAllowsCreatePlan("propose a detailed plan for this"), true);
});

test("userIntentAllowsCreatePlan ignores bare planning mentions that are not requests", () => {
  assert.equal(userIntentAllowsCreatePlan("what is planning poker?"), false);
  assert.equal(userIntentAllowsCreatePlan("I am thinking about planning my week"), false);
});

test("userIntentAllowsCreatePlan accepts affirmations only after a manager plan offer", () => {
  // Bare affirmation with no manager offer must NOT trigger a plan.
  assert.equal(userIntentAllowsCreatePlan("go ahead"), false);
  assert.equal(userIntentAllowsCreatePlan("yes that is the goal"), false);
  // Same affirmation IS intent once the manager has offered to propose a plan.
  assert.equal(userIntentAllowsCreatePlan("go ahead", true), true);
  assert.equal(userIntentAllowsCreatePlan("yes, go for it", true), true);
  assert.equal(userIntentAllowsCreatePlan("yes that is the goal", true), true);
  assert.equal(userIntentAllowsCreatePlan("that is the goal", true), true);
  assert.equal(userIntentAllowsCreatePlan("exactly", true), true);
  assert.equal(userIntentAllowsCreatePlan("proceed", true), true);
  // An unrelated reply after an offer still does not count.
  assert.equal(userIntentAllowsCreatePlan("what time is it?", true), false);
});

test("agent_consultation parsed from a legacy fenced block synthesizes a consent card", () => {
  const parsed = parseProposalBlock(
    [
      "I can ask both agents.",
      "",
      "```duet-proposal",
      '{"action":"agent_consultation","question":"Is this feasible?","agents":["claude","codex"],"mode":"independent"}',
      "```",
    ].join("\n"),
  );
  assert.equal(parsed.kind, "parsed");
  if (parsed.kind !== "parsed") return;
  // The legacy parser must carry the consultation fields through, not drop them.
  assert.equal(parsed.raw.question, "Is this feasible?");
  assert.deepEqual(parsed.raw.agents, ["claude", "codex"]);
});

test("manager path tools normalize over-escaped/redundant path segments", async () => {
  await withStore(async (store) => {
    const conversation = store.createConversation({
      id: randomUUID(),
      interfaceAgent: "groq",
    });
    // Redundant ./ and ../ segments are collapsed cross-platform by path.normalize.
    const messy = path.join("base", "child", "..", ".", "leaf");
    const execution = await executeManagerTool({
      name: "check_path",
      argumentsJson: JSON.stringify({ path: messy }),
      store,
      conversation,
      configAliases: {},
    });
    assert.equal(execution.ok, true);
    const result = execution.result as { path: string };
    assert.equal(result.path, path.normalize(messy));
    assert.equal(result.path, path.join("base", "leaf"));
  });
});

test("search_files finds files by name and by content, skipping ignored dirs", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "duet-search-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "nhyira-os"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "src", "auth.ts"), "export function login() {\n  return TOKEN_SECRET;\n}\n");
    await writeFile(path.join(root, "src", "util.ts"), "export const noop = () => {};\n");
    await writeFile(path.join(root, "node_modules", "pkg", "auth.ts"), "TOKEN_SECRET in deps\n");

    await withStore(async (store) => {
      const conversation = store.createConversation({ id: randomUUID(), interfaceAgent: "groq" });

      // Name search matches the glob and excludes node_modules.
      const byName = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "*.ts" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(byName.ok, true);
      const nameResult = byName.result as { matches: { path: string; type: string }[] };
      const names = nameResult.matches.map((m) => path.basename(m.path)).sort();
      assert.deepEqual(names, ["auth.ts", "util.ts"]);
      assert.ok(nameResult.matches.every((m) => m.type === "file"));
      assert.ok(!nameResult.matches.some((m) => m.path.includes("node_modules")));

      // Directory search (kind:"dir") locates a folder by name and does not
      // descend into node_modules.
      const byDir = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "src", kind: "dir" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(byDir.ok, true);
      const dirResult = byDir.result as { matches: { path: string; type: string }[] };
      assert.ok(dirResult.matches.some((m) => m.type === "dir" && path.basename(m.path) === "src"));

      // Normalized matching: a separator-free colloquial name finds the real
      // folder, e.g. "nhyiraos" -> "nhyira-os".
      const fuzzy = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "nhyiraos", kind: "dir" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(fuzzy.ok, true);
      const fuzzyResult = fuzzy.result as { matches: { path: string }[] };
      assert.ok(
        fuzzyResult.matches.some((m) => path.basename(m.path) === "nhyira-os"),
        `expected to find nhyira-os: ${JSON.stringify(fuzzyResult.matches)}`,
      );

      // Omitting kind defaults to a folder-aware search, so project/repo names
      // are still discoverable when the model leaves kind unspecified.
      const defaultKind = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "nhyiraos" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(defaultKind.ok, true);
      const defaultKindResult = defaultKind.result as {
        kind: string;
        matched: boolean;
        evidenceKind: string;
        bestMatch?: { path: string; type: string };
        bestFolderMatch?: { path: string; matchCount: number };
        matches: { path: string; type: string }[];
      };
      assert.equal(defaultKindResult.kind, "any");
      assert.equal(defaultKindResult.matched, true);
      assert.equal(defaultKindResult.evidenceKind, "folder_name");
      assert.equal(path.basename(defaultKindResult.bestMatch?.path ?? ""), "nhyira-os");
      assert.equal(path.basename(defaultKindResult.bestFolderMatch?.path ?? ""), "nhyira-os");
      assert.ok(
        defaultKindResult.matches.some((m) => m.type === "dir" && path.basename(m.path) === "nhyira-os"),
        `expected default-kind search to find nhyira-os: ${JSON.stringify(defaultKindResult.matches)}`,
      );

      // Top-level project folders win over deep cache/sidebar matches even
      // when maxResults is tiny. This keeps home searches from disappearing
      // into AppData-like trees before checking sibling project folders.
      await mkdir(path.join(root, "aaa-cache", "nested", "nhyira-cache"), { recursive: true });
      await mkdir(path.join(root, "AppData", "Local", "nhyira-cache"), { recursive: true });
      const topLevelFirst = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "nhyira", kind: "dir", maxResults: 10 }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(topLevelFirst.ok, true);
      const topLevelResult = topLevelFirst.result as { matches: { path: string }[] };
      assert.equal(path.basename(topLevelResult.matches[0]?.path ?? ""), "nhyira-os");
      assert.ok(!topLevelResult.matches.some((m) => path.relative(root, m.path).split(path.sep)[0] === "AppData"));

      await mkdir(path.join(root, "Grand Theft Auto V Enhanced", "Redistributables"), { recursive: true });
      await writeFile(path.join(root, "Grand Theft Auto V Enhanced", "Redistributables", "Rockstar-Games-Launcher.exe"), "");
      const gameFiles = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "*game*.exe", maxResults: 10 }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(gameFiles.ok, true);
      const gameResult = gameFiles.result as {
        matched: boolean;
        evidenceKind: string;
        bestFolderMatch?: { path: string; matchCount: number };
        folderMatches: { path: string; matchCount: number }[];
        matches: { path: string; type: string }[];
      };
      assert.equal(gameResult.matched, true);
      assert.equal(gameResult.evidenceKind, "installer_artifact");
      assert.equal(path.basename(gameResult.bestFolderMatch?.path ?? ""), "Grand Theft Auto V Enhanced");
      assert.ok(
        gameResult.folderMatches.some((m) => path.basename(m.path) === "Grand Theft Auto V Enhanced"),
        `expected containing folder summary: ${JSON.stringify(gameResult)}`,
      );

      await mkdir(path.join(root, "Reports App"), { recursive: true });
      await writeFile(path.join(root, "Reports App", "reports-data.json"), "{}");
      const folderBackedFile = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "*reports*.json", maxResults: 10 }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(folderBackedFile.ok, true);
      const folderBackedResult = folderBackedFile.result as {
        evidenceKind: string;
        bestFolderMatch?: { path: string; matchCount: number };
      };
      assert.equal(folderBackedResult.evidenceKind, "folder_name");
      assert.equal(path.basename(folderBackedResult.bestFolderMatch?.path ?? ""), "Reports App");

      // Content search returns the matching line and number, only in tracked src.
      const byContent = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, contentPattern: "TOKEN_SECRET" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(byContent.ok, true);
      const contentResult = byContent.result as {
        kind: string;
        matched: boolean;
        evidenceKind: string;
        bestMatch?: { path: string; type: string };
        matches: { path: string; line: number; snippet: string }[];
      };
      assert.equal(contentResult.kind, "file");
      assert.equal(contentResult.matched, true);
      assert.equal(contentResult.evidenceKind, "content");
      assert.equal(path.basename(contentResult.bestMatch?.path ?? ""), "auth.ts");
      assert.equal(contentResult.matches.length, 1);
      assert.equal(path.basename(contentResult.matches[0].path), "auth.ts");
      assert.equal(contentResult.matches[0].line, 2);
      assert.match(contentResult.matches[0].snippet, /TOKEN_SECRET/);

      const byNameAndContent = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root, namePattern: "*.ts", contentPattern: "TOKEN_SECRET" }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(byNameAndContent.ok, true);
      const nameAndContentResult = byNameAndContent.result as { kind: string; matches: { path: string }[] };
      assert.equal(nameAndContentResult.kind, "file");
      assert.equal(path.basename(nameAndContentResult.matches[0]?.path ?? ""), "auth.ts");

      // Missing both patterns is a usage error.
      const noPattern = await executeManagerTool({
        name: "search_files",
        argumentsJson: JSON.stringify({ path: root }),
        store,
        conversation,
        configAliases: {},
      });
      assert.equal(noPattern.ok, false);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listProposalsHistory returns all statuses while listProposals shows only active", async () => {
  await withStore(async (store) => {
    const conversation = seed(store);

    function makeProposal(action: ProposalAction, expiresAt: string): string {
      const turn = store.appendConversationTurn({
        conversationId: conversation.id,
        role: "manager",
        interfaceAgent: "codex",
        content: "suggestion",
      });
      const id = randomUUID();
      store.createProposal({
        id,
        conversationId: conversation.id,
        turnId: turn.id,
        runId: "run-1",
        action,
        summary: "test",
        commandCli: `duet run run-1`,
        commandJson: JSON.stringify({ action, runId: "run-1" }),
        tier: "ordinary",
        expiresAt,
      });
      return id;
    }

    const future = new Date(Date.now() + 15 * 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    const dismissedId = makeProposal("execute_run", future);
    store.dismissProposal(conversation.id, dismissedId);

    const startedId = makeProposal("resume_run", future);
    const fakeOperationId = randomUUID();
    store.markProposalStarted(conversation.id, startedId, fakeOperationId);

    const expiredId = makeProposal("cancel_run", past);
    store.expireProposals();

    // listProposals should show none (all inactive)
    assert.deepEqual(store.listProposals(conversation.id), []);

    // listProposalsHistory should show all three
    const history = store.listProposalsHistory(conversation.id);
    assert.equal(history.length, 3);

    const started = history.find((p) => p.id === startedId);
    assert.ok(started);
    assert.equal(started?.status, "started");
    assert.equal(started?.operationId, fakeOperationId);

    const dismissed = history.find((p) => p.id === dismissedId);
    assert.ok(dismissed);
    assert.equal(dismissed?.status, "dismissed");
    assert.equal(dismissed?.operationId, undefined);

    const expired = history.find((p) => p.id === expiredId);
    assert.ok(expired);
    assert.equal(expired?.status, "expired");
  });
});
