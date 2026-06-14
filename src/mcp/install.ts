import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "smol-toml";

import { DuetError } from "../core/errors.js";
import { appRoot } from "../paths.js";
import { runCommand } from "../process/run-command.js";
import { duetToolNames, type DuetToolName } from "./types.js";

const managedBegin = "# BEGIN DUET MCP (managed by Local Dual Agent)";
const managedEnd = "# END DUET MCP (managed by Local Dual Agent)";
const readTools = duetToolNames.filter(
  (name) => name !== "duet_create_plan",
);

export type McpTarget = "claude" | "codex";
export type InstallState =
  | "installed"
  | "missing"
  | "unmanaged"
  | "mismatch";

export interface InstallStatus {
  target: McpTarget;
  state: InstallState;
  detail: string;
}

export interface CommandRunner {
  (
    command: string,
    args: string[],
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface McpInstallOptions {
  force?: boolean;
  nodePath?: string;
  entryPath?: string;
  claudeCommand?: string;
  codexConfigPath?: string;
  runner?: CommandRunner;
  now?: () => Date;
}

export async function mcpLaunchSpec(
  options: McpInstallOptions = {},
): Promise<{ nodePath: string; entryPath: string }> {
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const entryPath = path.resolve(
    options.entryPath ?? path.join(appRoot(), "dist", "duet-mcp.js"),
  );
  try {
    await access(entryPath);
  } catch {
    throw new DuetError(
      `MCP entry point is missing: ${entryPath}. Run npm run build first.`,
      "MCP_ENTRY_MISSING",
    );
  }
  return { nodePath, entryPath };
}

function defaultRunner(): CommandRunner {
  return async (command, args) => {
    const result = await runCommand(command, args, {
      cwd: appRoot(),
      timeoutMs: 30_000,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr || result.error || "",
    };
  };
}

function claudeCommand(options: McpInstallOptions): string {
  return (
    options.claudeCommand ??
    process.env.DUET_CLAUDE_COMMAND ??
    "claude"
  );
}

function codexConfigPath(options: McpInstallOptions): string {
  return path.resolve(
    options.codexConfigPath ??
      path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml"),
  );
}

function normalizeForMatch(value: string): string {
  return value.replaceAll("\\\\", "\\").toLowerCase();
}

async function claudeDetails(
  options: McpInstallOptions,
): Promise<{
  exists: boolean;
  matches: boolean;
  output: string;
}> {
  const runner = options.runner ?? defaultRunner();
  const result = await runner(claudeCommand(options), ["mcp", "get", "duet"]);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    return { exists: false, matches: false, output };
  }
  const launch = await mcpLaunchSpec(options);
  const normalized = normalizeForMatch(output);
  return {
    exists: true,
    matches:
      normalized.includes(normalizeForMatch(launch.nodePath)) &&
      normalized.includes(normalizeForMatch(launch.entryPath)),
    output,
  };
}

export async function claudeMcpStatus(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const details = await claudeDetails(options);
  if (!details.exists) {
    return {
      target: "claude",
      state: "missing",
      detail: "Claude Code has no user-scoped MCP server named duet.",
    };
  }
  return details.matches
    ? {
        target: "claude",
        state: "installed",
        detail: "Claude Code points duet at this installation.",
      }
    : {
        target: "claude",
        state: "unmanaged",
        detail: "Claude Code already has a different MCP server named duet.",
      };
}

export async function installClaudeMcp(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const launch = await mcpLaunchSpec(options);
  const current = await claudeMcpStatus(options);
  if (current.state === "installed") return current;
  if (current.state === "unmanaged" && !options.force) {
    throw new DuetError(
      "Claude Code already has an unmanaged MCP server named duet. Use --force to replace it.",
      "MCP_CONFIG_CONFLICT",
    );
  }
  const runner = options.runner ?? defaultRunner();
  if (current.state !== "missing") {
    const removed = await runner(claudeCommand(options), [
      "mcp",
      "remove",
      "--scope",
      "user",
      "duet",
    ]);
    if (removed.exitCode !== 0) {
      throw new DuetError(
        removed.stderr || "Claude MCP removal failed.",
        "MCP_INSTALL_FAILED",
      );
    }
  }
  const added = await runner(claudeCommand(options), [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "stdio",
    "duet",
    "--",
    launch.nodePath,
    launch.entryPath,
  ]);
  if (added.exitCode !== 0) {
    throw new DuetError(
      added.stderr || "Claude MCP installation failed.",
      "MCP_INSTALL_FAILED",
    );
  }
  return {
    target: "claude",
    state: "installed",
    detail: "Installed for Claude Code user scope. Restart or reload Claude Code.",
  };
}

export async function uninstallClaudeMcp(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const current = await claudeMcpStatus(options);
  if (current.state === "missing") return current;
  if (current.state === "unmanaged" && !options.force) {
    throw new DuetError(
      "Refusing to remove an unmanaged Claude MCP server named duet.",
      "MCP_CONFIG_CONFLICT",
    );
  }
  const runner = options.runner ?? defaultRunner();
  const removed = await runner(claudeCommand(options), [
    "mcp",
    "remove",
    "--scope",
    "user",
    "duet",
  ]);
  if (removed.exitCode !== 0) {
    throw new DuetError(
      removed.stderr || "Claude MCP removal failed.",
      "MCP_INSTALL_FAILED",
    );
  }
  return {
    target: "claude",
    state: "missing",
    detail: "Removed from Claude Code user scope. Restart or reload Claude Code.",
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexManagedBlock(nodePath: string, entryPath: string): string {
  const lines = [
    managedBegin,
    "[mcp_servers.duet]",
    `command = ${tomlString(nodePath)}`,
    `args = [${tomlString(entryPath)}]`,
    "enabled = true",
    "required = false",
    `enabled_tools = [${duetToolNames.map(tomlString).join(", ")}]`,
    'default_tools_approval_mode = "prompt"',
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 30",
  ];
  for (const tool of readTools) {
    lines.push(
      "",
      `[mcp_servers.duet.tools.${tool}]`,
      'approval_mode = "approve"',
    );
  }
  lines.push(
    "",
    "[mcp_servers.duet.tools.duet_create_plan]",
    'approval_mode = "prompt"',
    managedEnd,
  );
  return `${lines.join("\n")}\n`;
}

function managedRange(content: string): { start: number; end: number } | undefined {
  const start = content.indexOf(managedBegin);
  const endMarker = content.indexOf(managedEnd);
  if (start < 0 && endMarker < 0) return undefined;
  if (start < 0 || endMarker < start) {
    throw new DuetError(
      "Codex config contains an incomplete Duet managed block.",
      "MCP_CONFIG_INVALID",
    );
  }
  const duplicateStart = content.indexOf(managedBegin, start + managedBegin.length);
  const duplicateEnd = content.indexOf(managedEnd, endMarker + managedEnd.length);
  if (duplicateStart >= 0 || duplicateEnd >= 0) {
    throw new DuetError(
      "Codex config contains duplicate Duet managed markers.",
      "MCP_CONFIG_INVALID",
    );
  }
  let end = endMarker + managedEnd.length;
  if (content[end] === "\r" && content[end + 1] === "\n") end += 2;
  else if (content[end] === "\n") end += 1;
  return { start, end };
}

function hasUnmanagedDuet(content: string): boolean {
  return /^\s*\[mcp_servers\.duet(?:\]|\.)/m.test(content);
}

function removeUnmanagedDuet(content: string): string {
  const lines = content.split(/(?<=\n)/);
  let removing = false;
  const kept: string[] = [];
  for (const line of lines) {
    const heading = /^\s*\[([^\]]+)]/.exec(line)?.[1];
    if (heading) {
      if (heading === "mcp_servers.duet" || heading.startsWith("mcp_servers.duet.")) {
        removing = true;
        continue;
      }
      removing = false;
    }
    if (!removing) kept.push(line);
  }
  return kept.join("");
}

function validateToml(content: string): void {
  try {
    parse(content || "");
  } catch (error) {
    throw new DuetError(
      `Codex config is not valid TOML: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "MCP_CONFIG_INVALID",
    );
  }
}

async function readCodexConfig(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function parsedDuetConfig(content: string): Record<string, unknown> | undefined {
  const parsed = parse(content || "") as {
    mcp_servers?: Record<string, Record<string, unknown>>;
  };
  return parsed.mcp_servers?.duet;
}

function codexMatches(
  content: string,
  nodePath: string,
  entryPath: string,
): boolean {
  const duet = parsedDuetConfig(content);
  if (!duet) return false;
  const tools = duet.tools as
    | Record<DuetToolName, { approval_mode?: string }>
    | undefined;
  const enabledTools = Array.isArray(duet.enabled_tools)
    ? duet.enabled_tools
    : undefined;
  return (
    duet.command === nodePath &&
    Array.isArray(duet.args) &&
    duet.args.length === 1 &&
    duet.args[0] === entryPath &&
    enabledTools !== undefined &&
    duetToolNames.every((tool) => enabledTools.includes(tool)) &&
    enabledTools.length === duetToolNames.length &&
    duet.tool_timeout_sec === 30 &&
    duet.startup_timeout_sec === 30 &&
    readTools.every((tool) => tools?.[tool]?.approval_mode === "approve") &&
    tools?.duet_create_plan?.approval_mode === "prompt"
  );
}

export async function codexMcpStatus(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const file = codexConfigPath(options);
  const content = await readCodexConfig(file);
  validateToml(content);
  const range = managedRange(content);
  if (!range && hasUnmanagedDuet(content)) {
    return {
      target: "codex",
      state: "unmanaged",
      detail: `Codex has an unmanaged duet configuration in ${file}.`,
    };
  }
  if (!range) {
    return {
      target: "codex",
      state: "missing",
      detail: `Codex has no Duet managed block in ${file}.`,
    };
  }
  const launch = await mcpLaunchSpec(options);
  return codexMatches(content, launch.nodePath, launch.entryPath)
    ? {
        target: "codex",
        state: "installed",
        detail: `Codex points duet at this installation in ${file}.`,
      }
    : {
        target: "codex",
        state: "mismatch",
        detail: `Codex contains an outdated Duet managed block in ${file}.`,
      };
}

async function backupCodexConfig(
  file: string,
  options: McpInstallOptions,
): Promise<string> {
  const stamp = (options.now?.() ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const backup = `${file}.duet-backup-${stamp}`;
  await copyFile(file, backup);
  return backup;
}

export async function installCodexMcp(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const file = codexConfigPath(options);
  let content = await readCodexConfig(file);
  validateToml(content);
  const range = managedRange(content);
  const unmanaged = !range && hasUnmanagedDuet(content);
  if (unmanaged && !options.force) {
    throw new DuetError(
      "Codex already has an unmanaged mcp_servers.duet table. Use --force to replace it.",
      "MCP_CONFIG_CONFLICT",
    );
  }
  const launch = await mcpLaunchSpec(options);
  if (range && codexMatches(content, launch.nodePath, launch.entryPath)) {
    return {
      target: "codex",
      state: "installed",
      detail: `Codex already points duet at this installation in ${file}.`,
    };
  }
  if (unmanaged && content) {
    await backupCodexConfig(file, options);
    content = removeUnmanagedDuet(content);
  } else if (range) {
    content = `${content.slice(0, range.start)}${content.slice(range.end)}`;
  }
  const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  const updated = `${content}${separator}${
    content.trim() ? "\n" : ""
  }${codexManagedBlock(launch.nodePath, launch.entryPath)}`;
  validateToml(updated);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, updated, "utf8");
  return {
    target: "codex",
    state: "installed",
    detail: `Installed in ${file}. Restart or reload Codex.`,
  };
}

export async function uninstallCodexMcp(
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  const file = codexConfigPath(options);
  const content = await readCodexConfig(file);
  validateToml(content);
  const range = managedRange(content);
  if (!range) {
    if (hasUnmanagedDuet(content)) {
      throw new DuetError(
        "Refusing to remove an unmanaged Codex duet configuration.",
        "MCP_CONFIG_CONFLICT",
      );
    }
    return {
      target: "codex",
      state: "missing",
      detail: `No Duet managed block exists in ${file}.`,
    };
  }
  const updated = `${content.slice(0, range.start)}${content.slice(range.end)}`
    .replace(/\n{3,}/g, "\n\n");
  validateToml(updated);
  await writeFile(file, updated, "utf8");
  return {
    target: "codex",
    state: "missing",
    detail: `Removed the Duet managed block from ${file}. Restart or reload Codex.`,
  };
}

export async function installMcp(
  target: McpTarget,
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  return target === "claude"
    ? await installClaudeMcp(options)
    : await installCodexMcp(options);
}

export async function mcpStatus(
  target: McpTarget,
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  return target === "claude"
    ? await claudeMcpStatus(options)
    : await codexMcpStatus(options);
}

export async function uninstallMcp(
  target: McpTarget,
  options: McpInstallOptions = {},
): Promise<InstallStatus> {
  return target === "claude"
    ? await uninstallClaudeMcp(options)
    : await uninstallCodexMcp(options);
}
