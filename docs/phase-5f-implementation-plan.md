# Phase 5F Implementation Plan: OpenAI Manager Lane

## Context

The updated handoff (`docs/future-agent-handoff.md`) defines Phase 5F as adding OpenAI/ChatGPT as a first-class manager provider so dashboard chat does not consume Claude or Codex worker quota. The architecture already has clean injection points — `ServerOptions.chatProviders` and `ConversationRecord.interfaceAgent` — and the handoff explicitly warns against browser automation; only the OpenAI HTTP API (via the `openai` npm package) is in scope.

**Branch to develop on:** `feature/phase-5f-openai-manager` from updated remote `main`.

---

## Current State (after Phase 5E)

- `ProviderName = "claude" | "codex"` — worker providers only
- `ChatProviders = Record<ProviderName, ProviderAdapter>` — requires both keys
- `ConversationRecord.interfaceAgent: ProviderName` — locked to "claude" | "codex"
- `ProviderAdapter.name: ProviderName` — no "openai" allowed
- `ManagerBudget` in `src/core/domain.ts` — has claude/codex fields only
- `DuetConfig.manager` in `src/config.ts` — has budget fields, no `provider` field
- `openai` npm package is NOT yet a dependency (only `@openai/codex` which is the Codex CLI wrapper)

---

## Key Files

| File | Role |
|---|---|
| `src/core/domain.ts` | `ProviderName`, `ConversationRecord.interfaceAgent`, `ManagerBudget` |
| `src/providers/adapter.ts` | `ProviderAdapter` interface and `AgentTurn` struct |
| `src/chat/engine.ts` | `ChatProviders` type, `assertBudget()`, `runManagerTurn()` |
| `src/service/server.ts` | Constructs `chatProviders` and `ChatEngine`; `ServerOptions` |
| `src/config.ts` | `DuetConfig.manager`, `loadConfig()`, `resolveManagerBudget()` |
| `src/persistence/store.ts` | `sumManagerUsage()` — already dynamic by provider name |
| `src/duetd.ts` | Wires config → DuetService at startup |
| `duet.example.toml` | Documents new `[manager] provider` field |

---

## Change 1 — `src/core/domain.ts`: Add `ManagerProviderName`

Add a new exported union that is a superset of `ProviderName`:

```typescript
export type ManagerProviderName = ProviderName | "openai";
```

Change `ConversationRecord.interfaceAgent` from `ProviderName` to `ManagerProviderName`. No DB schema migration needed — the column is TEXT with no CHECK constraint; "openai" is already a valid row value.

Extend `ManagerBudget` with two new fields:

```typescript
export interface ManagerBudget {
  // existing fields unchanged
  claudeMaxUsdPerTurn: number;
  claudeMaxUsdPerDay: number;
  codexMaxInputTokensPerDay: number;
  codexMaxOutputTokensPerDay: number;
  codexMaxRuntimeSeconds: number;
  maxTurnsPerDay: number;
  // new fields for OpenAI
  openaiMaxUsdPerTurn: number;
  openaiMaxUsdPerDay: number;
}
```

---

## Change 2 — `src/providers/openai-manager.ts` (new file)

Create a minimal manager adapter backed by the OpenAI chat completions API. Does not inherit worker-specific concerns (workspace mode, session resumption, profile-to-model mapping).

```typescript
import OpenAI from "openai";
import type { AgentResult, AgentTurn } from "../core/domain.js";
import type { ProviderAdapter } from "./adapter.js";

const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAIManagerAdapter implements ProviderAdapter {
  readonly name = "openai" as const;   // informational; cast — see Change 3
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const start = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: turn.prompt }],
    });
    const choice = completion.choices[0];
    const usage = completion.usage;
    return {
      provider: "openai",        // stored in DB as string; cast from ManagerProviderName
      sessionId: completion.id,
      finalText: choice?.message.content ?? "",
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        costKnown: false,        // avoid hardcoding per-model pricing; track tokens only
        costUsd: null,
      },
    };
  }
}
```

---

## Change 3 — `src/providers/adapter.ts`: Widen `name` field

Change:
```typescript
export interface ProviderAdapter {
  readonly name: ProviderName;
  run(turn: AgentTurn): Promise<AgentResult>;
}
```
To:
```typescript
export interface ProviderAdapter {
  readonly name: ProviderName | "openai";   // extensible for manager providers
  run(turn: AgentTurn): Promise<AgentResult>;
}
```

This is the minimal safe widening — keeps the type explicit rather than opening it to arbitrary strings. If a future provider is added, extend this union.

---

## Change 4 — `src/chat/engine.ts`: Support OpenAI in `ChatProviders` and `assertBudget`

### 4a. Widen `ChatProviders` type

