import OpenAI from "openai";

import type { AgentResult, ManagerToolDefinition } from "../core/domain.js";
import type { AgentTurn, ProviderAdapter } from "./adapter.js";

const DEFAULT_MODEL = "gpt-4o-mini";

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
  readonly name = "openai" as const;
  readonly supportsNativeToolCalling = true;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
  }

  async run(turn: AgentTurn): Promise<AgentResult> {
    const start = Date.now();
    const timeoutMs = turn.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          messages: [
            { role: "system", content: turn.prompt },
            { role: "user", content: "Respond to the latest operator message in the conversation above." },
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
    } finally {
      clearTimeout(timer);
    }
    const choice = completion.choices[0];
    const usage = completion.usage;
    const message = choice?.message;
    return {
      provider: "openai",
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
