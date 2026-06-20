import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "smol-toml";

import type { ManagerBudget } from "./chat/engine.js";
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
    setupCommands: string[][];
    commands: string[][];
    timeoutSeconds: number;
    env: Record<string, string>;
  };
  manager: {
    claudeMaxUsdPerTurn: number;
    claudeMaxUsdPerDay: number;
    codexMaxInputTokensPerDay: number;
    codexMaxOutputTokensPerDay: number;
    codexMaxRuntimeSeconds: number;
    maxTurnsPerDay: number;
  };
}

export function recommendedTurnBudget(
  maxTasks: number,
  maxRevisions: number,
): number {
  return 1 + maxTasks * (2 + 2 * maxRevisions);
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
    maxAgentTurns: recommendedTurnBudget(6, 1),
    claudeMaxUsdPerTurn: 0.75,
    claudeMaxUsdPerRun: 2,
    codexMaxInputTokens: 400_000,
    codexMaxOutputTokens: 40_000,
  },
  verification: {
    setupCommands: [],
    commands: [],
    timeoutSeconds: 300,
    env: {},
  },
  manager: {
    claudeMaxUsdPerTurn: 0.5,
    claudeMaxUsdPerDay: 5,
    codexMaxInputTokensPerDay: 500_000,
    codexMaxOutputTokensPerDay: 100_000,
    codexMaxRuntimeSeconds: 120,
    maxTurnsPerDay: 200,
  },
};

export type PartialDuetConfig = {
  orchestration?: Partial<DuetConfig["orchestration"]>;
  budgets?: Partial<DuetConfig["budgets"]>;
  verification?: Partial<DuetConfig["verification"]>;
  manager?: Partial<DuetConfig["manager"]>;
};

export function normalizeConfig(value: PartialDuetConfig): DuetConfig {
  return {
    orchestration: {
      ...defaultConfig.orchestration,
      ...(value.orchestration ?? {}),
    },
    budgets: {
      ...defaultConfig.budgets,
      ...(value.budgets ?? {}),
    },
    verification: {
      ...defaultConfig.verification,
      ...(value.verification ?? {}),
      setupCommands:
        value.verification?.setupCommands ??
        defaultConfig.verification.setupCommands,
      commands:
        value.verification?.commands ?? defaultConfig.verification.commands,
      env: value.verification?.env ?? defaultConfig.verification.env,
    },
    manager: {
      ...defaultConfig.manager,
      ...(value.manager ?? {}),
    },
  };
}

export function validateConfig(value: unknown): DuetConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DuetError("Configuration must be an object.", "INVALID_CONFIG");
  }
  const config = normalizeConfig(value as PartialDuetConfig);
  const numbers: Array<[string, number, number, number?]> = [
    ["max_revisions", config.orchestration.maxRevisions, 0, 3],
    ["agent_timeout_seconds", config.orchestration.agentTimeoutSeconds, 1],
    ["max_parallel_tasks", config.orchestration.maxParallelTasks, 1, 2],
    ["max_tasks", config.orchestration.maxTasks, 1, 6],
    ["run_wall_clock_seconds", config.budgets.runWallClockSeconds, 1],
    ["max_agent_turns", config.budgets.maxAgentTurns, 1],
    ["claude_max_usd_per_turn", config.budgets.claudeMaxUsdPerTurn, 0.01],
    ["claude_max_usd_per_run", config.budgets.claudeMaxUsdPerRun, 0.01],
    ["codex_max_input_tokens", config.budgets.codexMaxInputTokens, 1],
    ["codex_max_output_tokens", config.budgets.codexMaxOutputTokens, 1],
    ["verification_timeout_seconds", config.verification.timeoutSeconds, 1],
  ];
  for (const [name, number, minimum, maximum] of numbers) {
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < minimum ||
      (maximum !== undefined && number > maximum)
    ) {
      throw new DuetError(
        `Invalid configuration value for ${name}.`,
        "INVALID_CONFIG",
      );
    }
  }
  if (!["claude", "codex"].includes(config.orchestration.defaultLead)) {
    throw new DuetError("Invalid default lead provider.", "INVALID_CONFIG");
  }
  parseCommands(config.verification.setupCommands, []);
  parseCommands(config.verification.commands, []);
  parseEnvironment(config.verification.env);
  return config;
}

interface RawConfig {
  orchestration?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  manager?: Record<string, unknown>;
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

function parseCommands(value: unknown, fallback: string[][]): string[][] {
  if (value === undefined) return fallback;
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
  const manager = raw.manager ?? {};
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
      setupCommands: parseCommands(
        verification.setup_commands,
        defaultConfig.verification.setupCommands,
      ),
      commands: parseCommands(
        verification.commands,
        defaultConfig.verification.commands,
      ),
      timeoutSeconds: numberInRange(
        verification.timeout_seconds,
        defaultConfig.verification.timeoutSeconds,
        1,
      ),
      env: parseEnvironment(verification.env),
    },
    manager: {
      claudeMaxUsdPerTurn: numberInRange(
        manager.claude_max_usd_per_turn,
        defaultConfig.manager.claudeMaxUsdPerTurn,
        0.01,
      ),
      claudeMaxUsdPerDay: numberInRange(
        manager.claude_max_usd_per_day,
        defaultConfig.manager.claudeMaxUsdPerDay,
        0.01,
      ),
      codexMaxInputTokensPerDay: Math.floor(
        numberInRange(
          manager.codex_max_input_tokens_per_day,
          defaultConfig.manager.codexMaxInputTokensPerDay,
          1,
        ),
      ),
      codexMaxOutputTokensPerDay: Math.floor(
        numberInRange(
          manager.codex_max_output_tokens_per_day,
          defaultConfig.manager.codexMaxOutputTokensPerDay,
          1,
        ),
      ),
      codexMaxRuntimeSeconds: numberInRange(
        manager.codex_runtime_seconds,
        defaultConfig.manager.codexMaxRuntimeSeconds,
        1,
      ),
      maxTurnsPerDay: Math.floor(
        numberInRange(
          manager.max_turns_per_day,
          defaultConfig.manager.maxTurnsPerDay,
          1,
        ),
      ),
    },
  };
}

export function resolveManagerBudget(config: DuetConfig): ManagerBudget {
  return { ...config.manager };
}
