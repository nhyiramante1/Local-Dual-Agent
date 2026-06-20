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
- Browser dashboard.
- MCP bridge for restricted inspection and planning.
- Manager Chat in the dashboard.
- Run-level worker profiles for agent model and effort policy.

Manager Chat can currently:

- Run globally or against a selected run.
- Use Codex or Claude as the manager voice.
- Summarize run, task, event, verification, and usage state.
- Produce durable proposal cards.
- Check proposal readiness.
- Copy or dismiss proposal cards.
- Start ordinary proposal actions after typed `start` confirmation.

Ordinary dashboard-startable proposal actions:

- `execute_run`
- `resume_run`
- `retry_task`
- `resolve_task`
- `cancel_run`
- `cancel_task`
- `cleanup_run`

Still CLI-only:

- `approve_plan`
- `approve_merge`
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
- OpenAI or ChatGPT-backed manager behavior should become the default manager
  lane when supported local integration paths allow it.
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

## Recommended Next Planning Targets

### Phase 5F: OpenAI Or ChatGPT Manager Lane

Goal:
Make OpenAI or ChatGPT-backed manager behavior the default dashboard manager
lane while preserving Codex and Claude as selectable manager options.

Key outcomes:

- Add manager-provider configuration independent from worker providers.
- Allow manager selection among OpenAI/ChatGPT, Codex, and Claude.
- Prefer OpenAI or ChatGPT-backed manager behavior by default.
- Preserve current global and run-scoped conversation behavior.
- Keep ordinary action start in the dashboard and fingerprint actions CLI-only
  for now.

This phase should not introduce unsupported browser automation.

### Phase 5G: Manager Strategy And Recommendation Engine

Goal:
Teach the manager to recommend how Duet should run, not just describe current
state.

Key outcomes:

- Recommend planning lead, worker provider, reviewer provider, and run profile.
- Consider current usage, estimated task weight, provider availability, and
  policy limits.
- Let the manager create plan proposals from global chat after confirmation.
- Surface bounded proactive guidance such as:
  - likely next action
  - useful dashboard or CLI feature
  - provider fallback when one lane is saturated

The human should still approve strategy-changing proposals before they start.

### Phase 6A: Manager-First Dashboard Control Plane

Goal:
Make manager chat the normal way to drive the product.

Key outcomes:

- Natural-language manager prompts automatically create the correct proposal
  cards and readiness checks.
- Explicit controls remain available as backup, but the chat path becomes the
  default experience.
- Global chat can inspect repositories, recommend setup, create plan proposals,
  and start planning after confirmation.
- Run-scoped chat can explain state, suggest next steps, and launch ordinary
  operations through proposal flows.

### Phase 6B: Browser-Native Fingerprint Approvals

Goal:
Move plan approval and merge approval into the dashboard without allowing agent
auto-approval.

Key outcomes:

- Fingerprint review modal in the dashboard.
- Typed confirmation in-browser for fingerprint-gated actions.
- Human-only approval boundary remains explicit and policy-bound.
- No automatic approve or merge path for manager agents.

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
At the time of this note, remote `main` already contains work through Phase 5D,
and the active future planning context assumes the current remote work is on
Phase 5E and beyond.
