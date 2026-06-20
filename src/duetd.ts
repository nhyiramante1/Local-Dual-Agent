#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { nodeVersionError } from "./bootstrap.js";
import { loadConfig, resolveManagerBudget } from "./config.js";
import { Store } from "./persistence/store.js";
import { serviceInfoPath } from "./paths.js";
import {
  acquireServiceLock,
  clearServiceInfo,
  loadOrCreateServiceSecret,
  publishServiceInfo,
  readServiceInfo,
  reclaimStaleServiceLock,
  releaseServiceLock,
  getProcessIdentity,
  verifyServiceProcess,
} from "./service/discovery.js";
import { probeService } from "./service/client.js";
import { serviceLog } from "./service/logger.js";
import { DuetService } from "./service/server.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) throw new Error(versionError);

async function main(): Promise<void> {
  const existing = await readServiceInfo();
  if (existing && (await probeService(existing))) {
    throw new Error(`Duet service is already running as PID ${existing.pid}.`);
  }
  if (existing) {
    if (await verifyServiceProcess(existing)) {
      throw new Error(
        `Duet service process ${existing.pid} is alive but its health endpoint is unavailable.`,
      );
    }
    await rm(serviceInfoPath(), { force: true });
  }
  await reclaimStaleServiceLock();

  await acquireServiceLock();
  const instanceId = randomUUID();
  let store: Store | undefined;
  let service: DuetService | undefined;
  let compactionTimer: NodeJS.Timeout | undefined;
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await serviceLog("info", "service stopping", { instanceId });
    if (service) await service.close();
    if (compactionTimer) clearInterval(compactionTimer);
    if (store) {
      store.compactEvents();
      store.close();
    }
    await clearServiceInfo(instanceId);
    await releaseServiceLock();
  };

  try {
    store = new Store();
    const secret = await loadOrCreateServiceSecret();
    const config = await loadConfig();
    const managerBudget = resolveManagerBudget(config);
    service = new DuetService({
      store,
      secret,
      instanceId,
      idleTimeoutMs: Number(process.env.DUET_IDLE_TIMEOUT_MS ?? 15 * 60_000),
      managerBudget,
      onStop: () => {
        void stop().finally(() => process.exit(0));
      },
    });
    compactionTimer = setInterval(
      () => store?.compactEvents(),
      60 * 60_000,
    );
    compactionTimer.unref();

    const port = await service.listen();
    const identity = await getProcessIdentity(process.pid);
    const startedAt = new Date().toISOString();
    await publishServiceInfo({
      instanceId,
      pid: process.pid,
      processStartedAt: identity?.startedAt ?? startedAt,
      commandHash: identity?.commandHash,
      port,
      apiVersion: "v1",
      startedAt,
    });
    await serviceLog("info", "service started", {
      instanceId,
      port,
      pid: process.pid,
    });
    process.on("SIGINT", () => void stop().finally(() => process.exit(0)));
    process.on("SIGTERM", () => void stop().finally(() => process.exit(0)));
  } catch (error) {
    await stop();
    throw error;
  }
}

await main();
