# 09 — Orchestration with sub-agents, and model/cost policy

How to run waves with parallel agents without them colliding, how to choose models and effort
per role, and how to survive usage limits.

## Contents
1. Roles
2. The wave workflow
3. Worktrees
4. Concurrency
5. Model and effort routing
6. Usage limits and resumption
7. Workflow arguments
8. When not to use a workflow

---

## 1. Roles

| Role | Runs as | Isolation | Responsibility |
| --- | --- | --- | --- |
| **Orchestrator** | Main session (or a human) | Main checkout | Picks the wave, launches workflows, handles blocked tasks, pushes, writes handoff, talks to the owner |
| **Loader** | Sub-agent | Read-only | Returns the wave's runnable task cards as JSON |
| **Implementer** | Sub-agent per task | Git worktree | Branch, failing test, implementation, task gate, commit on branch (push optional) |
| **Verifier** | Sub-agent per task | Worktree, detached at the task branch | Adversarial verdict (06) |
| **Fixer** | Sub-agent, max one round | Worktree | Resolves blocking findings |
| **Re-verifier** | Sub-agent, stronger model | Worktree | Second verdict |
| **Integrator** | Sub-agent, **strictly one at a time** | Main checkout | Squash, gate on `--base HEAD`, commit, record, push |
| **Logger** | Sub-agent | Main checkout | Wave log, PROGRESS, scorecard, branch cleanup |
| **Auditor / Skeptic** | Sub-agents | Worktree | Scorecard audit and phase-exit challenge |

## 2. The wave workflow

`.claude/workflows/prd-wave.js` (from `assets/workflows/`):

```
Load ─▶ for each task, in a pool of maxParallel:
          Implement ─▶ Verify ─approve─▶ Integrate (serial lock) ─▶ push
                         └changes_required─▶ Fix ─▶ Re-verify ─approve─▶ Integrate ─▶ push
                                                         └still rejected─▶ status review
       ─▶ Log (wave log, PROGRESS, scorecard, cleanup)
```

Integration happens **as soon as a task is approved**, behind a serial lock, and each integrated
task is pushed immediately (`pushTo`). Nobody waits for the slowest task to see results, and a
usage-limit stop loses at most the tasks in flight.

The integrator never resolves non-mechanical conflicts and never edits source; any conflict or
gate failure returns the task as blocked to the orchestrator.

## 3. Worktrees

- Each implementer/verifier/fixer gets a fresh worktree; dependencies are symlinked from the main checkout (`ln -s "$MAIN/node_modules" node_modules`) unless the task changes dependencies (`deps_install`), in which case it installs.
- Branches created in worktrees are visible to the main checkout (shared object store).
- Exclude the worktree folder from test discovery (e.g. `.claude/worktrees/**` in the test runner config) or the full suite runs every copy.
- The logger prunes worktrees and deletes local branches of integrated tasks; remote task branches are kept until the wave PR is merged (the owner deletes them if the environment cannot).

## 4. Concurrency

- Typecheck and the test suite dominate; plan **2 parallel tasks per 4 CPU cores / 8 GB RAM**. The runtime additionally caps concurrent agents.
- Integration is serial on purpose: each squash is gated against the real latest tip.
- Never commit in the main checkout while an integrator runs there — `git commit` takes whatever is staged. Make orchestrator commits from a separate worktree or between integrations.
- When two sessions (cloud and local) work on the same wave, agree on one integrator; if both integrated, keep the pushed commits and discard the local duplicates rather than rewriting pushed history, and log it.

## 5. Model and effort routing

The orchestrator stays on the strongest model the owner chose. Sub-agents are routed by role
and task size (`route()` in `prd-wave.js`; record the policy as a decision record):

| Role | S task | M task | L task |
| --- | --- | --- | --- |
| load, log, record, commit/push/command running | Haiku | Haiku | Haiku |
| exploration / lookups | Haiku | Haiku | Haiku |
| implement | Sonnet, low | Sonnet, medium | Sonnet, high |
| verify | Sonnet, high | Sonnet, high | **Opus**, medium |
| fix | Sonnet, high | Sonnet, high | **Opus**, medium |
| re-verify (after a rejection) | **Opus** | **Opus** | **Opus** |
| scorecard audit | Sonnet | Sonnet | Opus |
| phase-exit challenge | Opus | Opus | Opus |

Overrides: `opusTasks: ["P0-A05"]` forces Opus for a task's implement/verify/fix;
`models: { verify: { model: "opus", effort: "high" } }` overrides a role for the run.
Escalate a task to Opus when it is rejected twice for the same finding. Never use the cheapest
model to implement in a large typed codebase — the fix rounds cost more than they save.

The gate and the verifier decide what merges; model choice only changes cost and the number of
rounds.

## 6. Usage limits and resumption

Limits stop agents mid-task. Prepare for it:

- Push each integrated task immediately and push all task branches at every checkpoint.
- When a limit hits: commit any uncommitted worktree changes as `wip(<id>): ... (saved at usage limit)` on the task branch and push; update the handoff with each task's state.
- Resume a workflow with `resumeFromRunId` — completed agents replay from cache **only for the unchanged prefix**; anything after the first failed agent re-runs. If an implementer's result was lost but its branch exists, the re-run may create `prd/<id>-retry`; the original branch is still on origin.
- Resume an interrupted single agent by messaging it (it keeps its context) rather than starting a new one.
- Do not poll; workflows and background agents notify on completion.

## 7. Workflow arguments

`prd-wave`: `wave` (required), `date` (required — workflows cannot read the clock), `pushTo`
(wave branch; enables push per task), `only` (task ids), `maxParallel` (default 2),
`integrationBranch` (default from the loader: `prd.config.json`), `trailers`, `models`, `opusTasks`.

`prd-phase-exit`: `phase`, `date`, `push`, `trailers`.

`prd-scorecard`: `date`, `phase` (optional), `only` (requirement ids), `push`, `pushTo`.

## 8. When not to use a workflow

- One or two small tasks: do them by hand (manual runbook in 05) with one independent review agent.
- Merging already-reviewed branches: a plain shell loop (squash → gate → commit → push) costs no model tokens; `prd.mjs integrate` does it per task.
- Planning documents: write them yourself; use agents only for parallel research or audit sweeps.
