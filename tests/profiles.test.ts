import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAUDE_EFFORT,
  CLAUDE_MODELS,
  CODEX_EFFORT,
  CODEX_MODELS,
} from "../src/providers/profiles.js";

test("CLAUDE_MODELS cheap maps to haiku model", () => {
  assert.equal(CLAUDE_MODELS["cheap"], "claude-haiku-4-5-20251001");
});

test("CLAUDE_MODELS balanced returns undefined (use adapter default)", () => {
  assert.equal(CLAUDE_MODELS["balanced"], undefined);
});

test("CLAUDE_MODELS reasoning maps to opus", () => {
  assert.equal(CLAUDE_MODELS["reasoning"], "claude-opus-4-8");
});

test("CLAUDE_MODELS max maps to opus", () => {
  assert.equal(CLAUDE_MODELS["max"], "claude-opus-4-8");
});

test("CLAUDE_EFFORT cheap is low", () => {
  assert.equal(CLAUDE_EFFORT["cheap"], "low");
});

test("CLAUDE_EFFORT balanced returns undefined (use adapter default)", () => {
  assert.equal(CLAUDE_EFFORT["balanced"], undefined);
});

test("CLAUDE_EFFORT reasoning is high", () => {
  assert.equal(CLAUDE_EFFORT["reasoning"], "high");
});

test("CLAUDE_EFFORT max is max", () => {
  assert.equal(CLAUDE_EFFORT["max"], "max");
});

test("CODEX_MODELS cheap maps to gpt-5.4-mini", () => {
  assert.equal(CODEX_MODELS["cheap"], "gpt-5.4-mini");
});

test("CODEX_MODELS balanced returns undefined (use adapter default)", () => {
  assert.equal(CODEX_MODELS["balanced"], undefined);
});

test("CODEX_MODELS reasoning returns undefined (no dedicated model)", () => {
  assert.equal(CODEX_MODELS["reasoning"], undefined);
});

test("CODEX_MODELS max returns undefined (no dedicated model)", () => {
  assert.equal(CODEX_MODELS["max"], undefined);
});

test("CODEX_EFFORT cheap is low", () => {
  assert.equal(CODEX_EFFORT["cheap"], "low");
});

test("CODEX_EFFORT balanced returns undefined (use adapter default)", () => {
  assert.equal(CODEX_EFFORT["balanced"], undefined);
});

test("CODEX_EFFORT reasoning is high", () => {
  assert.equal(CODEX_EFFORT["reasoning"], "high");
});

test("CODEX_EFFORT max is high", () => {
  assert.equal(CODEX_EFFORT["max"], "high");
});
