import assert from "node:assert/strict";
import test from "node:test";

import { DuetError } from "../src/core/errors.js";
import { OpenAIManagerAdapter } from "../src/providers/openai-manager.js";

test("OpenAI-compatible adapter preserves 413 TPM context-limit details", async () => {
  const adapter = new OpenAIManagerAdapter("test-key", "openai/gpt-oss-120b", undefined, "groq");
  const providerError = new Error("Request too large") as Error & {
    status: number;
    error: unknown;
  };
  providerError.status = 413;
  providerError.error = {
    error: {
      message:
        "413 Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9750, please reduce your message size and try again.",
    },
  };

  (adapter as unknown as {
    client: {
      chat: {
        completions: {
          create: () => Promise<never>;
        };
      };
    };
  }).client = {
    chat: {
      completions: {
        async create() {
          throw providerError;
        },
      },
    },
  };

  await assert.rejects(
    () => adapter.run({
      cwd: process.cwd(),
      prompt: "context",
      mode: "read-only",
      timeoutMs: 1_000,
    }),
    (error) => {
      assert.ok(error instanceof DuetError);
      assert.equal(error.code, "RATE_LIMITED");
      assert.match(error.message, /context limit/);
      assert.match(error.message, /Limit 8000/);
      assert.match(error.message, /Requested 9750/);
      return true;
    },
  );
});

test("OpenAI-compatible adapter reports depleted credits as a billing failure, not a rate limit", async () => {
  const adapter = new OpenAIManagerAdapter("test-key", "gemini-2.5-flash", undefined, "gemini");
  const providerError = new Error("Resource exhausted") as Error & {
    status: number;
    error: unknown;
  };
  providerError.status = 429;
  providerError.error = {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message:
        "Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.",
    },
  };

  (adapter as unknown as {
    client: { chat: { completions: { create: () => Promise<never> } } };
  }).client = {
    chat: { completions: { async create() { throw providerError; } } },
  };

  await assert.rejects(
    () => adapter.run({
      cwd: process.cwd(),
      prompt: "context",
      mode: "read-only",
      timeoutMs: 1_000,
    }),
    (error) => {
      assert.ok(error instanceof DuetError);
      assert.equal(error.code, "PROVIDER_BILLING_EXHAUSTED");
      assert.match(error.message, /credits|billing/i);
      assert.doesNotMatch(error.message, /try again in a moment/i);
      return true;
    },
  );
});
