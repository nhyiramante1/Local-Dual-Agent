import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { AgentResult, ManagerToolDefinition } from "../core/domain.js";
import type { ManagerProviderName } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import type { AgentToolStep, AgentTurn, ProviderAdapter } from "./adapter.js";

const DEFAULT_MODEL = "gpt-4o-mini";

// Best-effort extraction of how long until the rate limit clears, from either a
// retry-after header or a retryDelay hint Gemini embeds in the error body.
function retryAfterSeconds(error: unknown): number | undefined {
  const err = error as {
    headers?: unknown;
    response?: { headers?: unknown };
    error?: unknown;
    body?: unknown;
    message?: string;
  };
  const headers = err?.headers ?? err?.response?.headers;
  let raw: unknown;
  if (headers && typeof headers === "object") {
    raw =
      typeof (headers as { get?: unknown }).get === "function"
        ? (headers as { get(name: string): string | null }).get("retry-after")
          ?? (headers as { get(name: string): string | null }).get("Retry-After")
        : (headers as Record<string, unknown>)["retry-after"]
          ?? (headers as Record<string, unknown>)["Retry-After"];
  }
  const headerSeconds = raw != null ? parseInt(String(raw), 10) : NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds;
  if (raw) {
    const retryDateMs = Date.parse(String(raw));
    if (Number.isFinite(retryDateMs)) {
      const seconds = Math.ceil((retryDateMs - Date.now()) / 1000);
      if (seconds > 0) return seconds;
    }
  }
  const body = [err?.error, err?.body, err?.message]
    .filter(Boolean)
    .map((part) => typeof part === "string" ? part : JSON.stringify(part))
    .join(" ");
  const match = /retryDelay"?\s*[:=]\s*"?(\d+)\s*s/i.exec(body) ?? /try again in\s+(\d+)/i.exec(body);
  return match ? parseInt(match[1], 10) : undefined;
}

function errorBody(error: unknown): string {
  const err = error as { error?: unknown; body?: unknown; message?: string };
  return [err?.error, err?.body, err?.message]
    .filter(Boolean)
    .map((part) => typeof part === "string" ? part : JSON.stringify(part))
    .join(" ");
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: number })?.status;
  return typeof status === "number" ? status : undefined;
}

function isRateLimit(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429) return true;
  const body = errorBody(error);
  if (/\b429\b|rate limit|too many requests|resource_exhausted|tokens per minute|requests per minute|\bTPM\b|\bRPM\b/i.test(body)) {
    return true;
  }
  return (
    (status === 403 || status === 413 || status === 429 || status === undefined) &&
    /(?:quota|tokens?|requests?)\s+(?:exceeded|exhausted)|exceeded\s+(?:your\s+)?(?:current\s+)?quota|limit[:\s]|request too large/i.test(body)
  );
}

function isContextLimit(error: unknown): boolean {
  const status = errorStatus(error);
  const body = errorBody(error);
  return (
    status === 413 ||
    /request too large|reduce your message size/i.test(body) ||
    (
      /tokens per minute|\bTPM\b/i.test(body) &&
      /limit\s+[\d,]+/i.test(body) &&
      /requested\s+[\d,]+/i.test(body)
    )
  );
}

function contextLimitMessage(error: unknown): string {
  const detail = errorBody(error).replace(/\s+/g, " ").trim().slice(0, 700);
  return detail
    ? `The manager provider hit a context limit: ${detail}`
    : "The manager provider hit a context limit. Reduce the manager context or switch managers.";
}

// A 429/402/403 whose body is about money, not pace: depleted credits or
// unconfigured billing. Distinct from a transient rate limit — retrying "in a
// moment" will not help, so it must not be messaged as one.
function isBillingExhausted(error: unknown): boolean {
  const status = errorStatus(error);
  const body = errorBody(error);
  return (
    (status === 429 || status === 402 || status === 403 || status === undefined) &&
    /\bcredits?\b|\bbilling\b|\bprepay(?:ment)?\b|depleted|\bpayment\b|insufficient\s+(?:funds|balance|credits?)|top\s*up/i.test(body)
  );
}

function isToolCallGenerationFailure(error: unknown): boolean {
  const status = errorStatus(error);
  const body = errorBody(error);
  return (
    status === 400 &&
    /failed_generation|failed to call a function|tool call|function call/i.test(body)
  );
}

function isProviderConfigurationError(error: unknown): boolean {
  const status = errorStatus(error);
  const body = errorBody(error);
  return (
    status === 400 || status === 401 || status === 403 || status === 404
  ) && /api key|unauthorized|permission|forbidden|billing|model.*(?:not found|unsupported|unavailable|does not exist)|base url|invalid.*model|not supported/i.test(body);
}

