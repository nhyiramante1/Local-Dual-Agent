import type { ProviderName } from "../core/domain.js";
import type { ProviderAdapter } from "./adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";

export function providerAdapter(name: ProviderName): ProviderAdapter {
  return name === "claude" ? new ClaudeAdapter() : new CodexAdapter();
}
