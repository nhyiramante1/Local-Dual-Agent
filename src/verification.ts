import { mkdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import type { VerificationResult } from "./core/domain.js";
import type { DuetConfig } from "./config.js";
import { materializeTree } from "./git/repository.js";
import { verificationCacheRoot, verificationRoot } from "./paths.js";
import { runCommand } from "./process/run-command.js";
import { sanitizedAgentEnvironment } from "./providers/environment.js";

// Persistent per-package-manager cache directories, reused across verification
// runs. The materialized tree (and its node_modules/.venv) is discarded each
// run, so without this every setup command re-downloads its dependencies. These
// point the common managers at a warm download/registry cache; correctness is
// unaffected because each manager still validates against the project's own
// lockfiles/manifests, so a stale cache can never produce wrong dependencies.
function dependencyCacheEnv(cacheRoot: string): NodeJS.ProcessEnv {
  return {
    npm_config_cache: path.join(cacheRoot, "npm"),
    YARN_CACHE_FOLDER: path.join(cacheRoot, "yarn"),
    PIP_CACHE_DIR: path.join(cacheRoot, "pip"),
    UV_CACHE_DIR: path.join(cacheRoot, "uv"),
    GOMODCACHE: path.join(cacheRoot, "go", "mod"),
    GOCACHE: path.join(cacheRoot, "go", "build"),
    CARGO_HOME: path.join(cacheRoot, "cargo"),
  };
}

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
  const cacheRoot = verificationCacheRoot();
  await mkdir(cacheRoot, { recursive: true });
  // Cache dirs first so the project's own verification.env can still override them.
  const env = sanitizedAgentEnvironment({
    ...dependencyCacheEnv(cacheRoot),
    ...options.config.verification.env,
  });
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
