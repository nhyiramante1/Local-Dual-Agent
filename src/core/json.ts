import { DuetError } from "./errors.js";

export function parseJsonLines(value: string): unknown[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function extractEnvelope(
  value: string,
  startMarker: string,
  endMarker: string,
  code: string,
): string {
  const trimmed = value.trim();
  const starts = [...trimmed.matchAll(new RegExp(startMarker, "g"))];
  const ends = [...trimmed.matchAll(new RegExp(endMarker, "g"))];
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    !trimmed.startsWith(startMarker) ||
    !trimmed.endsWith(endMarker) ||
    starts[0].index! >= ends[0].index!
  ) {
    throw new DuetError(
      `Response must contain exactly one complete ${startMarker}/${endMarker} envelope.`,
      code,
    );
  }
  return trimmed
    .slice(startMarker.length, trimmed.length - endMarker.length)
    .trim();
}

export function extractMarkedJson<T>(value: string): T {
  const json = extractEnvelope(
    value,
    "DUET_JSON_BEGIN",
    "DUET_JSON_END",
    "MALFORMED_AGENT_RESPONSE",
  );
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    throw new DuetError(
      `Agent returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "MALFORMED_AGENT_RESPONSE",
    );
  }
}

export function extractMarkedPatch(value: string): string {
  const patch = extractEnvelope(
    value,
    "DUET_PATCH_BEGIN",
    "DUET_PATCH_END",
    "MISSING_AGENT_PATCH",
  );
  if (patch.startsWith("```") || patch.endsWith("```")) {
    throw new DuetError(
      "Patch envelope must not contain markdown fences.",
      "MALFORMED_AGENT_PATCH",
    );
  }
  return patch;
}
