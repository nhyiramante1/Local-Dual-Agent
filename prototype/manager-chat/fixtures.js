/*
 * Embedded fixture data for the manager-chat prototype.
 *
 * Loaded via a classic <script> tag (NOT type="module") so the prototype works
 * when index.html is opened directly through file:// with no server and no
 * fetch(). All values here are illustrative — nothing talks to a real service.
 */
window.DUET_FIXTURES = {
  run: {
    id: "run-2026-06-14-7f3a",
    goal: "Add a /healthz endpoint and a unit test",
    status: "running",
    version: 7,
    baseBranch: "main",
    baseCommit: "a91c4e0",
    integrationBranch: "duet/run-2026-06-14-7f3a/integration",
  },

  // Four INDEPENDENT roles. /switch only ever changes `interface`.
  roles: {
    interface: "claude", // who voices the Manager
    planner: "claude",
    implementer: "codex",
    reviewer: "claude",
  },

  tasks: [
    {
      id: "task-1",
      title: "Add /healthz route handler",
      status: "integrated",
      provider: "codex",
      reviewer: "claude",
      allowedPaths: ["src/server/**"],
    },
    {
      id: "task-2",
      title: "Add /healthz unit test",
      status: "reviewing",
      provider: "codex",
      reviewer: "claude",
      allowedPaths: ["tests/**"],
    },
    {
      id: "task-3",
      title: "Document the endpoint in README",
      status: "ready",
      provider: "claude",
      reviewer: "codex",
      allowedPaths: ["README.md"],
    },
  ],

  // Seed timeline; the app appends to this as you issue commands.
  events: [
    { occurredAt: "09:41:02", type: "run.created", severity: "info" },
    { occurredAt: "09:41:18", type: "run.plan_ready", severity: "info" },
    { occurredAt: "09:42:05", type: "approval.recorded", severity: "info" },
    { occurredAt: "09:42:06", type: "provider.attempt_started", severity: "info" },
    { occurredAt: "09:43:31", type: "integration.completed", severity: "info" },
    { occurredAt: "09:44:10", type: "verification.completed", severity: "warning" },
  ],

  // Fingerprints shown on STRONG-tier proposal cards (mirrors the real
  // /approval-fingerprint response shape: { stage, fingerprint, version }).
  fingerprints: {
    plan: "f3a9c1d4e2b87605",
    merge: "7b2e9a4c1f06d3a8",
  },

  verification: [
    { passed: true, command: ["npm", "run", "build"], durationMs: 4120 },
    { passed: false, command: ["npm", "test"], durationMs: 18840 },
  ],

  messages: [
    { kind: "plan", body: "3 tasks derived: route handler, unit test, README update." },
    { kind: "review", body: "task-1 approved by claude after 1 revision." },
  ],

  diff:
    "### task-1: Add /healthz route handler\n" +
    "+ app.get('/healthz', (_req, res) => res.status(200).send('ok'));\n",

  // Scripted Manager replies keyed by command/intent. {agent} is replaced with
  // the current interface agent's name at render time.
  replies: {
    status:
      "Run is `running` at version 7. task-1 integrated, task-2 in review, task-3 ready.",
    tasks: "3 tasks — see the rail. task-2 is the only one mid-review right now.",
    diff: "Latest reviewed diff is for task-1 (the route handler).",
    logs: "2 messages so far: the plan summary and task-1's review note.",
    plan_done: "Drafted a fresh plan from your goal. Review it, then approve when ready.",
    run_done: "Execution requested. I'll surface provider turns here as they happen.",
    resume_done: "Resume requested — reusing existing checkpoints where possible.",
    retry_done: "Retry requested for the task.",
    resolve_done: "Resolve requested — re-running integration for the task.",
    cancel_done: "Cancellation requested. The supervisor will wind down active work.",
    cleanup_done: "Cleanup requested — worktrees and integration branch will be removed.",
    approve_plan_done: "Plan approval recorded against the fingerprint above.",
    approve_merge_done: "Merge approval recorded against the fingerprint above.",
    merge_done: "Final merge requested against the approved fingerprint.",
    unknown:
      "I can run reads (status, tasks, diff, logs), propose actions (plan, run, " +
      "resume, retry, cancel, cleanup), or gate approvals (approve plan, approve " +
      "merge, merge). Type /help for the full list.",
  },
};
