import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type {
  AgentProfile,
  ConversationRecord,
  ManagerActionProposal,
  ManagerToolDefinition,
  ProviderName,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { Store } from "../persistence/store.js";
import {
  type RawProposal,
  type SynthesizedProposal,
  tryValidateAndSynthesize,
} from "./proposals.js";

export interface ManagerToolExecution {
  name: string;
  ok: boolean;
  elapsedMs: number;
  result: unknown;
  proposal?: SynthesizedProposal;
}

export const managerToolDefinitions: ManagerToolDefinition[] = [
  {
    name: "list_runs",
    description: "List recent Duet runs visible to the manager.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "inspect_run",
    description: "Inspect one Duet run, including tasks and usage.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: { type: "string", minLength: 1, maxLength: 120 },
      },
    },
  },
  {
    name: "check_path",
    description: "Check whether a local path exists and what kind of filesystem entry it is.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1_000 },
      },
    },
  },
  {
    name: "check_git_repo",
    description: "Check whether a local path appears to be a Git repository.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1_000 },
      },
    },
  },
  {
    name: "resolve_alias",
    description: "Resolve a configured Duet repository alias.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
  },
  {
    name: "create_plan_proposal",
    description: "Create a durable dashboard proposal card for a Duet planning operation. Does not execute the operation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["repoPath", "goal"],
      properties: {
        repoPath: { type: "string", minLength: 1, maxLength: 1_000 },
        goal: { type: "string", minLength: 1, maxLength: 20_000 },
        lead: { type: "string", enum: ["claude", "codex"] },
        profile: { type: "string", enum: ["cheap", "balanced", "reasoning", "max"] },
        rationale: { type: "string", maxLength: 2_000 },
      },
    },
  },
  {
    name: "set_strategy_proposal",
    description: "Create a durable proposal card for the user's preferred lead/profile strategy.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["lead", "profile", "rationale"],
      properties: {
        lead: { type: "string", enum: ["claude", "codex"] },
        profile: { type: "string", enum: ["cheap", "balanced", "reasoning", "max"] },
        rationale: { type: "string", minLength: 1, maxLength: 2_000 },
      },
    },
  },
  {
    name: "set_alias_proposal",
    description: "Create a durable proposal card to save a repository alias. Does not save the alias until the user starts it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "repoPath"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        repoPath: { type: "string", minLength: 1, maxLength: 1_000 },
        lead: { type: "string", enum: ["claude", "codex"] },
        profile: { type: "string", enum: ["cheap", "balanced", "reasoning", "max"] },
        description: { type: "string", maxLength: 500 },
      },
    },
  },
  {
    name: "request_agent_consultation",
    description: "Create a consent card to ask Claude, Codex, or both for a paid read-only consultation. Phase 7A does not execute it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question", "agents", "mode", "reason"],
      properties: {
        question: { type: "string", minLength: 1, maxLength: 20_000 },
        agents: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string", enum: ["claude", "codex"] },
        },
        mode: { type: "string", enum: ["independent"] },
        reason: { type: "string", minLength: 1, maxLength: 2_000 },
        profile: { type: "string", enum: ["cheap", "balanced", "reasoning", "max"] },
        maxTurns: { type: "integer", minimum: 1, maximum: 5 },
        maxRuntimeSeconds: { type: "integer", minimum: 10, maximum: 300 },
      },
    },
  },
];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DuetError(`Tool argument "${name}" must be a non-empty string.`, "INVALID_ARGUMENT");
  }
  return value.trim();
}

// Some tool-capable models over-escape Windows paths (e.g. "C:\\\\Users\\\\x"),
// yielding doubled separators after JSON.parse. Collapse them so filesystem and
// proposal commands receive a clean path regardless of the model's escaping.
function pathArg(args: Record<string, unknown>, name: string): string {
  return path.normalize(stringArg(args, name));
}

function optionalProfile(args: Record<string, unknown>): AgentProfile | undefined {
  const value = args.profile;
  return value === "cheap" || value === "balanced" || value === "reasoning" || value === "max"
    ? value
    : undefined;
}

function optionalLead(args: Record<string, unknown>): ProviderName | undefined {
  const value = args.lead;
  return value === "claude" || value === "codex" ? value : undefined;
}

function boundedRuns(store: Store, limit: number): unknown[] {
  return store.listRuns().slice(0, limit).map((run) => ({
    id: run.id,
    goal: run.goal.slice(0, 500),
    status: run.status,
    leadProvider: run.leadProvider,
    repoRoot: run.repoRoot,
    baseBranch: run.baseBranch,
    version: run.version,
    updatedAt: run.updatedAt,
  }));
}

function proposalResult(proposal: SynthesizedProposal): unknown {
  return {
    proposalCreated: true,
    action: proposal.action,
    tier: proposal.tier,
    summary: proposal.summary,
    runId: proposal.runId,
    taskId: proposal.taskId,
    expiresAt: proposal.expiresAt,
  };
}