Change:
```typescript
export type ChatProviders = Record<ProviderName, ProviderAdapter>;
```
To:
```typescript
export type ChatProviders = Record<ProviderName, ProviderAdapter> & {
  openai?: ProviderAdapter;
};
```

This preserves the requirement that claude and codex are always present (required by worker paths) while making openai optional for manager-only use.

### 4b. Update `assertBudget`

```typescript
assertBudget(provider: ManagerProviderName): void {
  const since = oneDayAgo();
  const reservedTurns = this.store.countActiveManagerTurns();
  if (this.store.countManagerTurns(since) + reservedTurns > this.budget.maxTurnsPerDay) {
    throw new DuetError("Daily manager-chat turn limit reached.", "BUDGET_EXCEEDED");
  }
  if (provider === "claude") {
    const usage = this.store.sumManagerUsage("claude", since);
    if (usage.costUsd >= this.budget.claudeMaxUsdPerDay) {
      throw new DuetError("Daily Claude manager-chat budget reached.", "BUDGET_EXCEEDED");
    }
  } else if (provider === "openai") {
    // OpenAI: token-based gate only (costKnown: false — no per-model price hardcoded)
    // USD gate deferred until cost tracking is added; turn-limit check above covers it
  } else {
    // codex: token-based gate
    const usage = this.store.sumManagerUsage("codex", since);
    if (
      usage.inputTokens >= this.budget.codexMaxInputTokensPerDay ||
      usage.outputTokens >= this.budget.codexMaxOutputTokensPerDay
    ) {
      throw new DuetError("Daily Codex manager-chat token budget reached.", "BUDGET_EXCEEDED");
    }
  }
}
```

### 4c. Update `runManagerTurn` — handle optional openai adapter

Replace:
```typescript
const adapter = this.providers[provider];
```
With:
```typescript
const adapter =
  this.providers[provider as ProviderName] ??
  (provider === "openai" ? this.providers.openai : undefined);
if (!adapter) {
  throw new DuetError(
    `Manager provider "${provider}" is not configured.`,
    "CONFIGURATION_ERROR",
  );
}
```

Also update the `maxBudgetUsd` and `timeoutMs` logic:
```typescript
maxBudgetUsd:
  provider === "claude" ? this.budget.claudeMaxUsdPerTurn
  : provider === "openai" ? this.budget.openaiMaxUsdPerTurn
  : undefined,
timeoutMs: (provider === "codex" ? this.budget.codexMaxRuntimeSeconds : 60) * 1_000,
```

---

## Change 5 — `src/config.ts`: Add `[manager] provider` field

### 5a. Extend `DuetConfig.manager`

```typescript
manager: {
  // existing budget fields unchanged
  provider: ManagerProviderName;
  openaiModel: string;
  openaiMaxUsdPerTurn: number;
  openaiMaxUsdPerDay: number;
};
```

### 5b. Extend `defaultConfig.manager`

```typescript
manager: {
  // existing defaults unchanged
  provider: "codex" as ManagerProviderName,  // safe default when no API key configured
  openaiModel: "gpt-4o-mini",
  openaiMaxUsdPerTurn: 0.1,
  openaiMaxUsdPerDay: 2.0,
},
```

### 5c. Parse in `loadConfig()`

```typescript
const VALID_MANAGER_PROVIDERS = new Set<string>(["claude", "codex", "openai"]);

// In the manager block:
provider: VALID_MANAGER_PROVIDERS.has(manager.provider as string)
  ? (manager.provider as ManagerProviderName)
  : defaultConfig.manager.provider,
openaiModel: typeof manager.openai_model === "string"
  ? manager.openai_model
  : defaultConfig.manager.openaiModel,
openaiMaxUsdPerTurn: numberInRange(
  manager.openai_max_usd_per_turn,
  defaultConfig.manager.openaiMaxUsdPerTurn,
  0.01,
),
openaiMaxUsdPerDay: numberInRange(
  manager.openai_max_usd_per_day,
  defaultConfig.manager.openaiMaxUsdPerDay,
  0.01,
),
```

### 5d. Update `resolveManagerBudget()`

Extend to include the two new OpenAI fields from the config:
```typescript
export function resolveManagerBudget(config: DuetConfig): ManagerBudget {
  return {
    ...config.manager,
    // openaiMaxUsdPerTurn and openaiMaxUsdPerDay already in config.manager
  };
}
```

---

## Change 6 — `src/duetd.ts`: Wire OpenAI adapter at startup

