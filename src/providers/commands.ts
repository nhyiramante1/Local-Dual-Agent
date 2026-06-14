import { access } from "node:fs/promises";
import path from "node:path";

export interface CommandSpec {
  command: string;
  argsPrefix: string[];
  displayName: string;
}

async function firstAccessible(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through platform-specific command candidates.
    }
  }
  return null;
}

export async function resolveClaudeCommand(): Promise<CommandSpec> {
  if (process.env.CLAUDE_BIN) {
    return {
      command: process.env.CLAUDE_BIN,
      argsPrefix: [],
      displayName: process.env.CLAUDE_BIN,
    };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const candidates = appData
      ? [
          path.join(
            appData,
            "npm",
            "node_modules",
            "@anthropic-ai",
            "claude-code",
            "bin",
            "claude.exe",
          ),
        ]
      : [];
    const executable = await firstAccessible(candidates);
    return {
      command: executable ?? "claude.exe",
      argsPrefix: [],
      displayName: executable ?? "claude.exe",
    };
  }

  return { command: "claude", argsPrefix: [], displayName: "claude" };
}

export async function resolveCodexCommand(
  projectRoot: string,
): Promise<CommandSpec> {
  if (process.env.CODEX_BIN) {
    return {
      command: process.env.CODEX_BIN,
      argsPrefix: [],
      displayName: process.env.CODEX_BIN,
    };
  }

  const entryPoint = path.join(
    projectRoot,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  const local = await firstAccessible([entryPoint]);
  if (local) {
    return {
      command: process.execPath,
      argsPrefix: [local],
      displayName: local,
    };
  }

  return { command: "codex", argsPrefix: [], displayName: "codex" };
}