export async function executeManagerTool(input: {
  name: string;
  argumentsJson: string;
  store: Store;
  conversation: ConversationRecord;
  configAliases: Record<string, string>;
}): Promise<ManagerToolExecution> {
  const started = performance.now();
  try {
    const args = asObject(JSON.parse(input.argumentsJson || "{}"));
    const result = await executeKnownTool(
      input.name,
      args,
      input.store,
      input.conversation,
      input.configAliases,
    );
    return {
      name: input.name,
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      result: result.result,
      proposal: result.proposal,
    };
  } catch (error) {
    return {
      name: input.name,
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      result: {
        code: error instanceof DuetError ? error.code : "TOOL_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function executeKnownTool(
  name: string,
  args: Record<string, unknown>,
  store: Store,
  conversation: ConversationRecord,
  configAliases: Record<string, string>,
): Promise<{ result: unknown; proposal?: SynthesizedProposal }> {
  if (name === "list_runs") {
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, Math.floor(args.limit))) : 10;
    return { result: { runs: boundedRuns(store, limit) } };
  }
  if (name === "inspect_run") {
    const runId = stringArg(args, "runId");
    const run = store.getRun(runId);
    return {
      result: {
        run: {
          id: run.id,
          goal: run.goal.slice(0, 1_000),
          status: run.status,
          leadProvider: run.leadProvider,
          repoRoot: run.repoRoot,
          baseBranch: run.baseBranch,
          baseCommit: run.baseCommit,
          version: run.version,
        },
        tasks: store.listTasks(run.id).map((task) => ({
          id: task.id,
          title: task.plan.title.slice(0, 500),
          status: task.status,
          provider: task.provider,
          reviewerProvider: task.reviewerProvider,
          version: task.version,
          error: task.error?.slice(0, 1_000),
        })),
        usage: store.getUsageSummary(run.id),
        activeOperations: store.listActiveOperations().filter((op) => op.runId === run.id).map((op) => ({
          id: op.id,
          kind: op.kind,
          status: op.status,
          heartbeatAt: op.heartbeatAt,
        })),
      },
    };
  }
  if (name === "check_path") {
    const candidate = pathArg(args, "path");
    if (!existsSync(candidate)) return { result: { exists: false, path: candidate } };
    const stat = statSync(candidate);
    return {
      result: {
        exists: true,
        path: candidate,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        isSymbolicLink: stat.isSymbolicLink(),
      },
    };
  }
  if (name === "check_git_repo") {
    const candidate = pathArg(args, "path");
    const exists = existsSync(candidate);
    const gitPath = path.join(candidate, ".git");
    return {
      result: {
        path: candidate,
        exists,
        isGitRepo: exists && existsSync(gitPath),
        gitPathExists: existsSync(gitPath),
        code: exists && existsSync(gitPath) ? "OK" : "NOT_GIT_REPO",
      },
    };
  }
  if (name === "resolve_alias") {
    const alias = stringArg(args, "name").toLowerCase();
    const record = store.getAlias(alias);
    const repoPath = record?.repoPath ?? configAliases[alias];
    return {
      result: repoPath
        ? { found: true, name: alias, repoPath, source: record ? "sqlite" : "config" }
        : { found: false, name: alias },
    };
  }
  if (name === "create_plan_proposal") {
    const raw: RawProposal = {
      action: "create_plan",
      repoPath: pathArg(args, "repoPath"),
      goal: stringArg(args, "goal"),
      lead: optionalLead(args),
      profile: optionalProfile(args),
      rationale: typeof args.rationale === "string" ? args.rationale : undefined,
    };
    return synthesizeToolProposal(raw, store, conversation, configAliases);
  }
  if (name === "set_strategy_proposal") {
    const raw: RawProposal = {
      action: "set_strategy",
      lead: optionalLead(args),
      profile: optionalProfile(args),
      rationale: stringArg(args, "rationale"),
    };
    return synthesizeToolProposal(raw, store, conversation, configAliases);
  }
  if (name === "set_alias_proposal") {
    const raw: RawProposal = {
      action: "set_alias",
      name: stringArg(args, "name"),
      repoPath: pathArg(args, "repoPath"),
      lead: optionalLead(args),
      profile: optionalProfile(args),
      description: typeof args.description === "string" ? args.description : undefined,
    };
    return synthesizeToolProposal(raw, store, conversation, configAliases);
  }
  if (name === "request_agent_consultation") {
    const raw: RawProposal = {
      action: "agent_consultation",
      question: stringArg(args, "question"),
      agents: Array.isArray(args.agents) ? args.agents : [],
      mode: "independent",
      profile: optionalProfile(args),
      maxTurns: args.maxTurns,
      maxRuntimeSeconds: args.maxRuntimeSeconds,
      rationale: stringArg(args, "reason"),
    };
    return synthesizeToolProposal(raw, store, conversation, configAliases);
  }
  throw new DuetError(`Unknown manager tool: ${name}`, "INVALID_ARGUMENT");
}

function synthesizeToolProposal(
  raw: RawProposal,
  store: Store,
  conversation: ConversationRecord,
  configAliases: Record<string, string>,
): { result: unknown; proposal?: SynthesizedProposal } {
  const diagnostics: { reason?: string } = {};
  const proposal = tryValidateAndSynthesize(
    raw,
    conversation,
    store,
    undefined,
    configAliases,
    diagnostics,
    false,
    true,
  );
  if (!proposal) {
    throw new DuetError(
      diagnostics.reason ?? `Could not create proposal for ${raw.action}.`,
      "PROPOSAL_VALIDATION_FAILED",
    );
  }
  return { result: proposalResult(proposal), proposal };
}

export function serializeToolExecutions(executions: ManagerToolExecution[]): string {
  return JSON.stringify(
    executions.map((execution) => ({
      tool: execution.name,
      ok: execution.ok,
      elapsedMs: execution.elapsedMs,
      result: execution.result,
    })),
    null,
    2,
  );
}
