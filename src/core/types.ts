export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  live: boolean;
  ok: boolean;
  checks: DoctorCheck[];
}

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}
