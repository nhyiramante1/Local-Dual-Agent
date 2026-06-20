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

Manager Chat can currently:

- Run against a selected run.
- Use Codex or Claude as the manager voice.
- Summarize run, task, event, and verification state.
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

## Known Practical Issue

A live Manager Chat Codex call failed with:

```text
CODEX_FAILED: Your access token could not be refreshed because your refresh token was revoked.
```

That is not a usage-limit error. It means Duet's Codex home needs re-auth:

```powershell
cd C:\Users\nhyir\Experiments\duet-orchestrator
$env:CODEX_HOME="$PWD\.duet\codex-home"
npx codex logout
npx codex login
```

Manager Chat still consumes real provider turns when used live.

## Direction Decided

Future direction is to keep evolving Manager Chat into the control surface, but
carefully:

- Manager can suggest and help operate Duet.
- Claude and Codex can still be workers and reviewers.
- The manager does not have to be Claude or Codex forever; a cheaper/general
  OpenAI chat model could eventually act as the manager to reduce agent quota
  use.
- The manager should eventually be able to choose or request agent thinking
  modes or model modes, such as Claude Opus/Haiku or Codex reasoning effort,
  but only through explicit policy/config, not ad hoc prompt magic.
- UI controls should remain human-confirmed and policy-bound.

## Recommended Next Planning Targets

### Phase 5C: Global Manager Chat

Allow dashboard Manager Chat without selecting a run.

Useful prompts include:

- "What can you do?"
- "Help me start a run."
- "Which project should I pick?"

This should not mutate repositories yet except perhaps creating a plan proposal.
It needs a clear conversation scope split: global vs run-scoped.

### Phase 5D: Manager Provider Decoupling

Add a separate manager provider config.

Goals:

- Let manager use a cheaper OpenAI chat model or regular ChatGPT-like model.
- Keep Claude and Codex as worker/reviewer agents.
- Avoid spending Codex/Claude agent quota just to ask dashboard questions.

### Phase 5E: Model/Mode Policy Profiles

Add named profiles for agents:

- cheap/fast
- balanced
- high reasoning
- max/expensive

Manager can suggest a profile, but the deterministic supervisor should enforce
allowed values and budgets.

Store selected profile in run/task config.

### Phase 6: Stronger Dashboard Control Plane

Improve the dashboard as the operator control plane:

- better proposal history
- clearer operation status
- clearer approval state
- stronger dashboard controls

Dashboard approval flows may come later, but only after designing the
human-presence and security boundary. Fingerprint/action-ticket flow needs extra
care before moving from CLI to browser.

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

Start future branches from updated `main`, not old stacked feature branches,
because PRs for Phase 5A/5B have been merged into remote `main`.
