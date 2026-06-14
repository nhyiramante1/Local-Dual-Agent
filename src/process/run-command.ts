import crossSpawn from "cross-spawn";

import type { CommandResult } from "../core/types.js";

export interface RunCommandOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  onStart?: (pid: number) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onHeartbeat?: (pid: number) => void;
  shouldCancel?: () => boolean;
}

export function terminateProcessTree(childPid: number | undefined): void {
  if (childPid === undefined) return;
  if (process.platform === "win32") {
    const killer = crossSpawn(
      "taskkill.exe",
      ["/PID", String(childPid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.unref();
    return;
  }
  try {
    process.kill(-childPid, "SIGTERM");
  } catch {
    try {
      process.kill(childPid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = performance.now();

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let cancelled = false;
    let forcedSettlement: NodeJS.Timeout | undefined;

    const child = crossSpawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
      stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });

    if (child.pid) options.onStart?.(child.pid);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid);
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 15_000);
    const heartbeat = setInterval(() => {
      if (child.pid) options.onHeartbeat?.(child.pid);
      if (options.shouldCancel?.()) {
        cancelled = true;
        terminateProcessTree(child.pid);
        child.kill("SIGKILL");
        forcedSettlement ??= setTimeout(
          () => {
            child.kill("SIGKILL");
            finish(null, "SIGTERM");
          },
          2_000,
        );
      }
    }, 1_000);

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: string,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (forcedSettlement) clearTimeout(forcedSettlement);
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Math.round(performance.now() - startedAt),
        error: cancelled ? "Cancelled" : error,
      });
    };

    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (exitCode, signal) => finish(exitCode, signal));
    if (options.stdin !== undefined && child.stdin) {
      child.stdin.end(options.stdin);
    }
  });
}
