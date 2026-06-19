import type {
  LongRunningCommand,
} from "../application/activities.js";
import type {
  ConversationRecord,
  ManagerActionProposal,
  ProposalAction,
  ProposalTier,
  RunRecord,
  TaskRecord,
} from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { Store } from "../persistence/store.js";

export interface RawProposal {
  action: string;
  runId?: string;
  taskId?: string;
  rationale?: string;
  // model may supply command/commandCli/cli/tier/commandJson - all ignored
}

export type ParseResult =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "parsed"; raw: RawProposal; strippedText: string };

export interface SynthesizedProposal {
  action: ProposalAction;
  runId: string;
  taskId?: string;
  commandCli: string;
  commandJson: string;
  tier: ProposalTier;
  summary: string;
  expiresAt: string;
}

export interface PreparedProposalAction {
  proposalId: string;
  action: ProposalAction;
  tier: ProposalTier;
  runId?: string;
  taskId?: string;
  commandCli: string;
  available: boolean;
  requirements: string[];
  warnings: string[];
  blockedReason?: string;
  run?: {
    id: string;
    status: RunRecord["status"];
    version: number;
  };
  task?: {
    id: string;
    status: TaskRecord["status"];
    version: number;
  };
}

export interface StartProposalInput {
  confirm?: unknown;
  expectedRunVersion?: unknown;
  expectedTaskVersion?: unknown;
}

export interface StartProposalResult {
  proposal: ManagerActionProposal;
  command: LongRunningCommand;
}

type ActionSpec = {
  tier: ProposalTier;
  requiresTask: boolean;
  cli: (runId: string, taskId?: string) => string;
  jsonFields: (runId: string, taskId?: string) => Record<string, unknown>;
};

const PROPOSAL_EXPIRY_MS = 15 * 60 * 1_000;

const ACTION_SPECS: Readonly<Record<ProposalAction, ActionSpec>> = {
  execute_run: {
    tier: "ordinary",
    requiresTask: false,
    cli: (r) => `duet run ${r}`,
    jsonFields: (r) => ({ action: "execute_run", runId: r }),
  },
  resume_run: {
    tier: "ordinary",
    requiresTask: false,
    cli: (r) => `duet resume ${r}`,
    jsonFields: (r) => ({ action: "resume_run", runId: r }),
  },
  retry_task: {
    tier: "ordinary",
    requiresTask: true,
    cli: (r, t) => `duet retry ${r} ${t}`,
    jsonFields: (r, t) => ({ action: "retry_task", runId: r, taskId: t }),
  },
  resolve_task: {
    tier: "ordinary",
    requiresTask: true,
    cli: (r, t) => `duet resolve ${r} ${t}`,
    jsonFields: (r, t) => ({ action: "resolve_task", runId: r, taskId: t }),
  },
  cancel_run: {
    tier: "ordinary",
    requiresTask: false,
    cli: (r) => `duet cancel ${r}`,
    jsonFields: (r) => ({ action: "cancel_run", runId: r }),
  },
  cancel_task: {
    tier: "ordinary",
    requiresTask: true,
    cli: (r, t) => `duet cancel ${r} --task ${t}`,
    jsonFields: (r, t) => ({ action: "cancel_task", runId: r, taskId: t }),
  },
  cleanup_run: {
    tier: "ordinary",
    requiresTask: false,
    cli: (r) => `duet cleanup ${r}`,
    jsonFields: (r) => ({ action: "cleanup_run", runId: r }),
  },
  approve_plan: {
    tier: "fingerprint",
    requiresTask: false,
    cli: (r) => `duet approve ${r} --stage plan`,
    jsonFields: (r) => ({ action: "approve_plan", runId: r }),
  },
  approve_merge: {
    tier: "fingerprint",
    requiresTask: false,
    cli: (r) => `duet approve ${r} --stage merge`,
    jsonFields: (r) => ({ action: "approve_merge", runId: r }),
  },
  merge_run: {
    tier: "fingerprint",
    requiresTask: false,
    cli: (r) => `duet merge ${r}`,
    jsonFields: (r) => ({ action: "merge_run", runId: r }),
  },
};

