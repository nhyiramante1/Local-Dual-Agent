import os from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DoctorCheck, DoctorReport } from "./core/types.js";
import { runCommand } from "./process/run-command.js";
import {
  type CommandSpec,
  resolveClaudeCommand,
  resolveCodexCommand,
} from "./providers/commands.js";
import { sanitizedAgentEnvironment } from "./providers/environment.js";
import { appRoot, codexHomePath } from "./paths.js";
import {
  assertFingerprintUnchanged,
  fingerprintRepository,
} from "./git/repository.js";

interface DoctorOptions {
  cwd: string;
  live: boolean;
}

function check(
  id: string,
  label: string,
  result: Omit<DoctorCheck, "id" | "label">,
): DoctorCheck {
  return { id, label, ...result };
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/, 1)[0] ?? "";
}

function parseJsonLines(value: string): unknown[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

async function commandVersionCheck(
  id: string,
  label: string,
  command: CommandSpec,
  args: string[],
  cwd: string,
): Promise<DoctorCheck> {
  const result = await runCommand(
    command.command,
    [...command.argsPrefix, ...args],
    { cwd },
  );
  const output = firstLine(result.stdout || result.stderr);

  if (result.exitCode === 0 && output) {
    return check(id, label, {
      status: "pass",
      detail: output,
      durationMs: result.durationMs,
    });
  }

  return check(id, label, {
    status: "fail",
    detail: result.error ?? output ?? `Exited with code ${result.exitCode}.`,
    remediation: `Install or configure ${label}, then run duet doctor again.`,
    durationMs: result.durationMs,
  });
}

async function claudeAuthCheck(
  command: CommandSpec,
  cwd: string,
): Promise<DoctorCheck> {
  const result = await runCommand(
    command.command,
    [...command.argsPrefix, "auth", "status"],
    { cwd },
  );
  try {
    const parsed = JSON.parse(result.stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
    };
    if (result.exitCode === 0 && parsed.loggedIn) {
      return check("claude.auth", "Claude authentication", {
        status: "pass",
        detail: `${parsed.authMethod ?? "authenticated"}${
          parsed.subscriptionType ? ` (${parsed.subscriptionType})` : ""
        }`,
        durationMs: result.durationMs,
      });
    }
  } catch {
    // Report the original command output below.
  }

  return check("claude.auth", "Claude authentication", {
    status: "fail",
    detail: firstLine(result.stderr || result.stdout) || "Not authenticated.",
    remediation: "Run `claude auth login` and complete authentication.",
    durationMs: result.durationMs,
  });
}

async function codexAuthCheck(
  command: CommandSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const result = await runCommand(
    command.command,
    [...command.argsPrefix, "login", "status"],
    { cwd, env },
  );
  const output = firstLine(result.stdout || result.stderr);

  if (result.exitCode === 0) {
    return check("codex.auth", "Codex authentication", {
      status: "pass",
      detail: output || "Authenticated.",
      durationMs: result.durationMs,
    });
  }

  return check("codex.auth", "Codex authentication", {
    status: "fail",
    detail: result.error ?? output ?? "Not authenticated.",
    remediation: "Run `npm run dev -- auth codex` from the orchestrator.",
    durationMs: result.durationMs,
  });
}

async function claudeLiveCheck(
  command: CommandSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const prompt =
    "Use the Read tool exactly once on package.json without editing files. If its name is duet-orchestrator, finish with the exact marker DUET_CLAUDE_READ_OK.";
  const result = await runCommand(
    command.command,
    [
      ...command.argsPrefix,
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "Read",
      "--setting-sources",
      "user",
      "--disable-slash-commands",
      "--no-chrome",
      prompt,
    ],
    { cwd, env, timeoutMs: 120_000 },
  );
  const events = parseJsonLines(result.stdout) as Array<{
    type?: string;
    subtype?: string;
    result?: string;
    is_error?: boolean;
  }>;
  const completion = events.find(
    (event) => event.type === "result" && event.subtype === "success",
  );

  if (
    result.exitCode === 0 &&
    completion?.is_error === false &&
    completion.result?.includes("DUET_CLAUDE_READ_OK")
  ) {
    return check("claude.live", "Claude read-only model probe", {
      status: "pass",
      detail: "Claude inspected the fixture and completed its JSON event stream.",
      durationMs: result.durationMs,
    });
  }

  return check("claude.live", "Claude read-only model probe", {
    status: "fail",
    detail:
      (result.timedOut ? "Timed out before a completion event." : "") ||
      firstLine(result.stderr || result.stdout) ||
      `Exited with code ${result.exitCode}.`,
    remediation: "Inspect Claude authentication, permissions, and debug output.",
    durationMs: result.durationMs,
  });
}

async function codexLiveCheck(
  command: CommandSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck> {
  const prompt =
    "Read package.json without editing any files. If its name is duet-orchestrator, finish with the exact marker DUET_CODEX_READ_OK.";
  const result = await runCommand(
    command.command,
    [
      ...command.argsPrefix,
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      'approval_policy="never"',
      "--cd",
      cwd,
      "--skip-git-repo-check",
      prompt,
    ],
    { cwd, env, timeoutMs: 120_000 },
  );
  const events = parseJsonLines(result.stdout) as Array<{
    type?: string;
    message?: string;
    error?: { message?: string };
  }>;

  if (
    result.exitCode === 0 &&
    events.length > 0 &&
    result.stdout.includes("DUET_CODEX_READ_OK")
  ) {
    return check("codex.live", "Codex read-only model probe", {
      status: "pass",
      detail: "Codex inspected the fixture and returned structured output.",
      durationMs: result.durationMs,
    });
  }

  const failure = [...events]
    .reverse()
    .find((event) => event.type === "turn.failed" || event.type === "error");
  return check("codex.live", "Codex read-only model probe", {
    status: "fail",
    detail:
      (result.timedOut ? "Timed out before a completion event." : "") ||
      failure?.error?.message ||
      failure?.message ||
      firstLine(result.stderr || result.stdout) ||
      `Exited with code ${result.exitCode}; stdout tail: ${result.stdout.slice(-500)}.`,
    remediation: "Inspect Codex authentication, sandbox, and JSONL output.",
    durationMs: result.durationMs,
  });
}

async function createLiveProbe(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "duet-live-probe-"));
  await writeFile(
    path.join(directory, "package.json"),
    '{"name":"duet-orchestrator","private":true}\n',
  );
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Duet Doctor"],
    ["config", "user.email", "duet-doctor@example.invalid"],
    ["add", "package.json"],
    ["commit", "-m", "probe"],
  ]) {
    const result = await runCommand("git", args, {
      cwd: directory,
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      await rm(directory, { recursive: true, force: true });
      throw new Error(result.stderr || "Unable to create live probe.");
    }
  }
  return directory;
}

