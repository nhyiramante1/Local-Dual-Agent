#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeVersionError } from "./bootstrap.js";

// Load .env from project root before anything reads process.env
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — fine */ }
import { loadConfig, resolveManagerBudget } from "./config.js";
import { Store } from "./persistence/store.js";
import { ClaudeAdapter } from "./providers/claude.js";
import { CodexAdapter } from "./providers/codex.js";
import { OpenAIManagerAdapter } from "./providers/openai-manager.js";
import type { ChatProviders } from "./chat/engine.js";
import { serviceInfoPath } from "./paths.js";
import { codexHomePath } from "./paths.js";
import {
  acquireServiceLock,
  clearServiceInfo,
  loadOrCreateDashboardAccessToken,
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
    const dashboardAccessToken = await loadOrCreateDashboardAccessToken();
    await mkdir(codexHomePath(), { recursive: true });
    const config = await loadConfig();
    const managerBudget = resolveManagerBudget(config);
    const chatProviders: ChatProviders = {
      claude: new ClaudeAdapter(),
      codex: new CodexAdapter(),
    };
    const openaiKey = process.env.OPENAI_API_KEY ?? process.env.GROQ_API_KEY;
    if (config.manager.provider === "openai") {
      if (openaiKey) {
        chatProviders.openai = new OpenAIManagerAdapter(openaiKey, config.manager.openaiModel, config.manager.openaiBaseUrl);
      } else {
        await serviceLog("warning", "manager provider is openai but OPENAI_API_KEY (or GROQ_API_KEY) is not set; falling back to codex", {});
      }
    }
    service = new DuetService({
      store,
      secret,
      instanceId,
      idleTimeoutMs: Number(process.env.DUET_IDLE_TIMEOUT_MS ?? 15 * 60_000),
      listenHost: process.env.DUET_HOST ?? config.service.host,
      listenPort: Number(process.env.DUET_PORT ?? config.service.port ?? 0),
      managerBudget,
      managerProvider: config.manager.provider,
      dashboardPublicHost:
        process.env.DUET_PUBLIC_HOST ?? config.dashboard.publicHost,
      dashboardAccessToken,
      chatProviders,
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
