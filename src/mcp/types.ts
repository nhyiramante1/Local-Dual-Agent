import type {
  ArtifactRecord,
  DuetEvent,
  OperationRecord,
  RunRecord,
  RunStatus,
} from "../core/domain.js";

export const duetToolNames = [
  "duet_list_runs",
  "duet_get_run",
  "duet_get_events",
  "duet_get_operation",
  "duet_read_artifact",
  "duet_create_plan",
] as const;

export type DuetToolName = (typeof duetToolNames)[number];

export type RunSection =
  | "tasks"
  | "usage"
  | "approvals"
  | "leases"
  | "messages"
  | "verification"
  | "artifacts"
  | "conflicts"
  | "diff";

export interface DuetApi {
  get<T>(route: string): Promise<T>;
  post<T>(
    route: string,
    body: unknown,
    options?: { unique?: boolean; idempotencyKey?: string },
  ): Promise<T>;
  readArtifact(
    artifactId: number,
    offset: number,
    maximumLength: number,
  ): Promise<{
    content: string;
    offset: number;
    nextOffset: number;
    totalLength: number;
    truncated: boolean;
  }>;
}

export interface RunListResult {
  runs: Array<Pick<
    RunRecord,
    | "id"
    | "goal"
    | "status"
    | "leadProvider"
    | "repoRoot"
    | "createdAt"
    | "updatedAt"
  >>;
  count: number;
  truncated: boolean;
  status?: RunStatus;
}

export interface EventsResult {
  events: DuetEvent[];
  newestSeq: number;
  count: number;
  truncated: boolean;
}

export interface ArtifactReadResult {
  artifactId: number;
  content: string;
  offset: number;
  nextOffset: number;
  totalLength: number;
  truncated: boolean;
}

export interface OperationResult {
  operation: Omit<OperationRecord, "resultJson" | "errorJson">;
  result?: unknown;
  error?: unknown;
  resultTruncated: boolean;
}

export interface RunArtifactsResult {
  artifacts: ArtifactRecord[];
  truncated: boolean;
}
