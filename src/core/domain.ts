export type ProviderName = "claude" | "codex";

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
  provider: ProviderName;
  sessionId: string;
  finalText: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  usage: UsageRecord;
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