const VALID_ACTIONS = new Set<string>(Object.keys(ACTION_SPECS));
const FENCE_OPEN = "```duet-proposal";
// Closing fence: ``` at line start, optional trailing spaces, then newline or end
const CLOSE_RE = /^```[ \t]*(\r?\n|$)/m;

export function parseProposalBlock(text: string): ParseResult {
  // Find all opening fences that start at a line boundary.
  let openCount = 0;
  let firstOpenIndex = -1;
  let searchPos = 0;

  while (searchPos < text.length) {
    const idx = text.indexOf(FENCE_OPEN, searchPos);
    if (idx === -1) break;
    // Must be at start of text or preceded by a newline character.
    if (idx > 0 && text[idx - 1] !== "\n" && text[idx - 1] !== "\r") {
      searchPos = idx + 1;
      continue;
    }
    openCount++;
    if (firstOpenIndex === -1) firstOpenIndex = idx;
    searchPos = idx + FENCE_OPEN.length;
  }

  if (openCount === 0) return { kind: "none" };
  if (openCount > 1) {
    return { kind: "invalid", reason: "duplicate duet-proposal blocks" };
  }

  // Walk past optional trailing spaces on the fence-open line, then expect \n.
  let pos = firstOpenIndex + FENCE_OPEN.length;
  while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) {
    pos++;
  }
  if (pos >= text.length || (text[pos] !== "\n" && text[pos] !== "\r")) {
    return { kind: "invalid", reason: "malformed fence opener" };
  }
  if (text[pos] === "\r") pos++; // handle \r\n
  pos++; // skip \n

  const afterOpen = text.slice(pos);
  const closeMatch = CLOSE_RE.exec(afterOpen);
  if (!closeMatch) {
    return { kind: "invalid", reason: "unclosed duet-proposal block" };
  }

  const blockContent = afterOpen.slice(0, closeMatch.index);
  const afterClose = afterOpen.slice(closeMatch.index + closeMatch[0].length);

  if (afterClose.trim().length > 0) {
    return { kind: "invalid", reason: "trailing content after proposal block" };
  }
  if (blockContent.includes("```")) {
    return { kind: "invalid", reason: "nested fences in proposal block" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(blockContent.trim());
  } catch {
    return { kind: "invalid", reason: "invalid JSON in proposal block" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "proposal must be a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const action = typeof obj.action === "string" ? obj.action : undefined;
  if (!action) {
    return { kind: "invalid", reason: "missing or non-string action" };
  }

  return {
    kind: "parsed",
    raw: {
      action,
      runId: typeof obj.runId === "string" ? obj.runId : undefined,
      taskId: typeof obj.taskId === "string" ? obj.taskId : undefined,
      rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
      // command, commandCli, cli, tier, commandJson are intentionally not extracted
    },
    strippedText: text.slice(0, firstOpenIndex).trimEnd(),
  };
}

/**
 * Validates run/task IDs against the Store and synthesizes server-built command
 * fields from the fixed per-action template. Returns null for any validation
 * failure - callers store plain chat when this returns null.
 */
export function tryValidateAndSynthesize(
  raw: RawProposal,
  conversation: ConversationRecord,
  store: Store,
): SynthesizedProposal | null {
  if (!VALID_ACTIONS.has(raw.action)) return null;
  const action = raw.action as ProposalAction;
  const spec = ACTION_SPECS[action];

  if (!raw.runId) return null;

  let runId: string;
  try {
    const run = store.getRun(raw.runId);
    runId = run.id;
  } catch {
    return null;
  }

  // For run-scoped conversations the proposal run must match.
  if (conversation.runId && conversation.runId !== runId) return null;

  let taskId: string | undefined;
  if (spec.requiresTask) {
    if (!raw.taskId) return null;
    const tasks = store.listTasks(runId);
    if (!tasks.some((t) => t.id === raw.taskId)) return null;
    taskId = raw.taskId;
  }

  const commandCli = spec.cli(runId, taskId);
  const commandJson = JSON.stringify(spec.jsonFields(runId, taskId));
  const summary = raw.rationale
    ? raw.rationale.slice(0, 500)
    : `Proposed: ${action}`;

  return {
    action,
    runId,
    taskId,
    commandCli,
    commandJson,
    tier: spec.tier,
    summary,
    expiresAt: new Date(Date.now() + PROPOSAL_EXPIRY_MS).toISOString(),
  };
}

export function prepareProposalAction(
  store: Store,
  conversationId: string,
  proposalId: string,
): PreparedProposalAction {
  const conversation = store.getConversation(conversationId);
  const proposal = store.getProposal(proposalId);
  if (proposal.conversationId !== conversationId) {
    throw new DuetError(
      `Proposal ${proposalId} is not in conversation ${conversationId}.`,
      "PROPOSAL_NOT_FOUND",
    );
  }
  const prepared = basePrepared(proposal);
  const now = Date.now();
  if (proposal.status !== "proposed" || Date.parse(proposal.expiresAt) <= now) {
    return unavailable(prepared, "This suggestion is no longer active.");
  }

  if (conversation.runId && proposal.runId !== conversation.runId) {
    return unavailable(prepared, "This suggestion no longer matches the conversation run.");
  }
  let run: RunRecord | undefined;
  if (proposal.runId) {
    try {
      run = store.getRun(proposal.runId);
      prepared.run = {
        id: run.id,
        status: run.status,
        version: run.version ?? 1,
      };
    } catch {
      return unavailable(prepared, "The linked run no longer exists.");
    }
  }

  if (proposal.taskId) {
    if (!proposal.runId) {
      return unavailable(prepared, "The linked task is missing its run.");
    }
    const task = store
      .listTasks(proposal.runId)
      .find((item) => item.id === proposal.taskId);
    if (!task) {
      return unavailable(prepared, "The linked task no longer exists.");
    }
    prepared.task = {
      id: task.id,
      status: task.status,
      version: task.version ?? 1,
    };
  }

  if (proposal.runId && runChangingAction(proposal.action)) {
    const active = store
      .listActiveOperations()
      .find((operation) => operation.runId === proposal.runId);
    if (active) {
      return unavailable(
        prepared,
        `Run ${proposal.runId} already has active operation ${active.id}.`,
      );
    }
  }

  return prepared;
}

export function startProposalAction(
  store: Store,
  conversationId: string,
  proposalId: string,
  input: StartProposalInput,
): StartProposalResult {
  if (input.confirm !== "start") {
    throw new DuetError(
      "Type start to confirm this proposal.",
      "INVALID_ARGUMENT",
    );
  }
  const conversation = store.getConversation(conversationId);
  const proposal = store.getProposal(proposalId);
  if (proposal.conversationId !== conversationId) {
    throw new DuetError(
      `Proposal ${proposalId} is not in conversation ${conversationId}.`,
      "PROPOSAL_NOT_FOUND",
    );
  }
  if (conversation.runId && proposal.runId !== conversation.runId) {
    throw new DuetError(
      "This suggestion no longer matches the conversation run.",
      "PROPOSAL_NOT_ACTIVE",
    );
  }
  if (proposal.status === "started") {
    throw new DuetError(
      `Proposal ${proposalId} has already been started.`,
      "PROPOSAL_ALREADY_STARTED",
    );
  }
  if (proposal.status !== "proposed" || Date.parse(proposal.expiresAt) <= Date.now()) {
    throw new DuetError(
      `Proposal ${proposalId} is no longer active.`,
      "PROPOSAL_NOT_ACTIVE",
    );
  }
  if (proposal.tier === "fingerprint") {
    throw new DuetError(
      "Fingerprint-gated proposals must be completed in the CLI.",
      "FINGERPRINT_PROPOSAL_CLI_ONLY",
    );
  }
  if (!proposal.runId) {
    throw new DuetError("Proposal is missing a run.", "INVALID_PROPOSAL");
  }
  const run = store.getRun(proposal.runId);
  const expectedRunVersion = Number(input.expectedRunVersion);
  if (!Number.isInteger(expectedRunVersion)) {
    throw new DuetError(
      "expectedRunVersion is required.",
      "INVALID_ARGUMENT",
    );
  }
  if ((run.version ?? 1) !== expectedRunVersion) {
    throw new DuetError("Run version changed.", "VERSION_CONFLICT");
  }
  const task = proposal.taskId
    ? store.listTasks(proposal.runId).find((item) => item.id === proposal.taskId)
    : undefined;
  if (proposal.taskId && !task) {
    throw new DuetError("The linked task no longer exists.", "TASK_NOT_FOUND");
  }
  if (task) {
    const expectedTaskVersion = Number(input.expectedTaskVersion);
    if (!Number.isInteger(expectedTaskVersion)) {
      throw new DuetError(
        "expectedTaskVersion is required.",
        "INVALID_ARGUMENT",
      );
    }
    if ((task.version ?? 1) !== expectedTaskVersion) {
      throw new DuetError("Task version changed.", "VERSION_CONFLICT");
    }
  }
  const active = store
    .listActiveOperations()
    .find((operation) => operation.runId === proposal.runId);
  if (active) {
    throw new DuetError(
      `Run ${proposal.runId} already has active operation ${active.id}.`,
      "RUN_ACTIVITY_ACTIVE",
    );
  }
  return {
    proposal,
    command: commandForProposal(proposal),
  };
}

function basePrepared(proposal: ManagerActionProposal): PreparedProposalAction {
  const requirements =
    proposal.tier === "fingerprint"
      ? [
          "Run the copied command in your terminal.",
          "Duet will print a fingerprint and require typed confirmation.",
          "The dashboard cannot create action tickets or consume approvals.",
        ]
      : [
          "Run the copied command in your terminal.",
          "The CLI will re-check run and task state before doing anything.",
          "The dashboard is showing a suggestion only.",
        ];
  const warnings =
    proposal.tier === "fingerprint"
      ? ["Fingerprint-gated actions remain CLI-only."]
      : ["This readiness check does not reserve or start work."];
  return {
    proposalId: proposal.id,
    action: proposal.action,
    tier: proposal.tier,
    runId: proposal.runId,
    taskId: proposal.taskId,
    commandCli: proposal.commandCli,
    available: true,
    requirements,
    warnings,
  };
}

function unavailable(
  prepared: PreparedProposalAction,
  blockedReason: string,
): PreparedProposalAction {
  return {
    ...prepared,
    available: false,
    blockedReason,
    warnings: [...prepared.warnings, blockedReason],
  };
}

function runChangingAction(action: ProposalAction): boolean {
  switch (action) {
    case "execute_run":
    case "resume_run":
    case "retry_task":
    case "resolve_task":
    case "cleanup_run":
    case "merge_run":
      return true;
    default:
      return false;
  }
}

function commandForProposal(proposal: ManagerActionProposal): LongRunningCommand {
  if (!proposal.runId) {
    throw new DuetError("Proposal is missing a run.", "INVALID_PROPOSAL");
  }
  switch (proposal.action) {
    case "execute_run":
      return { kind: "execute", runId: proposal.runId };
    case "resume_run":
      return { kind: "resume", runId: proposal.runId };
    case "retry_task":
      if (!proposal.taskId) {
        throw new DuetError("Retry proposal is missing a task.", "INVALID_PROPOSAL");
      }
      return { kind: "retry", runId: proposal.runId, taskId: proposal.taskId };
    case "resolve_task":
      if (!proposal.taskId) {
        throw new DuetError("Resolve proposal is missing a task.", "INVALID_PROPOSAL");
      }
      return { kind: "resolve", runId: proposal.runId, taskId: proposal.taskId };
    case "cancel_run":
      return { kind: "cancel", runId: proposal.runId };
    case "cancel_task":
      if (!proposal.taskId) {
        throw new DuetError("Cancel proposal is missing a task.", "INVALID_PROPOSAL");
      }
      return { kind: "cancel", runId: proposal.runId, taskId: proposal.taskId };
    case "cleanup_run":
      return { kind: "cleanup", runId: proposal.runId };
    case "approve_plan":
    case "approve_merge":
    case "merge_run":
      throw new DuetError(
        "Fingerprint-gated proposals must be completed in the CLI.",
        "FINGERPRINT_PROPOSAL_CLI_ONLY",
      );
  }
}
