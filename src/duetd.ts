#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeVersionError } from "./bootstrap.js";

// Load .env from project root before anything reads process.env.
// Split on \r?\n so CRLF files don't leave a trailing \r that breaks the
// regex (which rejects lines ending in \r) for every line but the last.
// Strip a leading BOM so the first key still matches. Fill a var when it is
// missing OR present-but-empty, so an empty shadow in the parent env can't
// suppress a real value from .env.
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  const raw = readFileSync(envPath, "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — fine */ }
import { loadConfig, resolveManagerBudget } from "./config.js";
import type { ManagerProviderName } from "./core/domain.js";
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
    const config = await loadConfig();
    const managerBudget = resolveManagerBudget(config);
    const chatProviders: ChatProviders = {
      claude: new ClaudeAdapter(),
      codex: new CodexAdapter(),
    };
    // OpenAI-compatible manager identities. Each is constructed when its key is
    // present so the UI can switch between them per-conversation, independent of
    // which one is the configured default. Models/base URLs are overridable via
    // env so a new free model can be swapped without code changes.
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      chatProviders.groq = new OpenAIManagerAdapter(
        groqKey,
        process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      );
    }
    const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      chatProviders.gemini = new OpenAIManagerAdapter(
        geminiKey,
        process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        process.env.GEMINI_BASE_URL ??
          "https://generativelanguage.googleapis.com/v1beta/openai/",
      );
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      chatProviders.openai = new OpenAIManagerAdapter(
        openaiKey,
        config.manager.openaiModel,
        config.manager.openaiBaseUrl,
      );
    }
    // Resolve the effective default voice. If the configured default has no
    // constructed adapter (e.g. provider="groq" but no GROQ_API_KEY), fall back
    // to an available one so a fresh boot never defaults the dashboard to a dead
    // voice whose first turn fails. Codex/Claude are always constructed, so a
    // working fallback always exists. Order prefers OpenAI-compatible voices.
    const configuredProvider = config.manager.provider;
    const fallbackOrder: ManagerProviderName[] = [
      "groq",
      "gemini",
      "openai",
      "codex",
      "claude",
    ];
    const effectiveProvider: ManagerProviderName = chatProviders[configuredProvider]
      ? configuredProvider
      : (fallbackOrder.find((name) => chatProviders[name]) ?? "codex");
    if (effectiveProvider !== configuredProvider) {
      await serviceLog(
        "warning",
        `manager default provider "${configuredProvider}" has no API key configured; defaulting the dashboard to "${effectiveProvider}" instead`,
        {},
      );
    }
    service = new DuetService({
      store,
      secret,
      instanceId,
      idleTimeoutMs: Number(process.env.DUET_IDLE_TIMEOUT_MS ?? 15 * 60_000),
      listenHost: process.env.DUET_HOST ?? config.service.host,
      listenPort: Number(process.env.DUET_PORT ?? config.service.port ?? 0),
      config,
      managerBudget,
      managerToolRuntime: config.manager,
      managerProvider: effectiveProvider,
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
