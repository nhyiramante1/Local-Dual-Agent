import { fileURLToPath } from "node:url";
import path from "node:path";

export function appRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function duetDataRoot(): string {
  return process.env.DUET_HOME ?? path.join(appRoot(), ".duet");
}

export function stateDatabasePath(): string {
  return path.join(duetDataRoot(), "state.sqlite");
}

export function serviceInfoPath(): string {
  return path.join(duetDataRoot(), "service.json");
}

export function serviceLockPath(): string {
  return path.join(duetDataRoot(), "service.lock");
}

export function serviceSecretPath(): string {
  return path.join(duetDataRoot(), "service.secret");
}

export function dashboardAccessPath(): string {
  return path.join(duetDataRoot(), "dashboard.access");
}

export function serviceLogPath(): string {
  return path.join(duetDataRoot(), "duetd.jsonl");
}

export function codexHomePath(): string {
  return process.env.DUET_CODEX_HOME ?? path.join(duetDataRoot(), "codex-home");
}

export function worktreesRoot(): string {
  return path.join(duetDataRoot(), "worktrees");
}

export function artifactsRoot(): string {
  return path.join(duetDataRoot(), "artifacts");
}

export function verificationRoot(): string {
  return path.join(duetDataRoot(), "verification");
}
