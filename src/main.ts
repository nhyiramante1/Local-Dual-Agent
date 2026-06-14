import { loginCodex } from "./auth.js";
import { createInterface } from "node:readline/promises";
import { approvalBinding } from "./application/integrity.js";
import { loadConfig } from "./config.js";
import type {
  ProviderName,
  RunRecord,
  TaskRecord,
} from "./core/domain.js";
import { DuetError } from "./core/errors.js";
import { runDoctor, printDoctorReport } from "./doctor.js";
import { Orchestrator } from "./orchestrator.js";
import { Store } from "./persistence/store.js";

function printUsage(): void {
  console.log(`Usage:
  duet doctor [--live] [--json]
  duet auth codex
  duet plan --repo PATH [--lead claude|codex] [--config PATH] "goal"
  duet approve RUN_ID --stage plan|merge
  duet run RUN_ID
  duet resume RUN_ID [--config PATH]
  duet retry RUN_ID TASK_ID
  duet cancel RUN_ID [--task TASK_ID]
  duet cleanup RUN_ID [--force]
  duet status [RUN_ID] [--json]
  duet tasks RUN_ID [--json]
  duet logs RUN_ID [--json]
  duet diff RUN_ID
  duet conflict RUN_ID
  duet resolve RUN_ID TASK_ID
  duet merge RUN_ID
  duet --help`);
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DuetError(`${name} requires a value.`, "INVALID_ARGUMENT");
  }
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function printTask(task: TaskRecord): void {
  const dependencies = task.plan.dependencies.join(", ") || "none";
  const synthetic =
    task.plan.syntheticDependencies?.join(", ") || "none";
  console.log(
    `${String(task.ordinal + 1).padStart(2)}  ${task.id.padEnd(18)} ${task.status.padEnd(14)} ${task.provider} -> ${task.reviewerProvider}`,
  );
  console.log(
    `    dependencies: ${dependencies}; synthetic: ${synthetic}; scope: ${task.plan.allowedPaths.join(", ")}`,
  );
  if (task.error) console.log(`    error: ${task.error}`);
}

