import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "smol-toml";

import type { ProviderName } from "./core/domain.js";
import { DuetError } from "./core/errors.js";
import { appRoot } from "./paths.js";

export interface DuetConfig {
  orchestration: {
    defaultLead: ProviderName;
    maxRevisions: number;
    agentTimeoutSeconds: number;
    maxParallelTasks: number;
    maxTasks: number;
  };
  budgets: {
    runWallClockSeconds: number;
    maxAgentTurns: number;
    claudeMaxUsdPerTurn: number;
    claudeMaxUsdPerRun: number;
    codexMaxInputTokens: number;
    codexMaxOutputTokens: number;
  };
  verification: {
    commands: string[][];
    timeoutSeconds: number;
    env: Record<string, string>;
  };
}

export const defaultConfig: DuetConfig = {
  orchestration: {
    defaultLead: "claude",
    maxRevisions: 1,
    agentTimeoutSeconds: 600,
    maxParallelTasks: 2,
    maxTasks: 6,
  },
  budgets: {
    runWallClockSeconds: 3_600,
    maxAgentTurns: 12,
    claudeMaxUsdPerTurn: 0.75,
    claudeMaxUsdPerRun: 2,
    codexMaxInputTokens: 400_000,
    codexMaxOutputTokens: 40_000,
  },
  verification: {
    commands: [],
    timeoutSeconds: 300,
    env: {},
  },
};

interface RawConfig {
  orchestration?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}

function numberInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new DuetError(
      `Configuration number must be between ${minimum} and ${maximum}.`,
      "INVALID_CONFIG",
    );
  }
  return value;
}

function parseCommands(value: unknown): string[][] {
  if (value === undefined) return defaultConfig.verification.commands;
  if (
    !Array.isArray(value) ||
    !value.every(
      (command) =>
        Array.isArray(command) &&
        command.length > 0 &&
        command.every((part) => typeof part === "string" && part.length > 0),
    )
  ) {
    throw new DuetError(
      "verification.commands must be non-empty string arrays.",
      "INVALID_CONFIG",
    );
  }
  return value as string[][];
}

function parseEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.values(value).every((item) => typeof item === "string")
  ) {
    throw new DuetError(
      "verification.env must contain only static string values.",
      "INVALID_CONFIG",
    );
  }
  return value as Record<string, string>;
}

export async function loadConfig(configPath?: string): Promise<DuetConfig> {
  const candidate = configPath
    ? path.resolve(configPath)
    : path.join(appRoot(), "duet.toml");

  let raw: RawConfig = {};
  try {
    raw = parse(await readFile(candidate, "utf8")) as RawConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const orchestration = raw.orchestration ?? {};
  const budgets = raw.budgets ?? {};
  const verification = raw.verification ?? {};
  const lead =
    orchestration.default_lead === "codex"
      ? "codex"
      : defaultConfig.orchestration.defaultLead;

  return {
    orchestration: {
      defaultLead: lead,
      maxRevisions: Math.floor(
        numberInRange(
          orchestration.max_revisions,
          defaultConfig.orchestration.maxRevisions,
          0,
          3,
        ),
      ),
      agentTimeoutSeconds: numberInRange(
        orchestration.agent_timeout_seconds,
        defaultConfig.orchestration.agentTimeoutSeconds,
        1,
      ),
      maxParallelTasks: Math.floor(
        numberInRange(
          orchestration.max_parallel_tasks,
          defaultConfig.orchestration.maxParallelTasks,
          1,
          2,
        ),
      ),
      maxTasks: Math.floor(
        numberInRange(
          orchestration.max_tasks,
          defaultConfig.orchestration.maxTasks,
          1,
          6,
        ),
      ),
    },
    budgets: {
      runWallClockSeconds: numberInRange(
        budgets.run_wall_clock_seconds,
        defaultConfig.budgets.runWallClockSeconds,
        1,
      ),
      maxAgentTurns: Math.floor(
        numberInRange(
          budgets.max_agent_turns,
          defaultConfig.budgets.maxAgentTurns,
          1,
        ),
      ),
      claudeMaxUsdPerTurn: numberInRange(
        budgets.claude_max_usd_per_turn,
        defaultConfig.budgets.claudeMaxUsdPerTurn,
        0.01,
      ),
      claudeMaxUsdPerRun: numberInRange(
        budgets.claude_max_usd_per_run,
        defaultConfig.budgets.claudeMaxUsdPerRun,
        0.01,
      ),
      codexMaxInputTokens: Math.floor(
        numberInRange(
          budgets.codex_max_input_tokens,
          defaultConfig.budgets.codexMaxInputTokens,
          1,
        ),
      ),
      codexMaxOutputTokens: Math.floor(
        numberInRange(
          budgets.codex_max_output_tokens,
          defaultConfig.budgets.codexMaxOutputTokens,
          1,
        ),
      ),
    },
    verification: {
      commands: parseCommands(verification.commands),
      timeoutSeconds: numberInRange(
        verification.timeout_seconds,
        defaultConfig.verification.timeoutSeconds,
        1,
      ),
      env: parseEnvironment(verification.env),
    },
  };
}
