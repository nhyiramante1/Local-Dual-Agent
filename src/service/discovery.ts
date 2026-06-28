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
  dashboardAccessPath,
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

export interface ServiceLockOwner {
  pid?: number;
  startedAt?: string;
  commandHash?: string;
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

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

async function probePort(port: number): Promise<boolean> {
  if (!isValidPort(port)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function detectListeningPort(pid: number): Promise<number | undefined> {
  // pid may originate from untrusted on-disk JSON (owner.json); reject anything
  // non-numeric before it reaches a shell command string.
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (!isProcessAlive(pid)) return undefined;
  if (process.platform === "win32") {
    const script = `$port = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Sort-Object LocalPort | Select-Object -First 1 -ExpandProperty LocalPort; if ($port) { Write-Output $port }`;
    const result = await runCommand(
      windowsPowerShell(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { cwd: duetDataRoot(), timeoutMs: 5_000 },
    );
    const port = parseInt(result.stdout.trim(), 10);
    return Number.isFinite(port) && port > 0 ? port : undefined;
  }
  const result = await runCommand(
    "sh",
    ["-lc", `lsof -Pan -p ${pid} -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n.*:\\([0-9][0-9]*\\)$/\\1/p' | head -n 1`],
    { cwd: duetDataRoot(), timeoutMs: 5_000 },
  );
  const port = parseInt(result.stdout.trim(), 10);
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

async function detectListeningPid(port: number): Promise<number | undefined> {
  if (!isValidPort(port)) return undefined;
  if (process.platform === "win32") {
    const script = `$duetPid = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($duetPid) { Write-Output $duetPid }`;
    const result = await runCommand(
      windowsPowerShell(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { cwd: duetDataRoot(), timeoutMs: 5_000 },
    );
    const pid = parseInt(result.stdout.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  }
  const result = await runCommand(
    "sh",
    ["-lc", `lsof -Pan -iTCP:${port} -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^p//p' | head -n 1`],
    { cwd: duetDataRoot(), timeoutMs: 5_000 },
  );
  const pid = parseInt(result.stdout.trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
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

export async function loadOrCreateDashboardAccessToken(): Promise<string> {
  await mkdir(duetDataRoot(), { recursive: true });
  try {
    const token = (await readFile(dashboardAccessPath(), "utf8")).trim();
    await chmod(dashboardAccessPath(), 0o600);
    if (process.platform === "win32") {
      await secureWindowsFile(dashboardAccessPath());
    }
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("base64url");
  const handle = await open(dashboardAccessPath(), "wx", 0o600);
  try {
    await handle.writeFile(`${token}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await chmod(dashboardAccessPath(), 0o600);
  if (process.platform === "win32") {
    await secureWindowsFile(dashboardAccessPath());
  }
  return token;
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

export async function readServiceLockOwner(): Promise<ServiceLockOwner | undefined> {
  try {
    return JSON.parse(
      await readFile(path.join(serviceLockPath(), "owner.json"), "utf8"),
    ) as ServiceLockOwner;
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
    const owner = await readServiceLockOwner();
    const ownerPid = Number(owner?.pid);
    if (
      owner &&
      Number.isInteger(ownerPid) &&
      ownerPid > 0 &&
      owner.startedAt &&
      owner.commandHash &&
      (await verifyServiceProcess({
        instanceId: "lock-owner",
        pid: ownerPid,
        processStartedAt: owner.startedAt,
        commandHash: owner.commandHash,
        port: 0,
        apiVersion: "v1",
        startedAt: owner.startedAt,
      }))
    ) {
      throw new DuetError(
        `A live process (${ownerPid}) owns the Duet service lock.`,
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

export async function recoverServiceInfo(
  preferredPort?: number,
): Promise<ServiceInfo | undefined> {
  const current = await readServiceInfo();
  if (current && (await probePort(current.port))) return current;
  // A unique id so two concurrent recoveries never collide on a constant.
  const recoveredInstanceId = `recovered-${randomBytes(8).toString("hex")}`;
  const owner = await readServiceLockOwner();
  // owner.pid comes from on-disk JSON; coerce to a real pid before any use.
  const ownerPid = Number(owner?.pid);
  if (!owner || !Number.isInteger(ownerPid) || ownerPid <= 0 || !owner.startedAt || !owner.commandHash) {
    if (!preferredPort || preferredPort <= 0 || !(await probePort(preferredPort))) {
      return undefined;
    }
    const pid = await detectListeningPid(preferredPort);
    if (!pid) return undefined;
    const identity = await getProcessIdentity(pid);
    if (!identity) return undefined;
    const candidate: ServiceInfo = {
      instanceId: recoveredInstanceId,
      pid,
      processStartedAt: identity.startedAt,
      commandHash: identity.commandHash,
      port: preferredPort,
      apiVersion: "v1",
      startedAt: identity.startedAt,
    };
    if (!(await verifyServiceProcess(candidate))) return undefined;
    await publishServiceInfo(candidate);
    return candidate;
  }
  const port = preferredPort && preferredPort > 0
    ? preferredPort
    : await detectListeningPort(ownerPid);
  if (!port) return undefined;
  const candidate: ServiceInfo = {
    instanceId: recoveredInstanceId,
    pid: ownerPid,
    processStartedAt: owner.startedAt,
    commandHash: owner.commandHash,
    port,
    apiVersion: "v1",
    startedAt: owner.startedAt,
  };
  if (!(await verifyServiceProcess(candidate))) return undefined;
  if (!(await probePort(candidate.port))) return undefined;
  await publishServiceInfo(candidate);
  return candidate;
}
