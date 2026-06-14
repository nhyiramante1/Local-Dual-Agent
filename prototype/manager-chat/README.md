# Manager-chat prototype

A **throwaway, fixture-driven** prototype of a top-level conversational control surface
for Duet. It exists to pressure-test the interaction model before any real frontend work —
it does **not** call the service, spend tokens, or mutate anything.

## Run it

Open `index.html` directly in a browser:

```
file:///…/prototype/manager-chat/index.html
```

It is fully standalone — fixtures are embedded in `fixtures.js` and loaded via a classic
`<script>` (no `fetch()`, no `type="module"`), so `file://` works with no server. If you
prefer a server:

```
cd prototype/manager-chat
python -m http.server 8123    # then open http://127.0.0.1:8123/
```

## Interaction model

### Roles (four, independent)
| Role | What it is | Changes with `/switch`? |
|---|---|---|
| **Interface agent** | The agent that *voices the Manager*. Shown as `Manager: Claude` / `Manager: Codex`. | **Yes — only this** |
| **Planner** | Agent that drafts the plan | No |
| **Implementer** | Agent that writes each task | No |
| **Reviewer** | Agent that reviews each task | No |

The **Manager is a role/voice, not a third agent.** The deterministic supervisor (the
orchestrator's scheduler / lease / wave engine) stays separate and is never driven or
exposed through chat. `/switch claude|codex` changes only which agent voices the Manager —
it must never reassign planner/implementer/reviewer.

### Durable commands
Reads — `/status` `/tasks` `/diff` `/logs`
Actions — `/plan <goal>` `/run` `/resume` `/retry <taskId>`
`/resolve <taskId>` `/cancel [taskId]` `/cleanup`
Approvals — `/approve plan` · `/approve merge` · `/merge`
Control — `/switch claude|codex`

Plain English also works (e.g. "how's it going", "run it", "approve the plan", "switch to
codex") — it's mapped to the same commands.

### Confirmation tiers
| Tier | Commands | Mechanism |
|---|---|---|
| **Strong** | plan approval, merge approval, final merge | Proposal card shows the **fingerprint** first. The operator types the stage word; only then is a single-use action ticket minted and consumed. Replay is rejected. |
| **Ordinary** | plan, run, resume, retry, resolve, cancel, cleanup | Plain confirm — **no** fingerprint, **no** ticket. Task-scoped commands preserve and display their task ID. |
| **Immediate** | status, tasks, diff, logs | Runs instantly, no confirmation. |

## Honest about the boundary

This prototype deliberately does **not** imply every mutation is ticket-gated.

- The **live service ticket-gates exactly three actions**: plan approval, merge approval,
  and final merge (`consumeActionTicket` in `src/service/server.ts`). The strong-tier
  cards mirror that.
- The **ordinary tier** (run/resume/retry/cancel/cleanup) is a **UI affordance only** —
  the current service does not require an action ticket for these. The cards say so.
- No real human-approval, no real fingerprint computation, and no real ticket store are
  involved — values come from `fixtures.js`.

## Scope

- Vanilla HTML/CSS/JS, no dependencies, no build step.
- Not wired into `duetd`; never calls `/api/v1`.
- The production read-only dashboard (`src/dashboard/assets.ts`) is unaffected by this
  directory — this is a separate exploration, not a replacement.