```typescript
import { OpenAIManagerAdapter } from "./providers/openai-manager.js";

// Inside main():
const config = await loadConfig();
const managerBudget = resolveManagerBudget(config);

const chatProviders: ChatProviders = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
};

const openaiKey = process.env.OPENAI_API_KEY;
if (config.manager.provider === "openai") {
  if (openaiKey) {
    (chatProviders as ChatProviders & { openai: ProviderAdapter }).openai =
      new OpenAIManagerAdapter(openaiKey, config.manager.openaiModel);
  } else {
    await serviceLog("warning", "manager provider is openai but OPENAI_API_KEY is not set; falling back to codex", {});
  }
}

service = new DuetService({ store, secret, instanceId, managerBudget, chatProviders, ... });
```

---

## Change 7 — `src/service/server.ts`: Default new conversations to configured provider

Add `managerProvider?: ManagerProviderName` to `ServerOptions`. In `duetd.ts`, pass `config.manager.provider`. In the POST `/chat/conversations` handler, use it as the default `interfaceAgent`:

```typescript
const interfaceAgent =
  (body.interfaceAgent as ManagerProviderName | undefined) ??
  this.managerProvider ??
  "codex";
```

---

## Change 8 — `npm install openai`

Run `npm install openai` to add the official OpenAI Node.js SDK as a production dependency. Do not add `@types/openai` — the package ships its own types.

---

## Change 9 — `duet.example.toml`: Document new `[manager]` fields

Append to the existing `[manager]` section:

```toml
[manager]
# Which provider voices the manager: openai | claude | codex.
# Set to "openai" and export OPENAI_API_KEY to avoid consuming Claude/Codex worker quota.
provider = "openai"
# OpenAI model used when provider = "openai".
openai_model = "gpt-4o-mini"
# Per-turn and daily OpenAI spend caps (USD).
openai_max_usd_per_turn = 0.10
openai_max_usd_per_day = 2.0
# ... existing budget fields unchanged ...
```

---

## Change 10 — Tests

### 10a. Extend `tests/config.test.ts`

- Assert `provider = "openai"` in TOML is parsed into `config.manager.provider`.
- Assert unrecognised provider value falls back to `"codex"`.
- Assert `openai_model` is parsed correctly.
- Assert `openai_max_usd_per_turn` below minimum is rejected.

### 10b. `tests/chat-service.test.ts`: OpenAI provider mock — happy path

Create a mock `ProviderAdapter` with `name: "openai"`. Inject it in `chatProviders` alongside claude and codex. Create a conversation with `interfaceAgent: "openai"`. POST a manager turn. Assert 202 and that the stored turn reply matches the mock output.

### 10c. `tests/chat-service.test.ts`: Missing OpenAI adapter throws

Create a conversation with `interfaceAgent: "openai"` when `chatProviders` has no `openai` key. Assert the engine throws `CONFIGURATION_ERROR` (HTTP 500 or appropriate error code from the service).

---

## Files Modified

| File | Nature of change |
|---|---|
| `src/core/domain.ts` | Add `ManagerProviderName`; extend `ManagerBudget`; update `ConversationRecord.interfaceAgent` |
| `src/providers/adapter.ts` | Widen `ProviderAdapter.name` to include `"openai"` |
| `src/providers/openai-manager.ts` | **New file**: `OpenAIManagerAdapter` using `openai` SDK |
| `src/chat/engine.ts` | Widen `ChatProviders`; update `assertBudget`; update adapter lookup in `runManagerTurn` |
| `src/config.ts` | Add `provider`, `openaiModel`, `openaiMaxUsdPerTurn`, `openaiMaxUsdPerDay` to manager section |
| `src/duetd.ts` | Conditionally instantiate `OpenAIManagerAdapter`; pass `managerProvider` |
| `src/service/server.ts` | Accept `managerProvider` in `ServerOptions`; default new conversations to it |
| `duet.example.toml` | Add `provider`, `openai_model`, `openai_max_usd_per_turn`, `openai_max_usd_per_day` |
| `package.json` / `package-lock.json` | Add `openai` production dependency |
| `tests/config.test.ts` | 3–4 new tests for OpenAI manager config parsing |
| `tests/chat-service.test.ts` | 2 new integration tests (mock OpenAI happy path + missing adapter error) |

**No dashboard changes. No new API endpoints. No SQL schema migrations** (`interface_agent` column is TEXT with no CHECK constraint; "openai" is already a valid value).

---

## Verification

```bash
npm install                   # pick up the openai package
npm run check                 # no new TS errors
npm test                      # all existing tests + new OpenAI tests pass
npm run build                 # build succeeds
git diff --check              # no whitespace errors
```

Manual smoke: export `OPENAI_API_KEY`, set `[manager] provider = "openai"` in `duet.toml`, start `duetd`, open dashboard, send a global chat message, confirm the reply comes from GPT (check `duetd` logs for `provider: "openai"` in turn records).
