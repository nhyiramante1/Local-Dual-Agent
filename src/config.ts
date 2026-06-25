import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "smol-toml";

import type { AgentProfile, ManagerBudget, ManagerProviderName, ProviderName } from "./core/domain.js";
import { DuetError } from "./core/errors.js";
import { appRoot } from "./paths.js";

export interface DuetConfig {
  service: {
    host: string;
    port: number | undefined;
  };
  orchestration: {
    defaultLead: ProviderName;
    maxRevisions: number;
    agentTimeoutSeconds: number;
    maxParallelTasks: number;
    maxTasks: number;
    profile: AgentProfile;
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
    provider: ManagerProviderName;
    openaiModel: string;
    openaiBaseUrl: string | undefined;
    openaiMaxUsdPerTurn: number;
    openaiMaxUsdPerDay: number;
    claudeMaxUsdPerTurn: number;
    claudeMaxUsdPerDay: number;
    codexMaxInputTokensPerDay: number;
    codexMaxOutputTokensPerDay: number;
    codexMaxRuntimeSeconds: number;
    maxTurnsPerDay: number;
    nativeToolCalling: boolean;
    actionMode: ManagerActionMode;
    supportsMultiStepToolLoop: boolean;
    supportsAgentConsultation: boolean;
    latencyTier: ManagerLatencyTier;
    maxToolCallsPerTurn: number;
  };
  dashboard: {
    persistentAccess: boolean;
    publicHost: string | undefined;
  };
  aliases: Record<string, string>;
}

export type ManagerActionMode =
  | "recommended"
  | "available"
  | "experimental"
  | "disabled";
export type ManagerLatencyTier = "fast" | "balanced" | "slow";

export function recommendedTurnBudget(
  maxTasks: number,
  maxRevisions: number,
): number {
  return 1 + maxTasks * (2 + 2 * maxRevisions);
}

const VALID_PROFILES = new Set<AgentProfile>(["cheap", "balanced", "reasoning", "max"]);
const VALID_MANAGER_PROVIDERS = new Set<ManagerProviderName>(["claude", "codex", "openai", "groq", "gemini"]);
const VALID_MANAGER_ACTION_MODES = new Set<ManagerActionMode>([
  "recommended",
  "available",
  "experimental",
  "disabled",
]);
const VALID_MANAGER_LATENCY_TIERS = new Set<ManagerLatencyTier>([
  "fast",
  "balanced",
  "slow",
]);

export const defaultConfig: DuetConfig = {
  service: {
    host: "127.0.0.1",
    port: undefined,
  },
  orchestration: {
    defaultLead: "claude",
    maxRevisions: 1,
    agentTimeoutSeconds: 600,
    maxParallelTasks: 2,
    maxTasks: 6,
    profile: "balanced",
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
    provider: "groq" as ManagerProviderName,
    openaiModel: "gpt-4o-mini",
    openaiBaseUrl: undefined,
    openaiMaxUsdPerTurn: 0.1,
    openaiMaxUsdPerDay: 2,
    claudeMaxUsdPerTurn: 0.5,
    claudeMaxUsdPerDay: 5,
    codexMaxInputTokensPerDay: 500_000,
    codexMaxOutputTokensPerDay: 100_000,
    codexMaxRuntimeSeconds: 120,
    maxTurnsPerDay: 200,
    nativeToolCalling: true,
    actionMode: "recommended",
    supportsMultiStepToolLoop: true,
    supportsAgentConsultation: true,
    latencyTier: "balanced",
    maxToolCallsPerTurn: 5,
  },
  dashboard: {
    persistentAccess: false,
    publicHost: undefined,
  },
  aliases: {},
};

export type PartialDuetConfig = {
  service?: Partial<DuetConfig["service"]>;
  orchestration?: Partial<DuetConfig["orchestration"]>;
  budgets?: Partial<DuetConfig["budgets"]>;
  verification?: Partial<DuetConfig["verification"]>;
  manager?: Partial<DuetConfig["manager"]>;
  dashboard?: Partial<DuetConfig["dashboard"]>;
  aliases?: Record<string, string>;
};

