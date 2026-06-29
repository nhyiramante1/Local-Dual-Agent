# Local Dual Agent

Local Dual Agent is a local coding orchestrator that lets Claude Code and
OpenAI Codex work together on a Git repository while you stay in control.

You give it a goal. It asks one agent to plan, splits the work into bounded
tasks, sends tasks to Claude and Codex in isolated worktrees, runs your tests,
has the opposite agent review the work, and waits for your approval before
important steps like starting execution and merging.

The project is Windows-first and runs locally. macOS and Linux portability are
considered, but Windows is the main development target right now.

## What It Can Do Today

- Plan a coding task in an existing local Git repository.
- Split work into up to six small tasks.
- Run up to two implementation tasks at once.
- Use Claude Code and Codex as workers and reviewers.
- Keep task work isolated in managed Git worktrees.
- Run your configured test/build commands before accepting work.
- Show status, tasks, logs, diffs, conflicts, budgets, and artifacts.
- Require human approval before executing a plan and before final merge.
- Pause safely for budget limits, failed tests, conflicts, or cancellation.
- Resume, retry, cancel, clean up, and inspect previous runs.
- Provide a local browser dashboard for inspection, manager chat, and starting
  ordinary proposal actions.
- Provide a restricted MCP bridge so Claude Code or Codex can inspect Duet
  runs and start bounded planning operations.
- Run manager chat through several voices (GLM by default, plus Groq, Gemini,
  OpenAI, Claude, or Codex), switchable per conversation.
- Request operator-approved, read-only consultations from Claude or Codex whose
  replies appear inline in the manager chat.
- Show a live working indicator (current tool call and its result) while a
  manager turn runs, with a Stop button scoped to that turn.
- Store local durable history so runs can survive service restarts.

Manager chat is available now. The dashboard can run global or run-scoped
manager conversations with summarized run, task, usage, event, verification,
and message context. It can also show suggested Duet action cards. Ordinary
suggestions can be checked and started from the dashboard after you type a
confirmation. You can also clear the current context to start a fresh thread
for the same run and manager voice without deleting history. Fingerprint-gated
approvals and merge still stay in the CLI.

The manager can also recommend provider and profile strategy based on current
usage and availability, and create plan proposals from natural language in
global chat. You can say something like "create a plan to add dark mode, repo
is at C:\path\to\project" and the manager will synthesize a ready-to-start
proposal card with the correct CLI command pre-filled.

The manager voice is configurable. By default it uses GLM, a low-cost
OpenAI-compatible model with reliable native tool calling. You can switch per
conversation to Claude, Codex, Groq, Gemini, or real OpenAI. Using an
OpenAI-compatible identity (GLM/Groq/Gemini) lets you run ordinary conversation
without consuming Claude or Codex worker quota.

When you create a plan through chat, the manager carries the full conversation
thread forward — your last few messages are included as context so the planner
agent understands the discussion, not just the final instruction.

The manager can also request a read-only consultation from Claude or Codex: it
creates a consent card, and after you approve it each agent inspects the
repository read-only and its reply appears inline in the chat. Consultations
cannot run shell commands or modify files — they are read-only repository
reasoning only, so they answer "is this approach sound?", not "is this service
running?".

While a manager turn runs, the dashboard shows a live working indicator with the
actual tool calls and their results as they happen, plus a Stop button that
cancels the current manager turn without affecting any background runs.

## What It Does Not Do Yet

- No automatic conflict resolver.
- No remote/cloud service.
- No support for untrusted repositories as a security sandbox.
- No attempt to bypass provider limits or share credentials between providers.

## Requirements

- Node.js 24
- Git
- Claude Code installed and signed in locally
- OpenAI Codex installed and signed in locally
- A clean local Git repository you want the agents to work on

Node 25 is intentionally not supported yet.

## Install

From this repository:

```powershell
npm install
npm run build
```

During development you can run commands with:

```powershell
npm run dev -- COMMAND
```

For the common local-phone workflow, `npm run up` rebuilds, restarts the
service, and opens the phone-friendly persistent dashboard URL automatically.

After building, you can run:

```powershell
node dist/cli.js COMMAND
```

Examples below use `npm run dev --` because it works directly from source.

## Prepare A Project For Duet

Go to the project you want Claude and Codex to work on.

1. Make sure the project is a Git repository.
2. Commit or stash your own work so the repository is clean.
3. Copy `duet.example.toml` from this repo into the target project as
   `duet.toml`.
4. Edit `duet.toml` so the verification commands match that project.

For example, a Node project may use:

```toml
[verification]
setup_commands = [
  ["npm", "ci", "--ignore-scripts"],
]
commands = [
  ["npm", "test"],
  ["npm", "run", "build"],
]
```

Verification commands should be the checks you trust before accepting code.

## Check Your Setup

Run:

