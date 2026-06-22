import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";

import { loadConfig } from "./config.js";
import type {
  OperationRecord,
  ProviderName,
  RunRecord,
  TaskRecord,
} from "./core/domain.js";
import { DuetError } from "./core/errors.js";
import {
  clearServiceInfo,
  loadOrCreateDashboardAccessToken,
  readServiceInfo,
  releaseServiceLock,
  verifyServiceProcess,
} from "./service/discovery.js";
import { DuetClient, ensureService, probeService } from "./service/client.js";
import { terminateProcessTree } from "./process/run-command.js";
import { mcpCli } from "./mcp/cli.js";

function usage(): void {
  console.log(`Usage:
  duet service start|status|stop|restart [--force]
  duet mcp install|status|uninstall claude|codex|all [--force]
  duet dashboard [RUN_ID] [--phone]
  duet plan --repo PATH [--lead claude|codex] [--config PATH] [--detach] "goal"
  duet approve RUN_ID --stage plan|merge
  duet run RUN_ID [--detach]
  duet resume RUN_ID [--config PATH] [--detach]
  duet retry RUN_ID TASK_ID [--detach]
  duet cancel RUN_ID [--task TASK_ID] [--detach]
  duet cleanup RUN_ID [--force] [--detach]
  duet status [RUN_ID] [--json]
  duet tasks RUN_ID [--json]
  duet logs RUN_ID [--json]
  duet diff RUN_ID
  duet conflict RUN_ID
  duet resolve RUN_ID TASK_ID [--detach]
  duet merge RUN_ID [--detach]
  Add --embedded to use the in-process CLI.`);
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DuetError(`${name} requires a value.`, "INVALID_ARGUMENT");
  }
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function detectLanIpv4(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        !entry.address.startsWith("169.254.")
      ) {
        return entry.address;
      }
    }
  }
  return undefined;
}

async function dashboardHost(
  phone: boolean,
): Promise<string> {
  const config = await loadConfig();
  if (!phone && !config.dashboard.persistentAccess) return "127.0.0.1";
  if (config.dashboard.publicHost) return config.dashboard.publicHost;
  if (config.service.host === "0.0.0.0" || config.service.host === "::") {
    return detectLanIpv4() ?? "127.0.0.1";
  }
  if (
    config.service.host === "127.0.0.1" ||
    config.service.host === "localhost" ||
    config.service.host === "::1"
  ) {
    return "127.0.0.1";
  }
  return config.service.host;
}

function printTask(task: TaskRecord): void {
  console.log(
    `${String(task.ordinal + 1).padStart(2)}  ${task.id.padEnd(18)} ${task.status.padEnd(14)} ${task.provider} -> ${task.reviewerProvider}`,
  );
}