export async function runDoctor(
  options: DoctorOptions,
): Promise<DoctorReport> {
  const projectRoot = appRoot();
  const claudeCommand = await resolveClaudeCommand();
  const codexCommand = await resolveCodexCommand(projectRoot);
  const codexHome = codexHomePath();
  await mkdir(codexHome, { recursive: true });
  const claudeEnv = sanitizedAgentEnvironment();
  const codexEnv = sanitizedAgentEnvironment({ CODEX_HOME: codexHome });

  const checks: DoctorCheck[] = [
    check("system.platform", "Platform", {
      status: "pass",
      detail: `${os.platform()} ${os.release()} (${os.arch()})`,
      durationMs: 0,
    }),
  ];

  const [node, git, claude, codex] = await Promise.all([
    commandVersionCheck(
      "runtime.node",
      "Node.js",
      {
        command: process.execPath,
        argsPrefix: [],
        displayName: process.execPath,
      },
      ["--version"],
      projectRoot,
    ),
    commandVersionCheck(
      "runtime.git",
      "Git",
      { command: "git", argsPrefix: [], displayName: "git" },
      ["--version"],
      projectRoot,
    ),
    commandVersionCheck(
      "claude.version",
      "Claude Code",
      claudeCommand,
      ["--version"],
      projectRoot,
    ),
    commandVersionCheck(
      "codex.version",
      "Codex CLI",
      codexCommand,
      ["--version"],
      projectRoot,
    ),
  ]);
  checks.push(node, git, claude, codex);
  checks.push(
    check("codex.storage", "Codex credential storage", {
      status: "pass",
      detail: codexHome,
      durationMs: 0,
    }),
  );

  if (claude.status === "pass") {
    checks.push(await claudeAuthCheck(claudeCommand, projectRoot));
  }
  if (codex.status === "pass") {
    checks.push(await codexAuthCheck(codexCommand, projectRoot, codexEnv));
  }

  if (options.live) {
    const probeRoot = await createLiveProbe();
    try {
      const before = await fingerprintRepository(probeRoot);
      const authIds = new Map(checks.map((item) => [item.id, item.status]));
      const liveChecks: Promise<DoctorCheck>[] = [];
      if (authIds.get("claude.auth") === "pass") {
        liveChecks.push(
          claudeLiveCheck(claudeCommand, probeRoot, claudeEnv),
        );
      }
      if (authIds.get("codex.auth") === "pass") {
        liveChecks.push(codexLiveCheck(codexCommand, probeRoot, codexEnv));
      }
      checks.push(...(await Promise.all(liveChecks)));
      const after = await fingerprintRepository(probeRoot);
      try {
        assertFingerprintUnchanged(before, after);
        checks.push(
          check("providers.readonly", "Live read-only postcondition", {
            status: "pass",
            detail: "Both provider probes left the committed fixture unchanged.",
            durationMs: 0,
          }),
        );
      } catch (error) {
        checks.push(
          check("providers.readonly", "Live read-only postcondition", {
            status: "fail",
            detail:
              error instanceof Error ? error.message : String(error),
            remediation:
              "Inspect the provider sandbox and permissions before running Duet.",
            durationMs: 0,
          }),
        );
      }
    } finally {
      await rm(probeRoot, { recursive: true, force: true });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    live: options.live,
    ok: checks.every((item) => item.status !== "fail"),
    checks,
  };
}

export function printDoctorReport(report: DoctorReport): void {
  console.log(`Duet doctor (${report.live ? "live" : "local"})`);
  for (const item of report.checks) {
    const marker =
      item.status === "pass" ? "PASS" : item.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker.padEnd(4)} ${item.label}: ${item.detail}`);
    if (item.remediation) {
      console.log(`     Fix: ${item.remediation}`);
    }
  }
  console.log(report.ok ? "Ready." : "Not ready.");
}
