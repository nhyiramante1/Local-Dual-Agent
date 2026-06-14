# Duet Orchestrator

Local, human-gated collaboration between Claude Code and OpenAI Codex for
trusted Git repositories.

## Capabilities

Duet plans a DAG of up to six bounded tasks, requires human plan approval, and
runs at most two isolated task worktrees concurrently. One task may use Claude
while one uses Codex; the opposite provider cross-reviews each staged canonical
diff. Overlapping file scopes receive deterministic dependency edges and never
run concurrently.

The supervisor owns staging, verification, commits, cherry-picks, final merge,
leases, process cancellation, and cleanup. Every task produces one reviewed
supervisor commit. Integration is deterministic and the source branch changes
only after explicit merge approval.

## Requirements

- Node.js 24 or newer
- Git
- Claude Code authenticated locally
- Codex CLI authenticated through `duet auth codex`

```powershell
npm install
npm run dev -- auth codex
npm run doctor:live
```

## Configuration

Copy `duet.example.toml` to `duet.toml`. Verification commands are argument
arrays executed with `shell: false`. They receive a stripped environment plus
only the static values in `[verification.env]`.

Provider limits are independent. Claude reports estimated dollar cost when
available. Codex dollar cost is always shown as unavailable; its input/output
token telemetry is enforced instead. Limits stop new turns while already
bounded turns finish.

## Workflow

```powershell
npm run dev -- plan --repo C:\path\to\repo "Implement the requested change"
npm run dev -- tasks RUN_ID
npm run dev -- approve RUN_ID --stage plan
npm run dev -- run RUN_ID
npm run dev -- status RUN_ID
npm run dev -- diff RUN_ID
npm run dev -- approve RUN_ID --stage merge
npm run dev -- merge RUN_ID
```

Recovery and operations:

```powershell
npm run dev -- resume RUN_ID
npm run dev -- resume RUN_ID --config C:\path\to\raised-limits.toml
npm run dev -- retry RUN_ID TASK_ID
npm run dev -- cancel RUN_ID
npm run dev -- cancel RUN_ID --task TASK_ID
npm run dev -- conflict RUN_ID
npm run dev -- resolve RUN_ID TASK_ID
npm run dev -- cleanup RUN_ID --force
```

Failed, cancelled, budget-paused, and conflicted worktrees are preserved.
Successful merges automatically remove managed worktrees and branches while
retaining SQLite history.

## Integrity Model

- The source repository must start clean and remain unchanged by read-only
  planner and reviewer turns.
- Scopes are exact paths or recursive `directory/**` ownership only.
- Additions, modifications, deletions, renames, copies, and type changes are
  checked; both rename/copy paths must be in scope.
- Patch-only output is checked by Git and scope/ignore policy before mutation.
- Ignored worker artifacts are rejected.
- Verification runs from a disposable materialization of the staged tree.
- Review targets the staged binary diff, tree ID, and SHA-256 hash.
- The supervisor commit must reproduce that exact tree and diff.
- Source movement rejects the final fast-forward merge.
- Structured responses require one exact marker envelope.

SQLite uses WAL, foreign keys, a five-second busy timeout, immediate
transactions, normalized attempts/tasks/leases, and durable raw/control
artifacts.

## Security Boundary

Repositories and configured verification commands are trusted in this version.
Agent output, patches, paths, and control messages are treated as untrusted.
Duet strips ambient provider/cloud/GitHub secrets from verification, but it is
not a container boundary. Use WSL, a VM, or a container before running
untrusted repositories or untrusted test commands.

No remote push, automatic conflict resolver, UI automation, credential
rotation, or usage-limit bypass is implemented.

## Development

```powershell
npm run check
npm test
npm run build
npm audit
```
