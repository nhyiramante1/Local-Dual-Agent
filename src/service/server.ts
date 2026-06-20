import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { ActivityManager, type LongRunningCommand } from "../application/activities.js";
import { ApplicationCommands } from "../application/commands.js";
import { approvalBinding } from "../application/integrity.js";
import { ChatActivityManager } from "../chat/activity.js";
import {
  ChatEngine,
  defaultManagerBudget,
  type ChatProviders,
} from "../chat/engine.js";
import type { ManagerBudget } from "../core/domain.js";
import {
  prepareProposalAction,
  startProposalAction,
} from "../chat/proposals.js";
import { defaultConfig, validateConfig } from "../config.js";
import type { OperationRecord } from "../core/domain.js";
import { DuetError } from "../core/errors.js";
import { ClaudeAdapter } from "../providers/claude.js";
import { CodexAdapter } from "../providers/codex.js";
import {
  dashboardCss,
  dashboardHtml,
  dashboardJs,
} from "../dashboard/assets.js";
import { Store } from "../persistence/store.js";
import { artifactsRoot } from "../paths.js";
import { serviceLog } from "./logger.js";

interface ServerOptions {
  store: Store;
  secret: string;
  instanceId: string;
  idleTimeoutMs?: number;
  onStop?: () => void;
  chatProviders?: ChatProviders;
  managerBudget?: ManagerBudget;
}

interface JsonBody {
  [key: string]: unknown;
}

const terminalOperations = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function apiSuccess(requestId: string, data: unknown): string {
  return JSON.stringify({ apiVersion: "v1", requestId, data });
}

function apiFailure(requestId: string, error: unknown): string {
  return JSON.stringify({
    apiVersion: "v1",
    requestId,
    error: {
      code: error instanceof DuetError ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      throw new DuetError("Request body is too large.", "BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseCookies(value: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [
          decodeURIComponent(item.slice(0, index)),
          decodeURIComponent(item.slice(index + 1)),
        ];
      }),
  );
}