export function normalizeConfig(value: PartialDuetConfig): DuetConfig {
  return {
    service: {
      ...defaultConfig.service,
      ...(value.service ?? {}),
    },
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
    dashboard: {
      ...defaultConfig.dashboard,
      ...(value.dashboard ?? {}),
    },
    aliases: value.aliases ?? {},
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
  if (
    typeof config.service.host !== "string" ||
    !isValidListenHost(config.service.host)
  ) {
    throw new DuetError(
      "Invalid configuration value for service.host.",
      "INVALID_CONFIG",
    );
  }
  if (
    config.dashboard.publicHost !== undefined &&
    (
      typeof config.dashboard.publicHost !== "string" ||
      !isValidPublicHost(config.dashboard.publicHost)
    )
  ) {
    throw new DuetError(
      "Invalid configuration value for dashboard.public_host.",
      "INVALID_CONFIG",
    );
  }
  if (
    config.service.port !== undefined &&
    (
      typeof config.service.port !== "number" ||
      !Number.isInteger(config.service.port) ||
      config.service.port < 1 ||
      config.service.port > 65_535
    )
  ) {
    throw new DuetError(
      "Invalid configuration value for service.port.",
      "INVALID_CONFIG",
    );
  }
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
  service?: Record<string, unknown>;
  orchestration?: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  manager?: Record<string, unknown>;
  dashboard?: Record<string, unknown>;
  aliases?: Record<string, unknown>;
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

function isValidListenHost(value: string): boolean {
  return (
    value === "127.0.0.1" ||
    value === "localhost" ||
    value === "::1" ||
    value === "0.0.0.0" ||
    value === "::"
  );
}

function isValidPublicHost(value: string): boolean {
  return (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) ||
    /^[a-z0-9.-]+$/i.test(value)
  );
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
  const service = raw.service ?? {};
  const dashboard = raw.dashboard ?? {};
  const rawAliases = raw.aliases ?? {};
  const aliases: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawAliases)) {
    if (typeof value === "string" && value.trim().length > 0 && /^[a-z0-9_-]+$/i.test(name)) {
      aliases[name.toLowerCase()] = value.trim();
    }
  }
  const lead =
    orchestration.default_lead === "codex"
      ? "codex"
      : defaultConfig.orchestration.defaultLead;

  return {
    service: {
      host:
        typeof service.host === "string" && isValidListenHost(service.host)
          ? service.host
          : defaultConfig.service.host,
      port:
        service.port === undefined
          ? defaultConfig.service.port
          : Math.floor(numberInRange(service.port, 0, 1, 65_535)),
    },
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
      profile: VALID_PROFILES.has(orchestration.profile as AgentProfile)
        ? (orchestration.profile as AgentProfile)
        : defaultConfig.orchestration.profile,
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
      provider: VALID_MANAGER_PROVIDERS.has(manager.provider as ManagerProviderName)
        ? (manager.provider as ManagerProviderName)
        : defaultConfig.manager.provider,
      openaiModel:
        typeof manager.openai_model === "string"
          ? manager.openai_model
          : defaultConfig.manager.openaiModel,
      openaiBaseUrl:
        typeof manager.openai_base_url === "string"
          ? manager.openai_base_url
          : undefined,
      openaiMaxUsdPerTurn: numberInRange(
        manager.openai_max_usd_per_turn,
        defaultConfig.manager.openaiMaxUsdPerTurn,
        0.01,
      ),
      openaiMaxUsdPerDay: numberInRange(
        manager.openai_max_usd_per_day,
        defaultConfig.manager.openaiMaxUsdPerDay,
        0.01,
      ),
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
      nativeToolCalling:
        manager.native_tool_calling === undefined
          ? defaultConfig.manager.nativeToolCalling
          : manager.native_tool_calling === true,
      actionMode:
        typeof manager.action_mode === "string" &&
        VALID_MANAGER_ACTION_MODES.has(manager.action_mode as ManagerActionMode)
          ? (manager.action_mode as ManagerActionMode)
          : defaultConfig.manager.actionMode,
      supportsMultiStepToolLoop:
        manager.supports_multi_step_tool_loop === undefined
          ? defaultConfig.manager.supportsMultiStepToolLoop
          : manager.supports_multi_step_tool_loop === true,
      supportsAgentConsultation:
        manager.supports_agent_consultation === undefined
          ? defaultConfig.manager.supportsAgentConsultation
          : manager.supports_agent_consultation === true,
      latencyTier:
        typeof manager.latency_tier === "string" &&
        VALID_MANAGER_LATENCY_TIERS.has(manager.latency_tier as ManagerLatencyTier)
          ? (manager.latency_tier as ManagerLatencyTier)
          : defaultConfig.manager.latencyTier,
      maxToolCallsPerTurn: Math.floor(
        numberInRange(
          manager.max_tool_calls_per_turn,
          defaultConfig.manager.maxToolCallsPerTurn,
          1,
          10,
        ),
      ),
    },
    dashboard: {
      persistentAccess: dashboard.persistent_access === true,
      publicHost:
        typeof dashboard.public_host === "string" &&
        isValidPublicHost(dashboard.public_host)
          ? dashboard.public_host
          : defaultConfig.dashboard.publicHost,
    },
    aliases,
  };
}

export function resolveManagerBudget(config: DuetConfig): ManagerBudget {
  const {
    provider: _provider,
    openaiModel: _model,
    openaiBaseUrl: _base,
    nativeToolCalling: _native,
    actionMode: _mode,
    supportsMultiStepToolLoop: _loop,
    supportsAgentConsultation: _consult,
    latencyTier: _latency,
    maxToolCallsPerTurn: _tools,
    ...budget
  } = config.manager;
  return budget;
}
