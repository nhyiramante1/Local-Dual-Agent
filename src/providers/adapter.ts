import type { AgentProfile, AgentResult, ManagerProviderName, ProviderName } from "../core/domain.js";
import type { ManagerToolCall, ManagerToolDefinition } from "../core/domain.js";

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
  tools?: ManagerToolDefinition[];
}

export interface ProviderAdapter {
  readonly name: ManagerProviderName;
  readonly supportsNativeToolCalling?: boolean;
  run(turn: AgentTurn): Promise<AgentResult>;
}

export type { ManagerToolCall, ManagerToolDefinition };
