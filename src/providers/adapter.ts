import type { AgentProfile, AgentResult, ManagerProviderName, ProviderName } from "../core/domain.js";
import type { ManagerToolCall, ManagerToolDefinition } from "../core/domain.js";

export type AgentMode = "read-only" | "workspace-write";

// One prior step in a native tool loop, replayed back to the model so it can
// chain tools with real assistant/tool messages instead of text-appended JSON.
// Only OpenAI-compatible adapters consume this; Claude/Codex ignore it.
export interface AgentToolStep {
  // The assistant message that requested these tool calls.
  assistantToolCalls: ManagerToolCall[];
  // The result for each requested call (matched to assistantToolCalls by id).
  results: { toolCallId: string; name: string; resultJson: string }[];
  // Any plain assistant text emitted alongside the tool calls.
  assistantText?: string;
}

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
  // Prior tool-loop steps (oldest first) to replay before this turn's prompt.
  priorSteps?: AgentToolStep[];
}

export interface ProviderAdapter {
  readonly name: ManagerProviderName;
  readonly supportsNativeToolCalling?: boolean;
  run(turn: AgentTurn): Promise<AgentResult>;
}

export type { ManagerToolCall, ManagerToolDefinition };
