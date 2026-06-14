import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { DuetError } from "../core/errors.js";
import {
  duetDataRoot,
  serviceInfoPath,
  serviceLockPath,
  serviceSecretPath,
} from "../paths.js";
import { runCommand } from "../process/run-command.js";
import { isProcessAlive } from "../process/run-command.js";

export interface ServiceInfo {
  instanceId: string;
  pid: number;
  processStartedAt: string;
  port: number;
  apiVersion: "v1";
  startedAt: string;
  commandHash?: string;
}

interface ProcessIdentity {
  startedAt: string;
  commandHash: string;
}

function commandHash(commandLine: string): string {
  return createHash("sha256").update(commandLine).digest("hex");
}

function windowsSystem32(executable: string): string {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    executable,
  );
}

function windowsPowerShell(): string {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export async function getProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | undefined> {
  if (!isProcessAlive(pid)) return undefined;
  if (process.platform === "win32") {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{startedAt=$p.StartTime.ToString('o');commandLine=$p.Path}|ConvertTo-Json -Compress}`;
    const result = await runCommand(
      windowsPowerShell(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { cwd: duetDataRoot(), timeoutMs: 5_000 },
    );
    if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
    const value = JSON.parse(result.stdout) as {
      startedAt: string;
      commandLine: string;
    };
    return {
      startedAt: new Date(value.startedAt).toISOString(),
      commandHash: commandHash(value.commandLine),
    };
  }
  const result = await runCommand(
    "ps",
    ["-p", String(pid), "-o", "lstart=", "-o", "command="],
    { cwd: duetDataRoot(), timeoutMs: 5_000 },
  );
  const line = result.stdout.trim();
  const match = /^(.{24})\s+([\s\S]+)$/.exec(line);
  if (result.exitCode !== 0 || !match) return undefined;
  return {
    startedAt: new Date(match[1]).toISOString(),
    commandHash: commandHash(match[2]),
  };
}

export async function verifyServiceProcess(
  info: ServiceInfo,
): Promise<boolean> {
  const identity = await getProcessIdentity(info.pid);
  if (!identity || !info.commandHash) return false;
  return (
    identity.commandHash === info.commandHash &&
    Math.abs(
      Date.parse(identity.startedAt) - Date.parse(info.processStartedAt),
    ) < 2_000
  );
}

async function secureWindowsFile(file: string): Promise<void> {
  const identity = await runCommand(
    windowsSystem32("whoami.exe"),
    ["/user", "/fo", "csv", "/nh"],
    { cwd: path.dirname(file) },
  );
  const identityMatch = /"([^"]+)","([^"]+)"/.exec(identity.stdout);
  const account = identityMatch?.[1];
  const sid = identityMatch?.[2];
  if (identity.exitCode !== 0 || !sid || !account) {
    throw new DuetError(
      "Could not determine the current Windows user SID.",
      "SERVICE_SECRET_ACL_FAILED",
    );
  }
  const secured = await runCommand(
    windowsSystem32("icacls.exe"),
    [file, "/inheritance:r", "/grant:r", `*${sid}:(F)`],
    { cwd: path.dirname(file) },
  );
  if (secured.exitCode !== 0) {
    throw new DuetError(
      secured.stderr || "Could not secure the service secret.",
      "SERVICE_SECRET_ACL_FAILED",
    );
  }
  const verified = await runCommand(windowsSystem32("icacls.exe"), [file], {
    cwd: path.dirname(file),
  });
  if (
    verified.exitCode !== 0 ||
    !verified.stdout.toLowerCase().includes(account.toLowerCase()) ||
    /Everyone|BUILTIN\\Users/i.test(verified.stdout)
  ) {
    throw new DuetError(
      "Service secret ACL verification failed.",
      "SERVICE_SECRET_ACL_FAILED",
    );
  }
}

export async function loadOrCreateServiceSecret(): Promise<string> {
  await mkdir(duetDataRoot(), { recursive: true });
  try {
    const secret = (await readFile(serviceSecretPath(), "utf8")).trim();
    await chmod(serviceSecretPath(), 0o600);
    if (process.platform === "win32") {
      await secureWindowsFile(serviceSecretPath());
    }
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  const handle = await open(serviceSecretPath(), "wx", 0o600);
  try {
    await handle.writeFile(`${secret}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(serviceSecretPath(), 0o600);
  if (process.platform === "win32") {
    await secureWindowsFile(serviceSecretPath());
  }
  return secret;
}

export async function readServiceInfo(): Promise<ServiceInfo | undefined> {
  try {
    return JSON.parse(
      await readFile(serviceInfoPath(), "utf8"),
    ) as ServiceInfo;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function publishServiceInfo(info: ServiceInfo): Promise<void> {
  await mkdir(duetDataRoot(), { recursive: true });
  const temporary = `${serviceInfoPath()}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(info, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, serviceInfoPath());
}

export async function clearServiceInfo(instanceId?: string): Promise<void> {
  const info = await readServiceInfo();
  if (!instanceId || !info || info.instanceId === instanceId) {
    await rm(serviceInfoPath(), { force: true });
  }
}

export async function acquireServiceLock(): Promise<void> {
  await mkdir(duetDataRoot(), { recursive: true });
  try {
    await mkdir(serviceLockPath());
    const identity = await getProcessIdentity(process.pid);
    await writeFile(
      path.join(serviceLockPath(), "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: identity?.startedAt,
        commandHash: identity?.commandHash,
      }),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new DuetError(
      "Another Duet service or embedded writer owns the state directory.",
      "SERVICE_LOCKED",
    );
  }
}

export async function reclaimStaleServiceLock(): Promise<void> {
  try {
    const owner = JSON.parse(
      await readFile(path.join(serviceLockPath(), "owner.json"), "utf8"),
    ) as { pid?: number; startedAt?: string; commandHash?: string };
    if (
      owner.pid &&
      owner.startedAt &&
      owner.commandHash &&
      (await verifyServiceProcess({
        instanceId: "lock-owner",
        pid: owner.pid,
        processStartedAt: owner.startedAt,
        commandHash: owner.commandHash,
        port: 0,
        apiVersion: "v1",
        startedAt: owner.startedAt,
      }))
    ) {
      throw new DuetError(
        `A live process (${owner.pid}) owns the Duet service lock.`,
        "SERVICE_LOCKED",
      );
    }
    await rm(serviceLockPath(), { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const details = await stat(serviceLockPath());
        if (Date.now() - details.mtimeMs < 5_000) {
          throw new DuetError(
            "A Duet service is currently starting.",
            "SERVICE_LOCKED",
          );
        }
        await rm(serviceLockPath(), { recursive: true, force: true });
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw statError;
        }
      }
      return;
    }
    throw error;
  }
}

export async function releaseServiceLock(): Promise<void> {
  await rm(serviceLockPath(), { recursive: true, force: true });
}
