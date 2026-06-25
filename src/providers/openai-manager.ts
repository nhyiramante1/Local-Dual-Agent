import OpenAI from "openai";

import type { AgentResult } from "../core/domain.js";
import type { AgentTurn, ProviderAdapter } from "./adapter.js";

const DEFAULT_MODEL = "gpt-4o-mini";

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
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          // The whole bounded context is the system prompt so the rules and the
          // proposal format carry more weight than they would as a user turn.
          messages: [{ role: "system", content: turn.prompt }],
          tools: turn.tools?.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: turn.tools?.length ? "auto" : undefined,
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
