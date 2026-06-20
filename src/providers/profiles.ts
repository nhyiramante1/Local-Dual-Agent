import type { AgentProfile } from "../core/domain.js";

export const CLAUDE_MODELS: Record<AgentProfile, string | undefined> = {
  cheap: "claude-haiku-4-5-20251001",
  balanced: undefined,
  reasoning: "claude-opus-4-8",
  max: "claude-opus-4-8",
};

// Effort passed via --effort to claude CLI (low|medium|high|xhigh|max).
// undefined means use the CLI default for that model.
export const CLAUDE_EFFORT: Record<AgentProfile, string | undefined> = {
  cheap: "low",
  balanced: undefined,
  reasoning: "high",
  max: "max",
};

export const CODEX_MODELS: Record<AgentProfile, string | undefined> = {
  cheap: "gpt-5.4-mini",
  balanced: undefined,
  reasoning: undefined,
  max: undefined,
};

// Reasoning effort passed via --reasoning-effort to codex CLI (low|medium|high).
// undefined means use the CLI default.
export const CODEX_EFFORT: Record<AgentProfile, string | undefined> = {
  cheap: "low",
  balanced: undefined,
  reasoning: "high",
  max: "high",
};
