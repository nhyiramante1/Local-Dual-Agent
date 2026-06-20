import type {
  ConversationRecord,
  ProposalAction,
  ProposalTier,
} from "../core/domain.js";
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