export class DuetService {
  readonly app: ApplicationCommands;
  readonly activities: ActivityManager;
  readonly chat: ChatActivityManager;
  private readonly server = createServer((request, response) => {
    void this.handle(request, response);
  });
  private readonly tickets = new Map<string, number>();
  private readonly sessions = new Map<string, number>();
  private readonly idleTimeoutMs: number;
  private activeStreams = 0;
  private readonly streams = new Set<ServerResponse>();
  private lastRequestAt = Date.now();
  private idleTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly options: ServerOptions) {
    this.app = new ApplicationCommands(options.store);
    this.activities = new ActivityManager(this.app, options.instanceId);
    const chatProviders: ChatProviders = options.chatProviders ?? {
      claude: new ClaudeAdapter(),
      codex: new CodexAdapter(),
    };
    this.chat = new ChatActivityManager(
      options.store,
      new ChatEngine(
        options.store,
        chatProviders,
        options.managerBudget ?? defaultManagerBudget,
      ),
      options.instanceId,
    );
    // Marks interrupted operations (run + manager_turn) from prior instances.
    this.activities.recoverInterrupted();
    this.idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60_000;
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    this.idleTimer = setInterval(() => this.checkIdle(), 10_000);
    this.sweepTimer = setInterval(() => {
      try {
        const expired = this.options.store.expireProposals();
        if (expired > 0) {
          void serviceLog("info", "expired stale proposals", { count: expired });
        }
      } catch (error) {
        void serviceLog("warning", "proposal expiry sweep failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 60_000);
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new DuetError("Could not determine service port.", "SERVICE_START_FAILED");
    }
    return address.port;
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private checkIdle(): void {
    if (
      this.activeStreams === 0 &&
      !this.activities.hasActiveOperations() &&
      !this.chat.hasActiveOperations() &&
      Date.now() - this.lastRequestAt >= this.idleTimeoutMs
    ) {
      this.options.onStop?.();
    }
  }

  private credentialKind(
    request: IncomingMessage,
  ): "bearer" | "session" | undefined {
    const bearer = request.headers.authorization?.replace(/^Bearer /, "");
    if (bearer && equalSecret(bearer, this.options.secret)) return "bearer";
    const session = parseCookies(request.headers.cookie).duet_session;
    const expires = session ? this.sessions.get(session) : undefined;
    return expires !== undefined && expires > Date.now()
      ? "session"
      : undefined;
  }

  private requestClientId(request: IncomingMessage): string {
    const requested = request.headers["x-duet-client"];
    return typeof requested === "string" &&
      /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(requested)
      ? requested
      : "local-cli";
  }

  private validateLocalRequest(request: IncomingMessage): void {
    const host = request.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host) && !/^\[::1\]:\d+$/.test(host)) {
      throw new DuetError("Invalid Host header.", "INVALID_HOST");
    }
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== `http://${host}` &&
      origin !== `http://127.0.0.1:${host.split(":").at(-1)}`
    ) {
      throw new DuetError("Cross-origin request rejected.", "INVALID_ORIGIN");
    }
  }

  private send(
    response: ServerResponse,
    status: number,
    body: string,
    contentType = "application/json; charset=utf-8",
    headers: Record<string, string> = {},
  ): void {
    response.writeHead(status, {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    });
    response.end(body);
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID();
    this.lastRequestAt = Date.now();
    try {
      this.validateLocalRequest(request);
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host}`,
      );
      if (url.pathname === "/healthz") {
        this.send(response, 200, "ok\n", "text/plain; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        this.send(response, 200, dashboardHtml, "text/html; charset=utf-8", {
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/dashboard.js") {
        this.send(response, 200, dashboardJs, "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && url.pathname === "/dashboard.css") {
        this.send(response, 200, dashboardCss, "text/css; charset=utf-8");
        return;
      }
      if (request.method === "POST" && url.pathname === "/dashboard/session") {
        const body = JSON.parse(await readBody(request)) as { ticket?: string };
        const expires = body.ticket ? this.tickets.get(body.ticket) : undefined;
        if (!body.ticket || !expires || expires <= Date.now()) {
          throw new DuetError("Dashboard ticket is invalid or expired.", "INVALID_TICKET");
        }
        this.tickets.delete(body.ticket);
        const session = randomBytes(24).toString("base64url");
        this.sessions.set(session, Date.now() + 8 * 60 * 60_000);
        this.send(response, 204, "", "text/plain", {
          "set-cookie": `duet_session=${encodeURIComponent(session)}; HttpOnly; SameSite=Strict; Path=/`,
        });
        return;
      }
      if (!url.pathname.startsWith("/api/v1/")) {
        this.send(response, 404, apiFailure(requestId, new DuetError("Not found.", "NOT_FOUND")));
        return;
      }
      const credential = this.credentialKind(request);
      if (!credential) {
        this.send(response, 401, apiFailure(requestId, new DuetError("Unauthorized.", "UNAUTHORIZED")));
        return;
      }
      // Sessions are read-only for runs. Chat-state mutations (/api/v1/chat/*)
      // are session-allowed, but proposal /start submits run work and must
      // stay bearer-only.
      const chatRoute =
        url.pathname.startsWith("/api/v1/chat/") &&
        !url.pathname.endsWith("/start");
      if (
        credential === "session" &&
        request.method !== "GET" &&
        !chatRoute
      ) {
        this.send(
          response,
          403,
          apiFailure(
            requestId,
            new DuetError(
              "Dashboard sessions are read-only for runs.",
              "READ_ONLY_SESSION",
            ),
          ),
        );
        return;
      }
      await this.handleApi(request, response, url, requestId);
    } catch (error) {
      await serviceLog("error", "request failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      const status =
        error instanceof DuetError &&
        [
          "VERSION_CONFLICT",
          "IDEMPOTENCY_CONFLICT",
          "RUN_ACTIVITY_ACTIVE",
          "CHAT_TURN_ACTIVE",
          "CHAT_PROVIDER_ACTIVE",
          "PROPOSAL_ALREADY_STARTED",
        ].includes(error.code)
          ? 409
          : error instanceof DuetError &&
              ["UNAUTHORIZED", "INVALID_TICKET"].includes(error.code)
            ? 401
            : error instanceof DuetError &&
                error.code === "READ_ONLY_SESSION"
              ? 403
            : error instanceof DuetError &&
                [
                  "NOT_FOUND",
                  "RUN_NOT_FOUND",
                  "CONVERSATION_NOT_FOUND",
                  "OPERATION_NOT_FOUND",
                  "PROPOSAL_NOT_FOUND",
                ].includes(error.code)
              ? 404
              : 400;
      this.send(response, status, apiFailure(requestId, error));
    }
  }

  private async handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    requestId: string,
  ): Promise<void> {
    const route = url.pathname.slice("/api/v1".length);
    if (route === "/chat/conversations") {
      if (request.method === "GET") {
        const runId = url.searchParams.get("runId") ?? undefined;
        this.send(
          response,
          200,
          apiSuccess(requestId, this.options.store.listConversations(runId)),
        );
        return;
      }
      if (request.method === "POST") {
        const bodyText = await readBody(request);
        const body = bodyText ? (JSON.parse(bodyText) as JsonBody) : {};
        const interfaceAgent =
          body.interfaceAgent === undefined || body.interfaceAgent === "codex"
            ? "codex"
            : body.interfaceAgent === "claude"
              ? "claude"
              : undefined;
        if (!interfaceAgent) {
          throw new DuetError(
            "interfaceAgent must be 'claude' or 'codex'.",
            "INVALID_ARGUMENT",
          );
        }
        const runId =
          typeof body.runId === "string" && body.runId.trim().length > 0
            ? body.runId.trim()
            : undefined;
        await this.mutate(request, response, requestId, route, bodyText, () => {
          if (runId) {
            // Validate the run link before creating chat state so callers get
            // a clean 404 instead of a foreign-key failure.
            this.options.store.getRun(runId);
          }
          return {
            status: 201,
            data: this.options.store.createConversation({
              id: randomUUID(),
              runId,
              interfaceAgent,
              title:
                typeof body.title === "string"
                  ? body.title.slice(0, 200)
                  : undefined,
            }),
          };
        });
        return;
      }
      throw new DuetError("Not found.", "NOT_FOUND");
    }
    const proposalPrepareMatch =
      /^\/chat\/conversations\/([^/]+)\/proposals\/([^/]+)\/prepare$/.exec(
        route,
      );
    if (proposalPrepareMatch) {
      if (request.method !== "GET") {
        throw new DuetError("Not found.", "NOT_FOUND");
      }
      const conversationId = decodeURIComponent(proposalPrepareMatch[1]);
      const proposalId = decodeURIComponent(proposalPrepareMatch[2]);
      this.send(
        response,
        200,
        apiSuccess(
          requestId,
          prepareProposalAction(
            this.options.store,
            conversationId,
            proposalId,
          ),
        ),
      );
      return;
    }
    const proposalStartMatch =
      /^\/chat\/conversations\/([^/]+)\/proposals\/([^/]+)\/start$/.exec(
        route,
      );
    if (proposalStartMatch) {
      if (request.method !== "POST") {
        throw new DuetError("Not found.", "NOT_FOUND");
      }
      const conversationId = decodeURIComponent(proposalStartMatch[1]);
      const proposalId = decodeURIComponent(proposalStartMatch[2]);
      const bodyText = await readBody(request);
      const body = bodyText ? (JSON.parse(bodyText) as JsonBody) : {};
      await this.mutate(request, response, requestId, route, bodyText, () => {
        const { command } = startProposalAction(
          this.options.store,
          conversationId,
          proposalId,
          body,
        );
        const operation = this.activities.submit(command);
        try {
          this.options.store.markProposalStarted(
            conversationId,
            proposalId,
            operation.id,
          );
        } catch (err) {
          this.activities.cancelActive(operation.id);
          throw err;
        }
        return {
          status: 202,
          data: operation,
        };
      });
      return;
    }
    const proposalDismissMatch =
      /^\/chat\/conversations\/([^/]+)\/proposals\/([^/]+)\/dismiss$/.exec(
        route,
      );
    if (proposalDismissMatch) {
      if (request.method !== "POST") {
        throw new DuetError("Not found.", "NOT_FOUND");
      }
      const conversationId = decodeURIComponent(proposalDismissMatch[1]);
      const proposalId = decodeURIComponent(proposalDismissMatch[2]);
      const bodyText = await readBody(request);
      await this.mutate(
        request,
        response,
        requestId,
        route,
        bodyText,
        () => {
          this.options.store.getConversation(conversationId);
          this.options.store.dismissProposal(conversationId, proposalId);
          return {
            status: 200,
            data: { proposalId, status: "dismissed" },
          };
        },
      );
      return;
    }
    const chatMatch = /^\/chat\/conversations\/([^/]+)(\/turns)?$/.exec(route);
    if (chatMatch) {
      const conversationId = decodeURIComponent(chatMatch[1]);
      if (!chatMatch[2]) {
        if (request.method !== "GET") {
          throw new DuetError("Not found.", "NOT_FOUND");
        }
        this.send(
          response,
          200,
          apiSuccess(requestId, {
            conversation: this.options.store.getConversation(conversationId),
            turns: this.options.store.listConversationTurns(conversationId, {
              limit: 200,
            }),
            proposals: this.options.store.listProposals(conversationId),
          }),
        );
        return;
      }
      if (request.method !== "POST") {
        throw new DuetError("Not found.", "NOT_FOUND");
      }
      const bodyText = await readBody(request);
      const body = bodyText ? (JSON.parse(bodyText) as JsonBody) : {};
      if (typeof body.message !== "string") {
        throw new DuetError(
          "A chat message of 1 to 20,000 characters is required.",
          "INVALID_ARGUMENT",
        );
      }
      const message = body.message.trim();
      if (!message || message.length > 20_000) {
        throw new DuetError(
          "A chat message of 1 to 20,000 characters is required.",
          "INVALID_ARGUMENT",
        );
      }
      // 404s if the conversation does not exist, before any paid work.
      this.options.store.getConversation(conversationId);
      await this.mutate(request, response, requestId, route, bodyText, () => ({
        status: 202,
        data: this.chat.submitTurn({
          conversationId,
          userMessage: message,
          inputHash: hash(bodyText),
        }),
      }));
      return;
    }
    if (request.method === "GET" && route === "/health") {
      this.send(response, 200, apiSuccess(requestId, {
        status: "ok",
        instanceId: this.options.instanceId,
        activeOperations: this.options.store.listActiveOperations().length,
      }));
      return;
    }
    if (request.method === "GET" && route === "/diagnostics") {
      this.send(response, 200, apiSuccess(requestId, {
        node: process.version,
        platform: process.platform,
        instanceId: this.options.instanceId,
        clientId: this.requestClientId(request),
        activeOperations: this.options.store.listActiveOperations(),
        leases: this.options.store.listLeases(),
      }));
      return;
    }
    if (request.method === "POST" && route === "/dashboard/ticket") {
      const ticket = randomBytes(24).toString("base64url");
      this.tickets.set(ticket, Date.now() + 60_000);
      this.send(response, 200, apiSuccess(requestId, { ticket }));
      return;
    }
    if (request.method === "POST" && route === "/service/stop") {
      const body = JSON.parse((await readBody(request)) || "{}") as {
        force?: boolean;
      };
      const active = this.options.store.listActiveOperations();
      if (active.length > 0 && !body.force) {
        throw new DuetError("Active operations prevent graceful shutdown.", "SERVICE_BUSY");
      }
      if (active.length > 0) {
        const chatCancelled = this.chat.cancelActive();
        for (const runId of new Set(
          active
            .filter((operation) => operation.kind !== "manager_turn")
            .map((operation) => operation.runId)
            .filter(Boolean),
        )) {
          await this.app.cancel(runId!);
        }
        this.send(response, 202, apiSuccess(requestId, {
          stopping: false,
          cancellationRequested: true,
          chatCancellationRequested: chatCancelled,
        }));
        return;
      }
      this.send(response, 202, apiSuccess(requestId, { stopping: true }));
      setTimeout(() => this.options.onStop?.(), 10);
      return;
    }
    if (request.method === "GET" && route.startsWith("/operations/")) {
      this.send(
        response,
        200,
        apiSuccess(requestId, this.activities.get(decodeURIComponent(route.slice(12)))),
      );
      return;
    }
    if (request.method === "GET" && route.startsWith("/artifacts/")) {
      const id = Number(route.slice("/artifacts/".length));
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new DuetError("Invalid artifact ID.", "INVALID_ARGUMENT");
      }
      await this.sendArtifact(request, response, id);
      return;
    }
    if (request.method === "GET" && route === "/runs") {
      this.send(response, 200, apiSuccess(requestId, this.options.store.listRuns()));
      return;
    }
    if (request.method === "GET" && route === "/events") {
      const after = Number(
        request.headers["last-event-id"] ??
          url.searchParams.get("after") ??
          0,
      );
      const runId = url.searchParams.get("runId") ?? undefined;
      const bounds = this.options.store.getEventBounds(runId);
      if (
        after > 0 &&
        bounds.minimum !== undefined &&
        after < bounds.minimum - 1
      ) {
        if (request.headers.accept?.includes("text/event-stream")) {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-store",
          });
          response.end(
            `event: duet.reset\ndata: ${JSON.stringify({ reason: "cursor_expired" })}\n\n`,
          );
        } else {
          throw new DuetError(
            "Event cursor expired; fetch a fresh snapshot.",
            "EVENT_CURSOR_EXPIRED",
          );
        }
        return;
      }
      if (request.headers.accept?.includes("text/event-stream")) {
        this.streamEvents(request, response, url);
      } else {
        this.send(response, 200, apiSuccess(requestId, this.options.store.listEvents({
          afterSeq: after,
          runId,
        })));
      }
      return;
    }
    if (request.method === "POST" && route === "/runs") {
      const bodyText = await readBody(request);
      const body = JSON.parse(bodyText) as JsonBody;
      const repoPath = String(body.repoPath ?? "").trim();
      const goal = String(body.goal ?? "").trim();
      if (!repoPath || !goal || goal.length > 20_000) {
        throw new DuetError(
          "repoPath and a goal of at most 20,000 characters are required.",
          "INVALID_ARGUMENT",
        );
      }
      const command: LongRunningCommand = {
        kind: "plan",
        repoPath,
        goal,
        lead: body.lead === "codex" ? "codex" : "claude",
        config: validateConfig(body.config ?? defaultConfig),
      };
      await this.mutate(request, response, requestId, route, bodyText, () => ({
        status: 202,
        data: this.activities.submit(command),
      }));
      return;
    }
    const runMatch = /^\/runs\/([^/]+)(.*)$/.exec(route);
    if (!runMatch) throw new DuetError("Not found.", "NOT_FOUND");
    const runId = decodeURIComponent(runMatch[1]);
    const suffix = runMatch[2];
    if (request.method === "GET") {
      if (suffix === "") {
        this.send(response, 200, apiSuccess(requestId, this.app.getRun(runId)));
        return;
      }
      if (suffix === "/tasks") {
        this.send(response, 200, apiSuccess(requestId, this.options.store.listTasks(runId)));
        return;
      }
      if (suffix === "/messages") {
        this.send(response, 200, apiSuccess(requestId, this.options.store.listMessages(runId)));
        return;
      }
      if (suffix === "/usage") {
        this.send(response, 200, apiSuccess(requestId, this.options.store.getUsageSummary(runId)));
        return;
      }
      if (suffix === "/verification") {
        this.send(
          response,
          200,
          apiSuccess(
            requestId,
            this.options.store.listVerificationResults(runId),
          ),
        );
        return;
      }
      if (suffix === "/diff") {
        const diff = this.options.store
          .listTasks(runId)
          .filter((task) => task.reviewedArtifact)
          .map((task) => `### ${task.id}: ${task.plan.title}\n${task.reviewedArtifact!.diff}`)
          .join("\n");
        this.send(response, 200, apiSuccess(requestId, { diff }));
        return;
      }
      if (suffix === "/conflicts") {
        this.send(response, 200, apiSuccess(requestId, this.app.orchestrator.listConflicts(runId)));
        return;
      }
      if (suffix === "/artifacts") {
        this.send(response, 200, apiSuccess(requestId, this.options.store.listArtifacts(runId)));
        return;
      }
      if (suffix === "/approval-fingerprint") {
        const stage = url.searchParams.get("stage") === "merge" ? "merge" : "plan";
        const run = this.options.store.getRun(runId);
        this.send(response, 200, apiSuccess(requestId, {
          stage,
          fingerprint: approvalBinding(run, this.options.store.listTasks(runId), stage),
          version: run.version ?? 1,
        }));
        return;
      }
    }
    if (request.method !== "POST") throw new DuetError("Not found.", "NOT_FOUND");
    const bodyText = await readBody(request);
    const body = bodyText ? (JSON.parse(bodyText) as JsonBody) : {};
    await this.mutate(request, response, requestId, route, bodyText, () => {
      const run = this.options.store.getRun(runId);
      const versionIndependentCancel =
        suffix === "/cancel" ||
        /^\/tasks\/[^/]+\/cancel$/.test(suffix);
      if (
        !versionIndependentCancel &&
        Number(body.expectedVersion) !== (run.version ?? 1)
      ) {
        throw new DuetError("Run version changed.", "VERSION_CONFLICT");
      }
      if (suffix === "/action-ticket") {
        const action =
          body.action === "approve_plan" ||
          body.action === "approve_merge" ||
          body.action === "merge"
            ? body.action
            : undefined;
        if (!action) {
          throw new DuetError(
            "Invalid action ticket request.",
            "INVALID_ARGUMENT",
          );
        }
        const stage = action === "approve_plan" ? "plan" : "merge";
        const fingerprint = approvalBinding(
          run,
          this.options.store.listTasks(runId),
          stage,
        );
        const ticket = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        this.options.store.createActionTicket({
          tokenHash: hash(ticket),
          runId,
          action,
          bindingHash: fingerprint,
          runVersion: run.version ?? 1,
          expiresAt,
        });
        return {
          status: 200,
          data: { ticket, fingerprint, expiresAt },
        };
      }
      if (suffix === "/approve") {
        const stage = body.stage === "merge" ? "merge" : "plan";
        const fingerprint = approvalBinding(
          run,
          this.options.store.listTasks(runId),
          stage,
        );
        this.options.store.consumeActionTicket({
          tokenHash: hash(String(body.actionTicket ?? "")),
          runId,
          action: stage === "plan" ? "approve_plan" : "approve_merge",
          bindingHash: fingerprint,
          runVersion: run.version ?? 1,
        });
        return {
          status: 200,
          data: this.app.approve(runId, stage, Number(body.expectedVersion)),
        };
      }
      const taskAction = /^\/tasks\/([^/]+)\/(retry|cancel|resolve)$/.exec(suffix);
      let command: LongRunningCommand;
      if (taskAction) {
        const taskId = decodeURIComponent(taskAction[1]);
        command =
          taskAction[2] === "retry"
            ? { kind: "retry", runId, taskId }
            : taskAction[2] === "resolve"
              ? { kind: "resolve", runId, taskId }
              : { kind: "cancel", runId, taskId };
      } else {
        const action = suffix.slice(1);
        if (!["execute", "resume", "cancel", "cleanup", "merge"].includes(action)) {
          throw new DuetError("Not found.", "NOT_FOUND");
        }
        command =
          action === "execute"
            ? { kind: "execute", runId }
            : action === "resume"
              ? {
                  kind: "resume",
                  runId,
                  config:
                    body.config === undefined
                      ? undefined
                      : validateConfig(body.config),
                }
              : action === "cancel"
                ? { kind: "cancel", runId }
                : action === "cleanup"
                  ? { kind: "cleanup", runId, force: body.force === true }
                  : { kind: "merge", runId };
        if (action === "merge") {
          const fingerprint = approvalBinding(
            run,
            this.options.store.listTasks(runId),
            "merge",
          );
          this.options.store.consumeActionTicket({
            tokenHash: hash(String(body.actionTicket ?? "")),
            runId,
            action: "merge",
            bindingHash: fingerprint,
            runVersion: run.version ?? 1,
          });
        }
      }
      return { status: 202, data: this.activities.submit(command) };
    });
  }

  private async mutate(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
    route: string,
    bodyText: string,
    action: () => { status: number; data: unknown },
  ): Promise<void> {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200) {
      throw new DuetError("A valid Idempotency-Key is required.", "IDEMPOTENCY_REQUIRED");
    }
    const inputHash = hash(bodyText);
    const scope = {
      clientId: this.requestClientId(request),
      method: request.method ?? "POST",
      route,
      key,
      inputHash,
    };
    const existing = this.options.store.getIdempotentResponse(scope);
    if (existing) {
      this.send(response, existing.statusCode, existing.responseJson);
      return;
    }
    const committed = this.options.store.transaction(() => {
      const result = action();
      const responseJson = apiSuccess(requestId, result.data);
      this.options.store.saveIdempotentResponse({
        ...scope,
        statusCode: result.status,
        responseJson,
      });
      return { ...result, responseJson };
    });
    this.send(response, committed.status, committed.responseJson);
  }

  private streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.activeStreams += 1;
    this.streams.add(response);
    let cursor = Number(request.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
    const runId = url.searchParams.get("runId") ?? undefined;
    let backpressured = false;
    let cleaned = false;
    let poll: NodeJS.Timeout;
    let heartbeat: NodeJS.Timeout;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      this.activeStreams -= 1;
      this.streams.delete(response);
    };
    const flush = () => {
      if (cleaned || backpressured) return;
      for (const event of this.options.store.listEvents({ afterSeq: cursor, runId })) {
        let writable: boolean;
        try {
          writable = response.write(
            `id: ${event.seq}\nevent: duet.event\ndata: ${JSON.stringify(event)}\n\n`,
          );
        } catch {
          cleanup();
          return;
        }
        cursor = event.seq;
        if (!writable) {
          backpressured = true;
          response.once("drain", () => {
            backpressured = false;
            flush();
          });
          break;
        }
      }
    };
    poll = setInterval(flush, 500);
    heartbeat = setInterval(() => {
      try {
        response.write(": heartbeat\n\n");
      } catch {
        cleanup();
      }
    }, 15_000);
    response.on("error", cleanup);
    response.on("close", cleanup);
    request.on("close", cleanup);
    flush();
  }

  private async sendArtifact(
    request: IncomingMessage,
    response: ServerResponse,
    id: number,
  ): Promise<void> {
    const source = this.options.store.getArtifactSource(id);
    let content: Buffer;
    if (source.filePath) {
      const root = await realpath(path.resolve(artifactsRoot()));
      await stat(path.resolve(source.filePath));
      const candidate = await realpath(path.resolve(source.filePath));
      const relative = path.relative(root, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new DuetError("Artifact path escaped managed storage.", "PATH_TRAVERSAL");
      }
      content = await readFile(candidate);
    } else {
      content = Buffer.from(source.record.content ?? "", "utf8");
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    let start = 0;
    let end = content.length > 0 ? content.length - 1 : 0;
    let status = 200;
    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
      "accept-ranges": "bytes",
      "content-disposition": `inline; filename="artifact-${id}.txt"`,
    };
    if (range && content.length > 0) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), content.length - 1) : end;
      if (start > end || start >= content.length) {
        response.writeHead(416, { "content-range": `bytes */${content.length}` });
        response.end();
        return;
      }
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${content.length}`;
    }
    response.writeHead(status, {
      ...headers,
      "content-length": String(content.length === 0 ? 0 : end - start + 1),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(content.length === 0 ? content : content.subarray(start, end + 1));
  }
}