// Gemini's OpenAI-compatible API rejects additionalProperties and several
// draft-07 keywords (minLength, maxLength, minimum, maximum, minItems, maxItems).
// Groq's llama models also choke on some of these in complex schemas.
// Strip them to a universally-supported subset before sending.
function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const STRIP = new Set([
    "additionalProperties",
    "minLength", "maxLength",
    "minimum", "maximum",
    "minItems", "maxItems",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (STRIP.has(key)) continue;
    if (key === "properties" && val && typeof val === "object") {
      const props: Record<string, unknown> = {};
      for (const [prop, propSchema] of Object.entries(val as Record<string, unknown>)) {
        props[prop] = sanitizeSchema(propSchema as Record<string, unknown>);
      }
      out[key] = props;
    } else if (key === "items" && val && typeof val === "object") {
      out[key] = sanitizeSchema(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

// Replay prior tool-loop steps as real assistant(tool_calls) + tool messages so
// the model sees correct conversation state on each iteration. Far more reliable
// than appending tool-result JSON into the system prompt.
function replaySteps(steps: AgentToolStep[]): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  for (const step of steps) {
    messages.push({
      role: "assistant",
      content: step.assistantText ?? "",
      tool_calls: step.assistantToolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    });
    for (const result of step.results) {
      messages.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: result.resultJson,
      });
    }
  }
  return messages;
}

function serializeTools(tools: ManagerToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeSchema(tool.parameters as Record<string, unknown>),
    },
  }));
}

export class OpenAIManagerAdapter implements ProviderAdapter {
  readonly name: ManagerProviderName;
  readonly supportsNativeToolCalling = true;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL, baseURL?: string, name: ManagerProviderName = "openai") {
    this.name = name;
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const start = Date.now();
    const timeoutMs = turn.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Abort the in-flight HTTP request when the operator clicks Stop, not only on
    // timeout. Without this, cancelling marks the operation cancelled while the
    // provider request keeps running and spending quota, and the provider stays
    // locked in activeProviders until it returns. Mirrors the claude/codex path.
    const cancelPoll = turn.shouldCancel
      ? setInterval(() => {
          if (turn.shouldCancel?.()) controller.abort();
        }, 200)
      : undefined;
    cancelPoll?.unref?.();
    let completion: Awaited<ReturnType<typeof this.client.chat.completions.create>>;
    const hasTools = !!turn.tools?.length;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          // The whole bounded context is the system prompt so the rules and the
          // proposal format carry more weight than they would as a user turn.
          // A trailing user turn is REQUIRED: Gemini's OpenAI-compat layer maps
          // `system` -> systemInstruction, so a system-only request leaves
          // `contents` empty and 400s ("contents is not specified"). The context
          // already embeds the conversation; this nudges a reply to it.
          // Prior tool-loop steps (if any) are replayed between the nudge and now
          // so the model can chain tools with real tool-result messages.
          messages: [
            { role: "system", content: turn.prompt },
            { role: "user", content: "Reply directly to the operator's latest message above. Do not restate or quote it back — open with your answer." },
            ...(turn.priorSteps?.length ? replaySteps(turn.priorSteps) : []),
          ],
          tools: hasTools ? serializeTools(turn.tools!) : undefined,
          tool_choice: hasTools ? "auto" : undefined,
          // Disable parallel tool calls: llama/Groq models generate malformed
          // JSON when they attempt multiple concurrent tool calls.
          ...(hasTools ? { parallel_tool_calls: false } : {}),
          // Low temperature: the manager's job is reliable instruction-following
          // (especially emitting the exact duet-proposal block). High temperature
          // makes weaker models narrate "I will propose..." instead of emitting.
          temperature: 0.2,
        },
        { signal: controller.signal },
      );
    } catch (error) {
      // A cancel-driven abort surfaces as CANCELLED so the engine treats it as a
      // stop, not a provider failure. A timeout abort falls through to the
      // generic handling below.
      if (controller.signal.aborted && turn.shouldCancel?.()) {
        throw new DuetError("Manager chat turn cancelled.", "CANCELLED");
      }
      if (isContextLimit(error)) {
        throw new DuetError(
          contextLimitMessage(error),
          "RATE_LIMITED",
        );
      }
      if (isBillingExhausted(error)) {
        throw new DuetError(
          "The manager provider is out of API credits or its billing is not set up. Add credits/billing for this provider, or switch managers.",
          "PROVIDER_BILLING_EXHAUSTED",
        );
      }
      if (isRateLimit(error)) {
        const seconds = retryAfterSeconds(error);
        const when = seconds ? ` You can try again in about ${seconds}s.` : " Try again in a moment.";
        throw new DuetError(
          `The manager model is rate limited right now.${when}`,
          "RATE_LIMITED",
        );
      }
      if (isToolCallGenerationFailure(error)) {
        throw new DuetError(
          "The manager provider could not form a valid tool call. Try again or switch managers.",
          "PROVIDER_TOOL_CALL_FAILED",
        );
      }
      if (isProviderConfigurationError(error)) {
        throw new DuetError(
          "The manager provider is not configured for this model or API key. Check the model, base URL, billing, or key, or switch managers.",
          "PROVIDER_CONFIGURATION_ERROR",
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
    }
    const choice = completion.choices[0];
    const usage = completion.usage;
    const message = choice?.message;
    return {
      provider: this.name,
      sessionId: completion.id,
      finalText:
        typeof message?.content === "string" ? message.content : "",
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      model: completion.model,
      toolCalls: message?.tool_calls?.flatMap((call) => {
        if (call.type !== "function") return [];
        return [{
          id: call.id,
          name: call.function.name,
          argumentsJson: call.function.arguments,
        }];
      }),
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        costKnown: false,
        costUsd: undefined,
      },
    };
  }
}