function printRun(run: RunRecord, detail?: {
  tasks: TaskRecord[];
  usage: { totalTurns: number };
}): void {
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Goal: ${run.goal}`);
  console.log(`Repository: ${run.repoRoot}`);
  console.log(`Lead: ${run.leadProvider}`);
  console.log(`Version: ${run.version ?? 1}`);
  if (run.error) console.log(`Error: ${run.error}`);
  if (detail) console.log(`Usage: ${detail.usage.totalTurns} turns`);
}

async function confirmed(
  client: DuetClient,
  runId: string,
  stage: "plan" | "merge",
  action: "approve_plan" | "approve_merge" | "merge",
): Promise<{ expectedVersion: number; actionTicket: string }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DuetError(
      `${stage} approval requires an interactive terminal.`,
      "INTERACTIVE_APPROVAL_REQUIRED",
    );
  }
  const binding = await client.get<{
    fingerprint: string;
    version: number;
  }>(
    `/api/v1/runs/${encodeURIComponent(runId)}/approval-fingerprint?stage=${stage}`,
  );
  console.log(`${stage.toUpperCase()} fingerprint: ${binding.fingerprint}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type "${stage}" to confirm: `);
    if (answer.trim() !== stage) {
      throw new DuetError("Approval cancelled.", "APPROVAL_CANCELLED");
    }
  } finally {
    prompt.close();
  }
  const ticket = await client.post<{
    ticket: string;
    fingerprint: string;
  }>(
    `/api/v1/runs/${encodeURIComponent(runId)}/action-ticket`,
    { expectedVersion: binding.version, action },
    { unique: true },
  );
  if (ticket.fingerprint !== binding.fingerprint) {
    throw new DuetError(
      "Run changed while confirming the action.",
      "VERSION_CONFLICT",
    );
  }
  return {
    expectedVersion: binding.version,
    actionTicket: ticket.ticket,
  };
}

async function finishOperation(
  client: DuetClient,
  operation: OperationRecord,
  detach: boolean,
): Promise<RunRecord | undefined> {
  if (detach) {
    console.log(`Operation: ${operation.id}`);
    return undefined;
  }
  let last = "";
  const completed = await client.wait(operation.id, (current) => {
    if (current.status !== last) {
      console.log(`Operation ${current.id}: ${current.status}`);
      last = current.status;
    }
  });
  if (completed.status === "failed" || completed.status === "interrupted") {
    const error = completed.errorJson
      ? (JSON.parse(completed.errorJson) as { code: string; message: string })
      : { code: "OPERATION_FAILED", message: "Operation failed." };
    throw new DuetError(error.message, error.code);
  }
  return completed.resultJson
    ? (JSON.parse(completed.resultJson) as RunRecord)
    : undefined;
}

async function serviceCommand(args: string[]): Promise<void> {
  const action = args.shift() ?? "status";
  const force = takeFlag(args, "--force");
  if (args.length) throw new DuetError("Invalid service command.", "INVALID_ARGUMENT");
  if (action === "start") {
    const info = await ensureService();
    console.log(`Duet service running: PID ${info.pid}, port ${info.port}`);
    return;
  }
  if (action === "status") {
    const info = await readServiceInfo();
    if (!info || !(await probeService(info))) {
      console.log("Duet service is stopped.");
      return;
    }
    console.log(`Duet service running: PID ${info.pid}, port ${info.port}, instance ${info.instanceId}`);
    return;
  }
  if (action === "stop" || action === "restart") {
    const info = await readServiceInfo();
    if (info && (await probeService(info))) {
      try {
        const client = await DuetClient.connect(false);
        let result = await client.post<{
          stopping: boolean;
          cancellationRequested?: boolean;
        }>("/api/v1/service/stop", { force }, { unique: true });
        if (!result.stopping && force) {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            const diagnostics = await client.get<{
              activeOperations: unknown[];
            }>("/api/v1/diagnostics");
            if (diagnostics.activeOperations.length === 0) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          result = await client.post(
            "/api/v1/service/stop",
            { force: true },
            { unique: true },
          );
        }
      } catch (error) {
        if (!force) throw error;
        const verified = await verifyServiceProcess(info);
        if (!verified) {
          throw new DuetError("Service identity could not be verified.", "SERVICE_IDENTITY_AMBIGUOUS");
        }
        terminateProcessTree(info.pid);
      }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && (await probeService(info))) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await clearServiceInfo();
    await releaseServiceLock();
    console.log("Duet service stopped.");
    if (action === "restart") {
      const restarted = await ensureService();
      console.log(`Duet service running: PID ${restarted.pid}, port ${restarted.port}`);
    }
    return;
  }
  throw new DuetError(`Unknown service action: ${action}`, "INVALID_ARGUMENT");
}

export async function serviceMain(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  const command = args.shift()!;
  if (command === "service") {
    await serviceCommand(args);
    return;
  }
  if (command === "mcp") {
    await mcpCli(args);
    return;
  }
  const client = await DuetClient.connect();
  if (command === "dashboard") {
    const phone = takeFlag(args, "--phone");
    const runId = args.shift();
    if (args.length) throw new DuetError("Usage: duet dashboard [RUN_ID] [--phone]", "INVALID_ARGUMENT");
    const config = await loadConfig();
    const host = await dashboardHost(phone);
    const query = runId ? `?run=${encodeURIComponent(runId)}` : "";
    const url =
      phone || config.dashboard.persistentAccess
        ? `http://${host}:${client.info.port}/${query}#access=${encodeURIComponent(
            await loadOrCreateDashboardAccessToken(),
          )}`
        : `http://${host}:${client.info.port}/${query}#${
            (
              await client.post<{ ticket: string }>(
                "/api/v1/dashboard/ticket",
                {},
                { unique: true },
              )
            ).ticket
          }`;
    console.log(url);
    const { spawn } = await import("node:child_process");
    const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin" ? ["open", [url]]
      : ["xdg-open", [url]];
    spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (command === "plan") {
    const repoPath = takeOption(args, "--repo");
    const lead = takeOption(args, "--lead");
    const configPath = takeOption(args, "--config");
    const detach = takeFlag(args, "--detach");
    if (!repoPath || args.length === 0 || (lead && !["claude", "codex"].includes(lead))) {
      throw new DuetError("Invalid plan command.", "INVALID_ARGUMENT");
    }
    const operation = await client.post<OperationRecord>("/api/v1/runs", {
      repoPath,
      goal: args.join(" "),
      lead: (lead ?? "claude") as ProviderName,
      config: await loadConfig(configPath),
      intentId: randomUUID(),
    }, { unique: true });
    const run = await finishOperation(client, operation, detach);
    if (run) printRun(run);
    return;
  }
  if (command === "status") {
    const json = takeFlag(args, "--json");
    if (args.length > 1) throw new DuetError("Invalid status command.", "INVALID_ARGUMENT");
    const result = args[0]
      ? await client.get<{ run: RunRecord; tasks: TaskRecord[]; usage: { totalTurns: number } }>(
          `/api/v1/runs/${encodeURIComponent(args[0])}`,
        )
      : await client.get<RunRecord[]>("/api/v1/runs");
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (Array.isArray(result)) {
      for (const run of result) console.log(`${run.id}  ${run.status.padEnd(24)} ${run.goal}`);
    } else printRun(result.run, result);
    return;
  }
  const runId = args.shift();
  if (!runId) throw new DuetError(`${command} requires RUN_ID.`, "INVALID_ARGUMENT");
  if (command === "tasks" || command === "logs" || command === "diff" || command === "conflict") {
    const json = takeFlag(args, "--json");
    if (args.length) throw new DuetError(`Invalid ${command} command.`, "INVALID_ARGUMENT");
    const suffix =
      command === "tasks" ? "tasks" : command === "logs" ? "messages" : command === "conflict" ? "conflicts" : "diff";
    const result = await client.get<unknown>(
      `/api/v1/runs/${encodeURIComponent(runId)}/${suffix}`,
    );
    if (json || command === "logs") console.log(JSON.stringify(result, null, 2));
    else if (command === "diff") console.log((result as { diff: string }).diff);
    else for (const task of result as TaskRecord[]) printTask(task);
    return;
  }
  if (command === "approve") {
    const stage = takeOption(args, "--stage");
    if (stage !== "plan" && stage !== "merge") throw new DuetError("Invalid approval stage.", "INVALID_ARGUMENT");
    const confirmation = await confirmed(
      client,
      runId,
      stage,
      stage === "plan" ? "approve_plan" : "approve_merge",
    );
    const run = await client.post<RunRecord>(
      `/api/v1/runs/${encodeURIComponent(runId)}/approve`,
      { stage, ...confirmation },
    );
    printRun(run);
    return;
  }
  const detach = takeFlag(args, "--detach");
  const detail = await client.get<{ run: RunRecord }>(
    `/api/v1/runs/${encodeURIComponent(runId)}`,
  );
  const expectedVersion = detail.run.version ?? 1;
  let route: string;
  let body: Record<string, unknown> = { expectedVersion };
  if (command === "run") route = "execute";
  else if (command === "resume") {
    route = "resume";
    const configPath = takeOption(args, "--config");
    if (configPath) body.config = await loadConfig(configPath);
  } else if (command === "retry" || command === "resolve") {
    const taskId = args.shift();
    if (!taskId) throw new DuetError(`${command} requires TASK_ID.`, "INVALID_ARGUMENT");
    route = `tasks/${encodeURIComponent(taskId)}/${command}`;
  } else if (command === "cancel") {
    const taskId = takeOption(args, "--task");
    route = taskId ? `tasks/${encodeURIComponent(taskId)}/cancel` : "cancel";
  } else if (command === "cleanup") {
    route = "cleanup";
    body.force = takeFlag(args, "--force");
  } else if (command === "merge") {
    const confirmation = await confirmed(client, runId, "merge", "merge");
    body = confirmation;
    route = "merge";
  } else {
    throw new DuetError(`Unknown command: ${command}`, "INVALID_ARGUMENT");
  }
  if (args.length) throw new DuetError(`Invalid ${command} command.`, "INVALID_ARGUMENT");
  const operation = await client.post<OperationRecord>(
    `/api/v1/runs/${encodeURIComponent(runId)}/${route}`,
    body,
  );
  const run = await finishOperation(client, operation, detach);
  if (run) printRun(run);
}
