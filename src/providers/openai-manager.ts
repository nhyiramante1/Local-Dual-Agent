import OpenAI from "openai";

import type { AgentResult } from "../core/domain.js";
import type { AgentTurn, ProviderAdapter } from "./adapter.js";

const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAIManagerAdapter implements ProviderAdapter {
  readonly name = "openai" as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_MODEL, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
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
      provider: "openai",
      sessionId: completion.id,
      finalText: choice?.message.content ?? "",
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        costKnown: false,
        costUsd: undefined,
      },
    };
  }
}