```powershell
npm run dev -- doctor
```

For a live provider check:

```powershell
npm run dev -- doctor --live
```

The live check can use Claude/Codex quota because it contacts the providers.

## Start The Local Service

The CLI can start the local service automatically, but you can also manage it
yourself:

```powershell
npm run dev -- service start
npm run dev -- service status
```

Stop it with:

```powershell
npm run dev -- service stop
```

If an operation is active, graceful stop will refuse. Use force only when you
intend to cancel active work:

```powershell
npm run dev -- service stop --force
```

## Create A Plan

Run:

```powershell
npm run dev -- plan --repo C:\path\to\your\project --lead codex "Add the requested feature"
```

You can use either lead:

```powershell
--lead codex
--lead claude
```

The lead plans the work. The supervisor still controls task limits,
permissions, budgets, verification, and final integration.

When planning finishes, Duet prints a run ID. Keep that ID for the next steps.

## Review The Plan

List all runs:

```powershell
npm run dev -- status
```

Inspect one run:

```powershell
npm run dev -- status RUN_ID
```

See its task list:

```powershell
npm run dev -- tasks RUN_ID
```

Open the dashboard:

```powershell
npm run dev -- dashboard RUN_ID
```

For a phone-friendly reusable dashboard link that survives local restarts, use:

```powershell
npm run dev -- dashboard --phone
```

The dashboard URL is local and temporary. Paste it into your browser. The
dashboard can inspect runs and start ordinary Manager proposal actions. Plan
approval, merge approval, and merge still happen in the terminal.

## Approve And Run

Approve the plan:

```powershell
npm run dev -- approve RUN_ID --stage plan
```

Duet prints a fingerprint and asks you to type `plan`. This is intentional:
agents cannot approve plans through MCP, and accidental approval should be
harder than a stray command.

Start execution:

```powershell
npm run dev -- run RUN_ID
```

By default the command waits and streams operation status. To start work and
return immediately:

```powershell
npm run dev -- run RUN_ID --detach
```

Then inspect progress with:

```powershell
npm run dev -- status RUN_ID
npm run dev -- tasks RUN_ID
npm run dev -- logs RUN_ID
```

## Review The Result

Show the final diff:

```powershell
npm run dev -- diff RUN_ID
```

If Duet reports a conflict:

```powershell
npm run dev -- conflict RUN_ID
```

After you resolve the conflict manually in the managed integration worktree,
ask Duet to validate and continue:

```powershell
npm run dev -- resolve RUN_ID TASK_ID
```

## Approve And Merge

Approve the merge:

```powershell
npm run dev -- approve RUN_ID --stage merge
```

Then merge:

```powershell
npm run dev -- merge RUN_ID
```

Merge approval also requires a typed confirmation. Duet checks that the work
being merged is still the reviewed work.

## Recovery Commands

Resume a paused or interrupted run:

```powershell
npm run dev -- resume RUN_ID
```

Retry one failed task:

```powershell
npm run dev -- retry RUN_ID TASK_ID
```

Cancel a run:

```powershell
npm run dev -- cancel RUN_ID
```

Cancel one task:

```powershell
npm run dev -- cancel RUN_ID --task TASK_ID
```

Clean up managed worktrees and branches:

```powershell
npm run dev -- cleanup RUN_ID
```

Force cleanup only when you are sure preserved failed/cancelled work is no
longer needed:

```powershell
npm run dev -- cleanup RUN_ID --force
```

Successful merges clean up managed task worktrees automatically.

## Claude Code And Codex MCP

The MCP bridge lets Claude Code and Codex inspect Duet state from their own
sessions. It also lets them start a bounded planning operation. They cannot
approve, run, cancel, resolve, clean up, or merge through MCP.

Build first:

```powershell
npm run build
```

Install for both Claude Code and Codex:

```powershell
node dist/cli.js mcp install all
```

Check status:

```powershell
node dist/cli.js mcp status all
```

Uninstall:

```powershell
node dist/cli.js mcp uninstall all
```

After install or uninstall, restart or reload Claude Code and Codex.

## Dashboard

Open:

```powershell
npm run dev -- dashboard RUN_ID
```

The dashboard currently focuses on inspection:

- service health
- run status
- task progress
- provider assignment
- usage and budget state
- recent events
- verification results
- review results
- diffs
- logs
- artifacts
- conflicts
- approval state

The manager-chat panel can explain what is happening globally or in a selected
run and may show suggested Duet action cards. You can check whether a
suggestion still looks current, copy the command, dismiss the card, or start an
ordinary operation after typing `start`.

Runs in the sidebar that have finished (failed, cancelled, merged, cleaned up)
show a static timeline — no live event stream for completed work. Active runs
stream events live. Terminal runs can be deleted with the × button on their
card; only finished runs are eligible.

