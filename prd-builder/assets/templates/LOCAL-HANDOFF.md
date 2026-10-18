# Continuing the PRD (local machine or a new session)

Everything needed is in the repository. Start with §0, then the newest file in
[`workflow-log/`](./workflow-log).

## 0. Current state (updated at every checkpoint)

_Last update: {{DATE}} — planning complete; no wave started._

### <wave> — START HERE
Branch **`prd/<wave>`** (PR <link>, draft) = `{{BRANCH}}` + <wave> work so far. Merge wave PRs with a **merge commit** only.
Nothing is running.

| Task | State | Branch / commit (on origin) | Next action |
| --- | --- | --- | --- |
| P0-A01 | todo | — | run the wave |

Gate base: <caveats, e.g. "pass --base {{BRANCH}} until the wave PR is merged">

Local steps:
```bash
git fetch origin && git switch -C {{BRANCH}} origin/prd/<wave>   # local alias the workflow integrates into
<install command>
node scripts/prd/prd.mjs wave <wave>
```
Run: `Workflow({ name: "prd-wave", args: { wave: "<wave>", date: "<YYYY-MM-DD>", pushTo: "prd/<wave>", maxParallel: 2 } })`
Integrate an approved branch by hand: `node scripts/prd/prd.mjs integrate <id> origin/prd/<id> --push-to prd/<wave>`
When the wave is done: wave log → `prd.mjs progress` → `prd.mjs scorecard --write` → push → mark the PR ready → merge (merge commit).

## 1. One-time setup

| Need | Version / note |
| --- | --- |
| Node.js | ≥ 18 (for scripts/prd) |
| <package manager / runtime> | <version> |
| Claude Code | run from the repo root so `.claude/workflows/` is found |
| Browser (probe only) | <path or env var> |

```bash
git clone <repo> && cd <repo>
<install>
node scripts/prd/gate.mjs task --base HEAD --allow-empty   # must print GATE PASSED
node scripts/prd/prd.mjs status
```

## 2. Rules that held (keep them)

- One squashed commit per task; gate before every commit; independent verifier before `done`.
- <link each standing approval in workflow-log/decisions/>
- Never commit in the main checkout while an integrator is working there.
- Merge wave PRs with merge commits.

## 3. Things that went wrong (avoid them)

- <append as they happen>
