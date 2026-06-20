import type { AgentProfile, AgentResult, ProviderName } from "../core/domain.js";

export type AgentMode = "read-only" | "workspace-write";

export interface AgentTurn {
  cwd: string;
  prompt: string;
  mode: AgentMode;
  timeoutMs: number;
  maxBudgetUsd?: number;
  profile?: AgentProfile;
  sessionId?: string;
  onStart?: (pid: number) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onHeartbeat?: (pid: number) => void;
  shouldCancel?: () => boolean;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  run(turn: AgentTurn): Promise<AgentResult>;
}
