import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMarkedJson,
  extractMarkedPatch,
  parseJsonLines,
} from "../src/core/json.js";

test("extractMarkedJson parses the bounded payload", () => {
  const value = extractMarkedJson<{ ok: boolean }>(
    "DUET_JSON_BEGIN\n{\"ok\":true}\nDUET_JSON_END",
  );
  assert.deepEqual(value, { ok: true });
});

test("extractMarkedPatch unwraps a unified diff", () => {
  assert.equal(
    extractMarkedPatch(
      "DUET_PATCH_BEGIN\ndiff --git a/a.txt b/a.txt\nDUET_PATCH_END",
    ),
    "diff --git a/a.txt b/a.txt",
  );
});

test("parseJsonLines ignores non-JSON diagnostic lines", () => {
  assert.deepEqual(parseJsonLines('{"type":"one"}\nwarning\n{"type":"two"}'), [
    { type: "one" },
    { type: "two" },
  ]);
});

test("control envelopes reject duplicate, nested, and trailing blocks", () => {
  assert.throws(
    () =>
      extractMarkedJson(
        "DUET_JSON_BEGIN\n{}\nDUET_JSON_END\nDUET_JSON_BEGIN\n{}\nDUET_JSON_END",
      ),
    /exactly one complete/,
  );
  assert.throws(
    () =>
      extractMarkedJson(
        "DUET_JSON_BEGIN\n{\"text\":\"DUET_JSON_BEGIN\"}\nDUET_JSON_END",
      ),
    /exactly one complete/,
  );
  assert.throws(
    () =>
      extractMarkedJson(
        "DUET_JSON_BEGIN\n{}\nDUET_JSON_END\ntrailing",
      ),
    /exactly one complete/,
  );
});
