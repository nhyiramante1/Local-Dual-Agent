# Future Agent Handoff

This document summarizes the current Local Dual Agent product state and the
direction chosen for future planning. It is intended for future Codex, Claude,
or human planning sessions that need context quickly.

## Current Product Capability

The app is now a local dual-agent orchestrator with:

- CLI orchestration for planning, approval, execution, retry, resolve, cleanup,
  and merge.
- `duetd` local service.
- SQLite durable state.
- Browser dashboard with collapsible sidebar section nav (Runs, Tasks,
  Timeline, Verification, Messages, Artifacts, Conflicts, Diff).
- MCP bridge for restricted inspection and planning.
- Manager Chat in the dashboard — anchored at the bottom, vertically resizable.
- Run-level worker profiles for agent model and effort policy.
- `npm run up` one-shot script: stop → build → service start → auto-open browser.

Manager Chat can currently:

- Run globally (no run selected) or scoped to a selected run.
- Use any of six manager voices, switchable per conversation: GLM (default),
  Groq, Gemini, OpenAI, Claude, or Codex. GLM/Groq/Gemini are native
  OpenAI-compatible identities that enable automatically when their key is
  present (`ZAI_API_KEY`/`GROQ_API_KEY`/`GEMINI_API_KEY`). Configured via
  `duet.toml` and `.env`.
- Request operator-approved, read-only consultations from Claude or Codex
  (`request_agent_consultation`): a consent card is created, and on approval
  each agent inspects the repository read-only and its reply appears inline.
  Read-only repo access only — no shell, fingerprint-enforced.
- Show a live working indicator during a manager turn with the actual tool call
  and its result (not just a spinner), plus a Stop button scoped to that turn
  (cancels the in-flight provider request without touching background runs).
- Surface shared manager memory (provider-health / cooldown notes) even before
  the first conversation turn exists.
- Summarize run, task, event, verification, and usage state.
- Recommend provider and profile strategy based on current usage and
  availability (prefer_claude, prefer_codex, balanced, both_limited).
- Produce durable proposal cards.
- Synthesize `create_plan` proposals from natural language in global chat —
  e.g. "create a plan to add dark mode, repo is at C:\path\to\project".
- Check proposal readiness.
- Copy or dismiss proposal cards.
- Start ordinary proposal actions after typed `start` confirmation.
- Render markdown in responses (headers, lists, code blocks, bold, italic).
- Persist conversation history across page reloads.
- Pass last 3 user conversation turns as context to the planner when
  dispatching `create_plan` — planner sees the full discussion thread.
- Static timeline for terminal runs (failed/cancelled/merged/cleaned_up) —
  no live SSE reconnect, shows a static "no live events" notice.
- Delete finished runs from the sidebar via a × button on the run card —
  only terminal-status runs are eligible; cascades all child rows.
- Inline error banner (bottom-center, auto-dismisses 6 s) instead of
  browser `alert()` for dashboard errors.

Ordinary dashboard-startable proposal actions:

- `execute_run`
- `resume_run`
- `retry_task`
- `resolve_task`
- `cancel_run`
- `cancel_task`
- `cleanup_run`

Browser-confirmable (fingerprint modal in dashboard, no CLI needed):

- `approve_plan`
- `approve_merge`

Still CLI-only:

- `merge_run`
- action-ticket creation or consumption

That boundary is intentional.

## Current Safety Boundary

The dashboard may start ordinary operations only through chat-scoped proposal
routes. It still must not call direct `/api/v1/runs/*` mutation routes.

Fingerprint-gated actions remain terminal-confirmed:

- plan approval
- merge approval
- merge

The dashboard is an operator-intent convenience, not strong proof of human
presence.

## Direction Decided

The product direction is now explicitly manager-first:

- Manager Chat should become the primary control surface over time.
- Natural language should be the first interaction path, with visible controls
  as backup.
- Claude and Codex remain worker and reviewer agents.
- An OpenAI-compatible manager lane should be the default so dashboard chat does
  not consume Claude/Codex worker quota. This is now realized: the shipped
  default is **GLM** (native tool calling, low cost). It was briefly defaulted to
  Groq, but groq/llama models frequently fail to form valid tool calls
  ("could not form a valid tool call"), so GLM is the reliable default. Gemini is
  a good secondary; real OpenAI/ChatGPT remains a future option.
