export type ProviderName = "claude" | "codex";

// Claude/Codex are fixed worker-backed managers. Other manager identities are
// OpenAI-compatible profiles served through OpenAIManagerAdapter.
export type ManagerProviderName = ProviderName | (string & {});

// OpenAI-compatible manager identities share the native tool-call runtime and
// the same budget bucket; the only difference is the configured model/baseURL.
export function isOpenAiCompatibleManager(
  provider: ManagerProviderName,
): boolean {
  return provider !== "claude" && provider !== "codex";
}

export type AgentProfile = "cheap" | "balanced" | "reasoning" | "max";

export interface AliasRecord {
  repoPath: string;
  lead?: ProviderName;
  profile?: AgentProfile;
  description?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export type RunStatus =
  | "planning"
  | "awaiting_plan_approval"
  | "approved"
  | "running"
  | "paused_budget"
  | "integration_conflict"
  | "awaiting_merge_approval"
  | "merge_approved"
  | "merged"
  | "needs_attention"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "leased"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "revising"
  | "completed"
  | "integrated"
  | "failed"
  | "cancelled"
  | "conflict";

export interface TaskPlan {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  dependencies: string[];
  preferredProvider?: ProviderName;
  syntheticDependencies?: string[];
}

export interface RunPlan {
  summary: string;
  tasks: TaskPlan[];
  risks: string[];
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low";
  file?: string;
  description: string;
  required: boolean;
}

export interface ReviewResult {
  verdict: "approve" | "request_changes";
  summary: string;
  findings: ReviewFinding[];
}

export interface UsageRecord {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  costUsd?: number;
  costKnown?: boolean;
}

export interface AgentResult {
  provider: ManagerProviderName;
  sessionId: string;
  finalText: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  usage: UsageRecord;
  model?: string;
  toolCalls?: ManagerToolCall[];
}

export interface ReviewedArtifact {
  treeId: string;
  diffHash: string;
  diff: string;
  changedPaths: string[];
}

export interface RunRecord {
  id: string;
  repoPath: string;
  repoRoot: string;
  goal: string;
  status: RunStatus;
  leadProvider: ProviderName;
  baseBranch: string;
  baseCommit: string;
  integrationBranch: string;
  integrationWorktreePath?: string;
  plan?: RunPlan;
  finalCommit?: string;
  error?: string;
  configJson: string;
  profile?: AgentProfile;
  cancellationRequested: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  runId: string;
  id: string;
  ordinal: number;
  plan: TaskPlan;
  status: TaskStatus;
  provider: ProviderName;
  reviewerProvider: ProviderName;
  baseCommit?: string;
  branch?: string;
  worktreePath?: string;
  sessionId?: string;
  revisionCount: number;
  review?: ReviewResult;
  reviewedArtifact?: ReviewedArtifact;
  taskCommit?: string;
  integratedCommit?: string;
  error?: string;
  cancellationRequested: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export type OperationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface OperationRecord {
  id: string;
  runId?: string;
  kind: string;
  status: OperationStatus;
  serviceInstanceId: string;
  inputHash: string;
  resultJson?: string;
  errorJson?: string;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export type ConversationStatus = "active" | "archived";

export interface ConversationRecord {
  id: string;
  runId?: string;
  interfaceAgent: ManagerProviderName;
  title?: string;
  summary?: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export type TurnRole = "user" | "manager" | "system";
export type TurnStatus = "ok" | "failed";

export interface ConversationTurnRecord {
  id: string;
  conversationId: string;
  seq: number;
  role: TurnRole;
  interfaceAgent?: ManagerProviderName;
  content: string;
  status: TurnStatus;
  errorJson?: string;
  providerSessionId?: string;
  usageJson?: string;
  operationId?: string;
  truncated: boolean;
  originalLength?: number;
  createdAt: string;
}

export type ManagerSharedContextKind = "note" | "provider_health" | "handoff";

export interface ManagerSharedContextRecord {
  id: string;
  runId?: string;
  kind: ManagerSharedContextKind;
  provider?: ManagerProviderName;
  conversationId?: string;
  turnId?: string;
  content: string;
  metadataJson?: string;
  expiresAt?: string;
  createdAt: string;
}

export type ProposalAction =
  | "create_plan"
  | "set_strategy"
  | "set_alias"
  | "agent_consultation"
  | "execute_run"
  | "resume_run"
  | "retry_task"
  | "resolve_task"
  | "cancel_run"
  | "cancel_task"
  | "cleanup_run"
  | "approve_plan"
  | "approve_merge"
  | "merge_run";

export type ProposalTier = "ordinary" | "fingerprint";
export type ProposalStatus = "proposed" | "dismissed" | "expired" | "started";

export interface ManagerActionProposal {
  id: string;
  conversationId: string;
  turnId: string;
  runId?: string;
  taskId?: string;
  action: ProposalAction;
  summary: string;
  commandCli: string;
  commandJson: string;
  tier: ProposalTier;
  status: ProposalStatus;
  operationId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DuetEvent {
  seq: number;
  id: string;
  type: string;
  severity: "debug" | "info" | "warning" | "error";
  runId?: string;
  taskId?: string;
  operationId?: string;
  occurredAt: string;
  payload: unknown;
}

export type ManagerToolArgumentSchema = Record<string, unknown>;

export interface ManagerToolDefinition {
  name: string;
  description: string;
  parameters: ManagerToolArgumentSchema;
}

export interface ManagerToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ArtifactRecord {
  id: number;
  runId: string;
  taskId?: string;
  kind: string;
  content?: string;
  sha256?: string;
  createdAt: string;
}

export interface LeaseRecord {
  resourceType: "run" | "task" | "worktree" | "integration";
  resourceId: string;
  owner: string;
  expiresAt: string;
  heartbeatAt: string;
}

export interface RepositorySnapshot {
  root: string;
  branch: string;
  head: string;
  clean: boolean;
  statusText: string;
  remoteUrl?: string;
}

export interface RepositoryFingerprint {
  head: string;
  indexTree: string;
  trackedDiffHash: string;
  untracked: string[];
  ignored: string[];
}

export interface VerificationResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

export interface UsageSummary {
  claude: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costKnown: boolean;
    turns: number;
    durationMs: number;
  };
  codex: {
    inputTokens: number;
    outputTokens: number;
    costUsd: null;
    costKnown: false;
    turns: number;
    durationMs: number;
  };
  totalTurns: number;
  totalDurationMs: number;
}


export interface ManagerBudget {
  claudeMaxUsdPerTurn: number;
  claudeMaxUsdPerDay: number;
  codexMaxInputTokensPerDay: number;
  codexMaxOutputTokensPerDay: number;
  codexMaxRuntimeSeconds: number;
  maxTurnsPerDay: number;
  openaiMaxUsdPerTurn: number;
  openaiMaxUsdPerDay: number;
}
