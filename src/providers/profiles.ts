import type { AgentProfile } from "../core/domain.js";

export const CLAUDE_MODELS: Record<AgentProfile, string | undefined> = {
  cheap: "claude-haiku-4-5-20251001",
  balanced: undefined,
  reasoning: "claude-opus-4-8",
  max: "claude-opus-4-8",
};

export const CODEX_MODELS: Record<AgentProfile, string | undefined> = {
  cheap: "codex-mini-latest",
  balanced: undefined,
  reasoning: undefined,
  max: undefined,
};