- Codex manager and Claude manager remain selectable fallback lanes.
- The manager should suggest provider choices per stage and per run profile, and
  the human approves before those choices take effect.
- Suggestions should take current usage, remaining headroom, cost, model
  strength, and task weight into account.
- The manager should proactively suggest useful Duet features and likely next
  actions, but in a bounded, contextual way.
- Fingerprint-gated actions should eventually move into the dashboard through a
  browser-native fingerprint review plus typed confirmation, while still
  preventing automatic approve or merge behavior by agents.

## Supported Assumption About ChatGPT

The desired default manager experience is "use ChatGPT or OpenAI as the manager
so dashboard chat does not depend on Claude/Codex agent quota."

Implementation should assume:

- Use supported local OpenAI integration paths only.
- No UI or textbox automation.
- Prefer a ChatGPT or OpenAI-backed manager lane when available.
- Keep an API-backed OpenAI fallback available if a direct ChatGPT-backed local
  path is limited by product surface constraints.

Do not plan around unsupported access to a consumer ChatGPT browser session.

## Structural Adjustments Recommended

These are architectural recommendations, not yet-completed implementation:

1. Introduce a dedicated `ManagerProvider` abstraction.
   Claude/Codex worker adapters already exist. Manager providers should be
   separate so the manager can use OpenAI, Codex, Claude, or future providers
   without inheriting worker-specific assumptions.

2. Split manager selection from worker selection everywhere durable state is
   modeled.
   The system should treat these as independent concepts:
   - interface agent / manager voice
   - manager provider
   - planning lead
   - implementation provider
   - reviewer provider
   - run profile

3. Add a deterministic recommendation layer.
   Manager suggestions should be synthesized through a policy-aware recommender,
   not left to free-form prompt text. The recommender should read usage,
   provider availability, run profile policy, and task weight, then emit
   bounded suggestions.

4. Keep the deterministic supervisor as the only actor that mutates run state.
   Manager chat should keep creating proposals, readiness checks, and start
   requests rather than calling orchestration internals directly.

5. Keep profiles as the first public abstraction.
   The user should primarily see named profiles like `cheap`, `balanced`,
   `reasoning`, and `max`. Raw model and effort knobs can exist behind an
   advanced layer later.

## Completed Phases

- **Phases 1–4**: CLI orchestration, SQLite state, worktrees, budgets, verification.
- **Phase 5A–5D**: Manager Chat prototype, proposal cards, global chat, manager config.
- **Phase 5E**: Worker profiles (cheap/balanced/reasoning/max).
- **Phase 5F**: OpenAI-compatible manager lane — `openai_base_url` config,
  `GROQ_API_KEY` env fallback, `.env` auto-load on service startup, `duet.toml`
  shipped with project.
- **Phase 5G**: Manager strategy and recommendation engine — provider availability
  context, `prefer_claude`/`prefer_codex`/`balanced`/`both_limited` recommendations,
  `create_plan` proposal synthesis from natural language in global chat.
- **Phase 6A**: Proposal history and operation outcome tracking.
- **Phase 6B**: Browser-native fingerprint approval modal for `approve_plan` and
  `approve_merge` — rate-limited, binding-hash verified, session-only path.
- **Phase 6C (partial / dashboard polish)**: Run delete (× button, terminal
  runs only, cascades children), static timeline for finished runs, inline
  error banner, conversation context forwarded to planner on `create_plan`.
