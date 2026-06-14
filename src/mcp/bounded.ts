const defaultTextLimit = 8_000;

export interface TruncatedText {
  text: string;
  originalLength: number;
  truncated: boolean;
}

export function truncateText(
  value: string,
  maximum = defaultTextLimit,
): TruncatedText {
  if (value.length <= maximum) {
    return {
      text: value,
      originalLength: value.length,
      truncated: false,
    };
  }
  return {
    text: value.slice(0, maximum),
    originalLength: value.length,
    truncated: true,
  };
}

export function parseBoundedJson(
  value: string | undefined,
  maximum = 20_000,
): { value?: unknown; truncated: boolean } {
  if (!value) return { truncated: false };
  const bounded = truncateText(value, maximum);
  if (bounded.truncated) {
    return {
      value: {
        text: bounded.text,
        originalLength: bounded.originalLength,
        truncated: true,
      },
      truncated: true,
    };
  }
  try {
    return { value: JSON.parse(value) as unknown, truncated: false };
  } catch {
    return { value, truncated: false };
  }
}

export function conciseJson(value: unknown, maximum = 4_000): string {
  return truncateText(JSON.stringify(value, null, 2), maximum).text;
}

export function boundJsonValue(
  value: unknown,
  maximum = 8_000,
): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maximum) return value;
  return {
    text: serialized.slice(0, maximum),
    originalLength: serialized.length,
    truncated: true,
  };
}

export function takeWithinJsonBudget<T>(
  values: T[],
  maximumCharacters: number,
  newestFirst = false,
): { values: T[]; truncated: boolean } {
  const source = newestFirst ? [...values].reverse() : values;
  const selected: T[] = [];
  let used = 2;
  for (const value of source) {
    const size = JSON.stringify(value).length + 1;
    if (selected.length > 0 && used + size > maximumCharacters) break;
    selected.push(value);
    used += size;
  }
  if (newestFirst) selected.reverse();
  return {
    values: selected,
    truncated: selected.length < values.length,
  };
}
