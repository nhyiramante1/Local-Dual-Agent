import { appendFile, rename, rm, stat } from "node:fs/promises";

import { serviceLogPath } from "../paths.js";

export async function serviceLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const sanitize = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value
        .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
        .replaceAll(
          /(api[_-]?key|token|secret|password)(["'=:\s]+)[^\s",}]+/gi,
          "$1$2[REDACTED]",
        )
        .replaceAll(/[\u0000-\u001f\u007f]/g, " ");
    }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          /secret|token|password|authorization/i.test(key)
            ? "[REDACTED]"
            : sanitize(item),
        ]),
      );
    }
    return value;
  };
  const safe = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message),
    ...(sanitize(fields) as Record<string, unknown>),
  });
  try {
    if ((await stat(serviceLogPath())).size >= 5 * 1024 * 1024) {
      await rm(`${serviceLogPath()}.1`, { force: true });
      await rename(serviceLogPath(), `${serviceLogPath()}.1`);
    }
  } catch {
    // The log does not exist yet or rotation raced with another log write.
  }
  await appendFile(serviceLogPath(), `${safe}\n`, "utf8").catch(() => undefined);
}
