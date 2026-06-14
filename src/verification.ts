import { rm, rmdir } from "node:fs/promises";
import path from "node:path";

import type { VerificationResult } from "./core/domain.js";
import type { DuetConfig } from "./config.js";
import { materializeTree } from "./git/repository.js";
import { verificationRoot } from "./paths.js";
import { runCommand } from "./process/run-command.js";
import { sanitizedAgentEnvironment } from "./providers/environment.js";

export async function runVerification(options: {
  repoRoot: string;
  treeId: string;
  runId: string;
  taskId: string;
  attempt: number;
  config: DuetConfig;
  shouldCancel?: () => boolean;
}): Promise<VerificationResult[]> {
  const target = path.join(
    verificationRoot(),
    options.runId,
    options.taskId,
    String(options.attempt),
  );
  await materializeTree(options.repoRoot, options.treeId, target);
  const results: VerificationResult[] = [];
  const env = sanitizedAgentEnvironment(options.config.verification.env);
  try {
    const commands = [
      ...options.config.verification.setupCommands,
      ...options.config.verification.commands,
    ];
    for (const command of commands) {
      const [executable, ...args] = command;
      const result = await runCommand(executable, args, {
        cwd: target,
        env,
        timeoutMs: options.config.verification.timeoutSeconds * 1_000,
        shouldCancel: options.shouldCancel,
      });
      results.push({
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        passed:
          result.exitCode === 0 &&
          !result.timedOut &&
          result.error !== "Cancelled",
      });
      if (
        result.exitCode !== 0 ||
        result.timedOut ||
        result.error === "Cancelled"
      ) {
        break;
      }
    }
    return results;
  } finally {
    await rm(target, { recursive: true, force: true });
    await rmdir(path.dirname(target)).catch(() => undefined);
    await rmdir(path.dirname(path.dirname(target))).catch(() => undefined);
  }
}
