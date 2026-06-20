# Phase 6B Security Design — Browser-Native Fingerprint Approvals

## Goal

Move `approve_plan` and `approve_merge` out of the CLI and into the dashboard
approval modal, while preserving the human-presence and content-integrity
guarantees the CLI fingerprint flow provides today. `merge_run` stays CLI-only
in this phase.

---

## Current CLI Security Model (What We Must Preserve)

1. **Content integrity** — `approvalBinding()` (`src/application/integrity.ts`)
   computes a deterministic SHA-256 hash of exactly what is being approved:
   plan config + task scopes for plan stage; commit SHAs + diff hashes for merge
   stage. This hash is the fingerprint.

2. **Human confirmation** — the CLI prints the fingerprint and requires the
   operator to type it back. Automation cannot satisfy this without knowing the
   hash in advance.

3. **One-time ticket** — `createActionTicket` / `consumeActionTicket`
   (`src/persistence/store.ts`). Tickets are bound to `(run_id, action,
   binding_hash, run_version)` and expire after a short window. Replay is
   impossible.

4. **Version lock** — `run_version` in the ticket means the ticket becomes
   invalid if the run state changes between display and consumption.

---

## Threat Model

| Threat | Mitigated by |
|---|---|
| XSS in proposal summary drives approval | Approval requires typed hash prefix — injected JS cannot know the server-computed hash |
| Malicious manager proposal shows false content | Approval modal pulls data fresh from the server, not from proposal fields |
| CSRF triggers approval POST | Existing localhost-only CORS check + `idempotency-key` header requirement |
| Replay of a prior approval | Action ticket is one-time-use; `consumed_at` set atomically |
| Run state changes between display and click | `run_version` in ticket; server re-checks before executing |
| Session cookie theft | Tickets are short-lived; attacker must know the hash; localhost-only service |

---

## What Needs to Be Built

### 1. Approval API routes (new)

Two new endpoints the dashboard can call:

```
POST /api/v1/runs/{runId}/approve
  body: { stage: "plan"|"merge", bindingHash: string, runVersion: number, confirm: string }
  auth: bearer OR session (decide — see §4)

POST /api/v1/runs/{runId}/merge
  stays CLI-only in Phase 6B
```

Server-side flow on `approve`:
1. Load run + tasks, compute `approvalBinding(run, tasks, stage)`.
2. Compare result against `bindingHash` from client — reject if mismatch.
3. Verify `runVersion` matches current `run.version`.
4. Create and immediately consume an action ticket (or reuse existing ticket
   flow from `ApplicationCommands`).
5. Write the approval record and emit the approval event.

### 2. Binding hash preview route (new)

Before showing the modal the dashboard needs to display what the user is
approving:

```
GET /api/v1/runs/{runId}/approval-preview?stage=plan|merge
  returns: { bindingHash, summary: { ...human-readable fields } }
```

This is the server-computed hash — the modal must not display anything from the
proposal card itself.

### 3. Fingerprint modal UI (`src/dashboard/assets.ts`)

Triggered when a `approve_plan` or `approve_merge` fingerprint proposal card is
inspected. Shows:

- Action label and stage
- Run ID, goal, baseBranch, baseCommit
- For merge: integration commit, task diff hashes (summarised)
- The full binding hash in a monospace block
- Typed confirmation field: user must type the first 8 characters of the hash
- Submit button (disabled until prefix matches)

The modal must fetch data from `GET /approval-preview` — never from the
proposal `commandJson` or `summary` fields.

### 4. Session trust level decision

Current session auth (`duet_session` cookie) grants dashboard access but is
weaker than bearer token (no terminal access proof). Two options:

- **Option A** — require bearer token for approval POSTs (means dashboard
  session users cannot approve; they must use the CLI). Simplest; preserves
  the existing trust boundary.
- **Option B** — allow session approval with an extra step: the server sends a
  one-time challenge code via a side channel (e.g. printed to the `duetd` log),
  and the user must enter it in the modal. This proves terminal access without
  requiring bearer auth.

**Recommended: Option A first**, Option B as a follow-on once the modal UX is
validated.

### 5. Rate limiting failed attempts

Add a simple in-memory counter (keyed by `runId + stage`) that blocks
further approval attempts for 60 seconds after three consecutive failures.
Prevents brute-forcing the hash prefix.

---

## What Stays CLI-Only in Phase 6B

| Action | Reason |
|---|---|
| `merge_run` | Highest consequence; irreversible without a git revert; keep terminal-confirmed |
| Action ticket creation for CLI flows | Unchanged — CLI path must continue to work |

---

## Files to Touch

| File | Change |
|---|---|
| `src/service/server.ts` | Add `POST /runs/{id}/approve` and `GET /runs/{id}/approval-preview` routes |
| `src/application/commands.ts` | Expose browser-callable approve path (or reuse existing `approveRun`) |
| `src/application/integrity.ts` | No changes — `approvalBinding()` is already correct |
| `src/persistence/store.ts` | No changes — ticket lifecycle already correct |
| `src/dashboard/assets.ts` | Fingerprint modal HTML/CSS/JS, approval-preview fetch, typed-hash confirmation |
| `tests/chat-service.test.ts` | New tests: approval-preview returns correct hash; approve route verifies and rejects mismatches |

---

## Verification Checklist

- [ ] Approval with wrong hash prefix is rejected (400)
- [ ] Approval with stale `runVersion` is rejected (409)
- [ ] Approval with correct prefix succeeds and is idempotent (second identical
  request returns same result, not error)
- [ ] Consumed ticket cannot be replayed
- [ ] Proposal card `summary` or `commandJson` content is never rendered inside
  the approval modal
- [ ] `merge_run` proposal card still shows CLI-only message — no approve button