The manager voice is selected per conversation and defaults to the provider set
in `duet.toml` (GLM by default). Options include `glm`, `groq`, `gemini`,
`openai`, `claude`, and `codex`. Using an OpenAI-compatible identity
(`glm`/`groq`/`gemini`) lets you run manager chat without touching Claude or
Codex worker quota.

Note: groq/llama models often fail to form valid tool calls ("could not form a
valid tool call"). GLM and Gemini are more reliable for tool-using manager chat
— consultations, plan proposals, and file search.

For a stable phone + Termius workflow during development, you can pin the local
service to one port and reuse the same dashboard access link. For direct phone
access over the same Wi-Fi, let the service bind on all interfaces:

```toml
[service]
host = "0.0.0.0"
port = 58208

[dashboard]
persistent_access = true
```

Then either:

- open the printed `http://<your-lan-ip>:58208/#access=...` URL directly from
  your phone browser, or
- keep one Termius forward such as `8080 -> 127.0.0.1:58208` and reuse the
  same `#access=...` URL through the tunnel, or
- for access from anywhere (cellular, other networks), put this PC and your
  phone on a Tailscale tailnet and open
  `http://<this-PC-tailnet-ip>:58208/#access=...` from the phone.
  `setup-tailscale.ps1` automates the one-time PC install and sign-in; you may
  need a Windows Firewall inbound rule for the port.

Manager chat may use provider quota when you send a message. If you are using
Claude or Codex as the manager voice, treat it like a real provider turn. Using
an OpenAI-compatible endpoint such as Groq avoids this. The manager can suggest
ordinary actions that you may start from the dashboard, but fingerprint-gated
actions stay in the terminal.

Plan approval, merge approval, and merge still happen through the ordinary Duet
CLI. Fingerprint-gated actions still require terminal confirmation and are not
started by the dashboard.

### Manual Dashboard Chat Smoke Check

Before relying on a new dashboard-chat build with real providers, try one small
local run and confirm:

- A real manager reply appears after normal provider latency.
- Provider or budget failures show a readable error.
- The repository remains unchanged after a read-only manager chat turn.
- Typing `/approve plan`, `/run`, `/merge`, or `/cancel` sends plain chat text
  and does not perform those actions.
- Refreshing or briefly disconnecting the browser does not duplicate timeline
  events.

## Manager Provider Setup

The manager voice defaults to GLM. Native OpenAI-compatible identities (`glm`,
`groq`, `gemini`) each enable automatically when their API key is present. Set
the default in `duet.toml` in the Duet project root:

```toml
[manager]
provider = "glm"   # glm | groq | gemini | openai | claude | codex
```

Then create a `.env` file in the same directory with the keys for whichever
identities you want enabled:

```
ZAI_API_KEY=your_glm_key_here
GROQ_API_KEY=your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
```

The service loads `.env` automatically on startup. The file is gitignored and
never committed. If the configured default provider has no key, Duet falls back
to an available one.

To use real OpenAI, set `provider = "openai"` and `OPENAI_API_KEY` (leave
`openai_base_url` unset for api.openai.com).

To use Codex or Claude as the manager, set `provider = "codex"` or
`provider = "claude"`. These use your local CLI logins, but Duet keeps an
isolated Codex credential store — authenticate it once with
`node dist/cli.js auth codex`. A 401 from Claude usually means the Claude CLI's
headless token is stale; re-login with `claude` then `/login`. Run
`node dist/cli.js doctor --live` to confirm both providers actually answer.

## Practical Tips

- Start with small goals. Duet is strongest when work can be split into clear
  bounded tasks.
- Keep your repository clean before planning.
- Keep `duet.toml` verification commands realistic. If your tests are slow or
  flaky, Duet will feel slow or flaky too.
- Use `--detach` for long operations, then watch with `status`, `tasks`, logs,
  or the dashboard.
- Use Codex or Claude as the planning lead depending on which one you want to
  shape the initial task breakdown.
- Use MCP for inspection and planning from agent sessions, but keep approvals
  in your own terminal.

## Safety Notes

Local Dual Agent is built for trusted local repositories. It is not a sandbox
for malicious code. If you do not trust a repository or its test commands, run
it in a VM, container, or other isolated environment.

Duet treats agent output as untrusted and requires human approval for major
steps, but an agent with unrestricted same-user shell access can still do
whatever that user can do. The approval flow is an operator-intent safeguard,
not a cryptographic proof of human presence.

## Development Checks

For contributors:

```powershell
npm run check
npm test
npm run build
npm run test:dashboard
npm audit
```

`npm run test:dashboard` launches a local browser smoke test. If Chromium is not
installed for Playwright, run:

```powershell
npx playwright install chromium
```

Keep this README updated as new user-visible features land, especially the
manager-chat dashboard, manager provider options, dashboard controls, stronger
approval options, and app packaging.
