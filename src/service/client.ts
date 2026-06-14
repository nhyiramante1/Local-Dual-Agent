import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";

import crossSpawn from "cross-spawn";

import type { OperationRecord } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { appRoot, duetDataRoot } from "../paths.js";
import {
  loadOrCreateServiceSecret,
  readServiceInfo,
  type ServiceInfo,
} from "./discovery.js";

export function logicalIdempotencyKey(
  route: string,
  body: unknown,
): string {
  return createHash("sha256")
    .update(`${route}\0${JSON.stringify(body)}`)
    .digest("hex");
}

async function requestRaw(
  info: ServiceInfo,
  secret: string,
  route: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${info.port}${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(init.headers ?? {}),
    },
  });
}

export async function probeService(
  info?: ServiceInfo,
): Promise<boolean> {
  info ??= await readServiceInfo();
  if (!info) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/healthz`, {
      signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function serviceCommand(): Promise<{ command: string; args: string[] }> {
  const built = path.join(appRoot(), "dist", "duetd.js");
  try {
    await access(built);
    return { command: process.execPath, args: [built] };
  } catch {
    const shim = path.join(appRoot(), "node_modules", ".bin", "tsx.cmd");
    return {
      command: process.platform === "win32" ? shim : shim.replace(/\.cmd$/, ""),
      args: [path.join(appRoot(), "src", "duetd.ts")],
    };
  }
}

export async function ensureService(): Promise<ServiceInfo> {
  let info = await readServiceInfo();
  if (info && (await probeService(info))) return info;
  const command = await serviceCommand();
  const child = crossSpawn(command.command, command.args, {
    cwd: appRoot(),
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, DUET_HOME: duetDataRoot() },
  });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    info = await readServiceInfo();
    if (info && (await probeService(info))) return info;
  }
  throw new DuetError("Duet service did not start.", "SERVICE_START_FAILED");
}

export class DuetClient {
  private constructor(
    readonly info: ServiceInfo,
    private readonly secret: string,
  ) {}

  static async connect(start = true): Promise<DuetClient> {
    const info = start ? await ensureService() : await readServiceInfo();
    if (!info || !(await probeService(info))) {
      throw new DuetError("Duet service is not running.", "SERVICE_NOT_RUNNING");
    }
    return new DuetClient(info, await loadOrCreateServiceSecret());
  }

  async get<T>(route: string): Promise<T> {
    return await this.request<T>(route, { method: "GET" });
  }

  async post<T>(
    route: string,
    body: unknown,
    options: { unique?: boolean; idempotencyKey?: string } = {},
  ): Promise<T> {
    const serialized = JSON.stringify(body);
    const idempotencyKey =
      options.idempotencyKey ??
      (options.unique
        ? randomUUID()
        : logicalIdempotencyKey(route, body));
    return await this.request<T>(route, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: serialized,
    });
  }

  async wait(
    operationId: string,
    onProgress?: (operation: OperationRecord) => void,
  ): Promise<OperationRecord> {
    while (true) {
      const operation = await this.get<OperationRecord>(
        `/api/v1/operations/${encodeURIComponent(operationId)}`,
      );
      onProgress?.(operation);
      if (terminalOperations.has(operation.status)) return operation;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  private async request<T>(route: string, init: RequestInit): Promise<T> {
    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await requestRaw(this.info, this.secret, route, init);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    if (!response) throw lastError;
    const envelope = (await response.json()) as {
      data?: T;
      error?: { code: string; message: string };
    };
    if (!response.ok || envelope.error) {
      throw new DuetError(
        envelope.error?.message ?? response.statusText,
        envelope.error?.code ?? "HTTP_ERROR",
      );
    }
    return envelope.data as T;
  }
}

const terminalOperations = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