- **Phase 5H**: `set_strategy` manager proposal that persists run lead/provider/
  profile preferences (PR #17), plus manager-chat polish — conversational
  defaults, `create_plan` intent gate (`userIntentAllowsCreatePlan`), and
  optimistic pending-turn UI (PR #18).
- **Phone dashboard access**: Fixed `[service].port`, `[dashboard]
  .persistent_access` reusable access tokens, `duet dashboard --phone`, LAN-IP
  detection, and a "Clear context" manager-chat button (PR #19).

## Completed Phases (continued)

- **Phase Next / Mobile + Conversational Manager** (`feature/improving-general-feel`,
  pending PR):
  - Bottom tab bar on mobile: icon rail becomes fixed bottom nav, sections open
    as full-height drawer, chat is default home view. Mobile starts collapsed
    without clobbering desktop localStorage preference. Tapping active tab closes
    drawer.
  - Phone access fixes: `SameSite=Lax` session cookie (was `Strict`, blocked
    mobile browsers over LAN), `public_host` in `duet.toml`, `viewport-fit=cover`
    + `env(safe-area-inset-bottom)` for iPhone home indicator.
  - Manager chat head simplified: subtitle and status line hidden globally; on
    mobile the title/conn row is also hidden, leaving only agent switcher and
    Clear context.
  - Manager prompt rewritten as reasoning partner. Conversation and reasoning
    lead; proposal mode is secondary and only triggered when the operator clearly
    asks to operate Duet. Repeated approval reminders and policy-wrapper framing
    removed.
  - Dropped stray `mkdir(codexHomePath())` startup side-effect from `duetd.ts`.

- **Live Timeline + Consultation + Provider Control** (`feature/live-timeline`,
  PR #23, merged):
  - Read-only agent consultation runner (`ConsultationActivityManager`): manager
    proposes `request_agent_consultation`, operator approves, Claude/Codex answer
    read-only (fingerprint-enforced), replies appear inline as manager turns.
  - Native OpenAI-compatible manager identities (groq, gemini, glm) split out;
    manager voice switchable per conversation across all six providers.
  - Live tool timeline: `ManagerActivity` carries `tool` + `tool-result` frames
    (args/ok/elapsed/result); dashboard shows the live call and result.
  - Cancellation correctness: `shouldCancel` wired into the OpenAI-compatible
    adapter (aborts the in-flight HTTP request, ~200ms), and `cancelActive` is
    abort-only so the run promise owns the terminal write (no UI/backend race).
  - Composer Stop scoped to the current manager turn via
    `POST /operations/:id/cancel` (never cancels background runs).
  - `GET /chat/shared-context` exposes provider-health notes before the first
    turn; orphan-recovery restart waits for PID/port release before relaunch.
  - Default manager set to GLM (was groq) for reliable tool calling.

## Recommended Next Planning Targets

### Phase 7B: Manager tool-call reliability (highest value)

groq/llama models frequently return `PROVIDER_TOOL_CALL_FAILED`; today the turn
dies with no retry. Add a one-shot retry on that code, and/or transparent
failover to a reliable tool-calling provider (GLM/Gemini) with a visible note.
Defaulting to GLM mitigates but does not solve this for groq users.

### Phase 7C: Live timeline depth

The live `tool`/`tool-result` data now exists but the dashboard renders only a
one-line working bubble. Render a real expanding per-call timeline, and consider
moving `/operations/:id` from 100ms polling to SSE streaming.

### Phase 7D: Consultation depth

Add debate mode (currently independent-only; `maxTurns` is vestigial), fix the
provider-lock coordination gap (a consultation and a manager turn can run in the
same conversation concurrently), and surface estimated consultation cost on the
consent card before approval.

### Phase 6C: Extension Points

Goal:
Reserve space for future manager or worker providers without overbuilding now.

Key outcomes:

- Stable manager-provider interface.
- Stable recommendation inputs and outputs.
- Room for future providers beyond OpenAI, Codex, and Claude.
- No commitment yet to additional providers in the immediate roadmap.

## Testing Commands

Current gate used recently:

```powershell
npm.cmd run check
node --import tsx --test tests\chat-service.test.ts tests\chat-store.test.ts tests\proposals.test.ts tests\chat-context.test.ts
npm.cmd test
npm.cmd run build
npm.cmd run test:dashboard
git diff --check
```

For UI-only Manager Chat smoke without live provider quota:

```powershell
npm run test:dashboard
```

## Planning Advice

Start future branches from updated `main`, not old stacked feature branches.
At the time of this note, `main` contains work through the Mobile/Conversational
Manager pass and the Live Timeline + Consultation + Provider Control work
(PR #23, merged). There is no in-progress feature branch. Start the next phase
(Phase 7B tool-call reliability is the recommended first target) from `main`.

Note on provider auth: Duet keeps an isolated Codex credential store
(`<repo>/.duet/codex-home`), not your normal `~/.codex` — re-auth with
`node dist/cli.js auth codex`. The Claude manager uses the `claude` CLI's
headless token; a 401 means re-login with `claude` then `/login`. Verify with
`node dist/cli.js doctor --live` (its auth line can read PASS while the live
probe FAILS — trust the probe).