async function confirmEmbedded(
  run: RunRecord,
  tasks: TaskRecord[],
  stage: "plan" | "merge",
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DuetError(
      `${stage} approval requires an interactive terminal.`,
      "INTERACTIVE_APPROVAL_REQUIRED",
    );
  }
  console.log(
    `${stage.toUpperCase()} fingerprint: ${approvalBinding(run, tasks, stage)}`,
  );
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type "${stage}" to confirm: `);
    if (answer.trim() !== stage) {
      throw new DuetError("Approval cancelled.", "APPROVAL_CANCELLED");
    }
  } finally {
    prompt.close();
  }
}

function printRun(run: RunRecord, store: Store): void {
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Goal: ${run.goal}`);
  console.log(`Repository: ${run.repoRoot}`);
  console.log(`Lead: ${run.leadProvider}`);
  console.log(`Base: ${run.baseBranch}@${run.baseCommit.slice(0, 12)}`);
  if (run.integrationWorktreePath) {
    console.log(`Integration worktree: ${run.integrationWorktreePath}`);
  }
  if (run.plan) {
    console.log(`Plan: ${run.plan.summary}`);
    console.log(`Tasks: ${run.plan.tasks.length}`);
  }
  if (run.error) console.log(`Error: ${run.error}`);
  const usage = store.getUsageSummary(run.id);
  console.log(
    `Claude: ${usage.claude.turns} turns, ${usage.claude.inputTokens} input, ${usage.claude.outputTokens} output, ${
      usage.claude.costKnown
        ? `$${usage.claude.costUsd.toFixed(4)}`
        : "cost unavailable"
    }`,
  );
  console.log(
    `Codex: ${usage.codex.turns} turns, ${usage.codex.inputTokens} input, ${usage.codex.outputTokens} output, cost unavailable`,
  );
  const leases = store.listLeases(run.id);
  if (leases.length > 0) {
    console.log(`Active leases: ${leases.length}`);
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const command = args.shift();
  if (command === "auth") {
    if (args.length !== 1 || args[0] !== "codex") {
      throw new DuetError("Usage: duet auth codex", "INVALID_ARGUMENT");
    }
    process.exitCode = await loginCodex(process.cwd());
    return;
  }

  if (command === "doctor") {
    const live = takeFlag(args, "--live");
    const json = takeFlag(args, "--json");
    if (args.length > 0) {
      throw new DuetError(
        `Unknown option: ${args.join(" ")}`,
        "INVALID_ARGUMENT",
      );
    }
    const report = await runDoctor({ cwd: process.cwd(), live });
    if (json) console.log(JSON.stringify(report, null, 2));
    else printDoctorReport(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  const store = new Store();
  const orchestrator = new Orchestrator(store);
  try {
    if (command === "plan") {
      const repoPath = takeOption(args, "--repo");
      const leadOption = takeOption(args, "--lead");
      const configPath = takeOption(args, "--config");
      if (!repoPath || args.length === 0) {
        throw new DuetError(
          'Usage: duet plan --repo PATH [--lead claude|codex] "goal"',
          "INVALID_ARGUMENT",
        );
      }
      if (
        leadOption !== undefined &&
        leadOption !== "claude" &&
        leadOption !== "codex"
      ) {
        throw new DuetError(
          "--lead must be claude or codex.",
          "INVALID_ARGUMENT",
        );
      }
      const config = await loadConfig(configPath);
      const run = await orchestrator.plan({
        repoPath,
        goal: args.join(" ").trim(),
        lead:
          (leadOption as ProviderName | undefined) ??
          config.orchestration.defaultLead,
        config,
      });
      printRun(run, store);
      for (const task of store.listTasks(run.id)) printTask(task);
      console.log(`Approve with: duet approve ${run.id} --stage plan`);
      return;
    }

    if (command === "approve") {
      const runId = args.shift();
      const stage = takeOption(args, "--stage");
      if (!runId || (stage !== "plan" && stage !== "merge") || args.length) {
        throw new DuetError(
          "Usage: duet approve RUN_ID --stage plan|merge",
          "INVALID_ARGUMENT",
        );
      }
      await confirmEmbedded(
        store.getRun(runId),
        store.listTasks(runId),
        stage,
      );
      printRun(orchestrator.approve(runId, stage), store);
      return;
    }

    if (command === "run" || command === "resume") {
      const runId = args.shift();
      const configPath =
        command === "resume" ? takeOption(args, "--config") : undefined;
      if (!runId || args.length) {
        throw new DuetError(
          command === "resume"
            ? "Usage: duet resume RUN_ID [--config PATH]"
            : "Usage: duet run RUN_ID",
          "INVALID_ARGUMENT",
        );
      }
      const run =
        command === "run"
          ? await orchestrator.execute(runId)
          : await orchestrator.resume(
              runId,
              configPath ? await loadConfig(configPath) : undefined,
            );
      printRun(run, store);
      if (run.status === "awaiting_merge_approval") {
        console.log(`Review with: duet diff ${run.id}`);
        console.log(`Approve with: duet approve ${run.id} --stage merge`);
      }
      return;
    }

    if (command === "retry" || command === "resolve") {
      const runId = args.shift();
      const taskId = args.shift();
      if (!runId || !taskId || args.length) {
        throw new DuetError(
          `Usage: duet ${command} RUN_ID TASK_ID`,
          "INVALID_ARGUMENT",
        );
      }
      const run =
        command === "retry"
          ? await orchestrator.retry(runId, taskId)
          : await orchestrator.resolve(runId, taskId);
      printRun(run, store);
      return;
    }

    if (command === "cancel") {
      const runId = args.shift();
      const taskId = takeOption(args, "--task");
      if (!runId || args.length) {
        throw new DuetError(
          "Usage: duet cancel RUN_ID [--task TASK_ID]",
          "INVALID_ARGUMENT",
        );
      }
      printRun(await orchestrator.cancel(runId, taskId), store);
      return;
    }

    if (command === "cleanup") {
      const runId = args.shift();
      const force = takeFlag(args, "--force");
      if (!runId || args.length) {
        throw new DuetError(
          "Usage: duet cleanup RUN_ID [--force]",
          "INVALID_ARGUMENT",
        );
      }
      printRun(await orchestrator.cleanup(runId, force), store);
      return;
    }

    if (command === "status") {
      const json = takeFlag(args, "--json");
      if (args.length > 1) {
        throw new DuetError(
          "Usage: duet status [RUN_ID] [--json]",
          "INVALID_ARGUMENT",
        );
      }
      const result = args[0] ? store.getRun(args[0]) : store.listRuns();
      if (json) {
        console.log(
          JSON.stringify(
            Array.isArray(result)
              ? result
              : {
                  run: result,
                  tasks: store.listTasks(result.id),
                  usage: store.getUsageSummary(result.id),
                  leases: store.listLeases(result.id),
                },
            null,
            2,
          ),
        );
      } else if (Array.isArray(result)) {
        for (const run of result) {
          console.log(`${run.id}  ${run.status.padEnd(24)} ${run.goal}`);
        }
      } else {
        printRun(result, store);
        for (const task of store.listTasks(result.id)) printTask(task);
      }
      return;
    }

    if (command === "tasks") {
      const json = takeFlag(args, "--json");
      const runId = args.shift();
      if (!runId || args.length) {
        throw new DuetError(
          "Usage: duet tasks RUN_ID [--json]",
          "INVALID_ARGUMENT",
        );
      }
      store.getRun(runId);
      const tasks = store.listTasks(runId);
      if (json) console.log(JSON.stringify(tasks, null, 2));
      else for (const task of tasks) printTask(task);
      return;
    }

    if (command === "diff") {
      const runId = args.shift();
      if (!runId || args.length) {
        throw new DuetError("Usage: duet diff RUN_ID", "INVALID_ARGUMENT");
      }
      store.getRun(runId);
      for (const task of store.listTasks(runId)) {
        if (task.reviewedArtifact) {
          console.log(`### ${task.id}: ${task.plan.title}`);
          console.log(task.reviewedArtifact.diff);
        }
      }
      return;
    }

    if (command === "logs") {
      const json = takeFlag(args, "--json");
      const runId = args.shift();
      if (!runId || args.length) {
        throw new DuetError(
          "Usage: duet logs RUN_ID [--json]",
          "INVALID_ARGUMENT",
        );
      }
      store.getRun(runId);
      const messages = store.listMessages(runId);
      if (json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        for (const message of messages) {
          console.log(
            `[${message.createdAt}] ${message.kind}${
              message.taskId ? ` task=${message.taskId}` : ""
            }${message.provider ? ` (${message.provider})` : ""}`,
          );
          console.log(message.body);
          console.log();
        }
      }
      return;
    }

    if (command === "conflict") {
      const runId = args.shift();
      if (!runId || args.length) {
        throw new DuetError(
          "Usage: duet conflict RUN_ID",
          "INVALID_ARGUMENT",
        );
      }
      const conflicts = orchestrator.listConflicts(runId);
      if (conflicts.length === 0) console.log("No integration conflicts.");
      else for (const task of conflicts) printTask(task);
      return;
    }

    if (command === "merge") {
      const runId = args.shift();
      if (!runId || args.length) {
        throw new DuetError("Usage: duet merge RUN_ID", "INVALID_ARGUMENT");
      }
      await confirmEmbedded(
        store.getRun(runId),
        store.listTasks(runId),
        "merge",
      );
      printRun(await orchestrator.merge(runId), store);
      return;
    }

    throw new DuetError(`Unknown command: ${command}`, "INVALID_ARGUMENT");
  } finally {
    store.close();
  }
}
