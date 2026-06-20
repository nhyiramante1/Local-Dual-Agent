import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAUDE_MODELS,
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

test("CODEX_MODELS cheap maps to codex-mini-latest", () => {
  assert.equal(CODEX_MODELS["cheap"], "codex-mini-latest");
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
