import { fileURLToPath } from "node:url";
import path from "node:path";

export function appRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function duetDataRoot(): string {
  return path.join(appRoot(), ".duet");
}

export function stateDatabasePath(): string {
  return path.join(duetDataRoot(), "state.sqlite");
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
