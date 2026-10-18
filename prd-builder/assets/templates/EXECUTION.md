# Execution Protocol — {{PROJECT}}

How every PRD task is built, verified, committed, logged and — if needed — continued by hand.
Binding for humans and sub-agents alike. Integration branch: **`{{BRANCH}}`**.

## 1. Units of work

| Unit | Example | Meaning |
| --- | --- | --- |
| **Phase** | `P0` | Release-level outcome with exit criteria ([phases/](./phases)) |
| **Wave** | `P0-W2` | Tasks that can run in parallel (no shared files, dependencies met); an integration checkpoint |
| **Lane** | `Lane C` | Stream of related tasks that owns a set of files for a wave |
| **Task** | `P0-C03` | One concern, test first, **one commit** |

Task ids `<phase>-<lane><nn>`. Statuses: `todo`, `in_progress`, `review`, `done`, `blocked`, `deferred`.

## 2. Golden rules

1. **One task → one commit** on the wave branch (task branches are squashed at integration); the ledger update rides in it or in the next `chore(prd): record <id> commit [<id>]` commit.
2. **The gate decides.** `node scripts/prd/gate.mjs task --task <id> --base HEAD` must print `GATE PASSED` on the integrated result before the commit. FAIL blocks; WARN is recorded.
3. **Test first.** A source change without a test needs `--no-test-reason "<why>"`, recorded in the commit and wave log.
4. **Never weaken the bar.** No `--no-verify`, no skipped or deleted tests, no edits to `gate-baseline.json` except `gate.mjs baseline --update` (only tightens), no loosened lint rules.
5. **Stay in your lane.** Edit only the card's `files` (plus new tests/fixtures). Blocked only by ownership → apply the owner's widening rule if recorded in `workflow-log/decisions/`, otherwise stop and report.
6. **Independent verification** before `done`; unreviewed work is `review`.
7. **Small diffs** (< 400 changed lines per task).
8. **Push each integrated task immediately**; push every task branch before stopping.
9. **Log as you go**; keep [LOCAL-HANDOFF.md](./LOCAL-HANDOFF.md) current.

## 3. Branches and commits

```
{{BRANCH}} ──●─────────────────────────────●──▶      (one merge commit per wave PR)
              \                           ↑ merge commit
               prd/P0-W1 ──●──●──●──●──●──┘           (one squashed, gated commit per task)
                            ↑ squash
                 prd/P0-A01 (worktree)  prd/P0-A01-fix1
```

- Task branch `prd/<id>` from the wave tip (worktree). Fix rounds `prd/<id>-fix<n>`; re-implementation `prd/<id>-retry`.
- Wave branch `prd/<wave>`; one PR per wave into `{{BRANCH}}`; **merge with a merge commit** (never squash/rebase — ledger commit ids must stay valid).
- Local alias: the workflows integrate into a local branch named `{{BRANCH}}`; point it at the wave branch (`git switch -C {{BRANCH}} origin/prd/<wave>`) and push with `git push origin {{BRANCH}}:prd/<wave>`. Never push the alias to `origin/{{BRANCH}}`.

Commit message:

```
<type>(<scope>): <imperative summary> [<task-id>]

<what changed and why, 2–6 lines>

Findings: <ids or none>
Requirements: <ids or none>
Gate: task PASS — <one-line summary of the checks>
Reviewed: verifier APPROVE (<model>) | Not yet independently reviewed; status=review
Test waiver: <reason>            (only if used)
Widened: <files> (owner rule)    (only if used)
```

`type` ∈ `fix feat refactor test chore docs perf build ci revert`.

## 4. Gates

| Gate | When | Command | Blocking |
| --- | --- | --- | --- |
| **Task** | Before every commit (task branch, and again after the squash) | `node scripts/prd/gate.mjs task --task <id>` (`--base HEAD` after squash) | every configured task check (see `prd.config.json → gate.checks`) |
| **Wave** | After the last task of a wave | `node scripts/prd/gate.mjs task --base <wave start sha>` | all task checks over the wave diff |
| **Phase** | Phase exit | `node scripts/prd/gate.mjs phase` | phase checks (full suite, build, probe) + exit criteria |
| **Baseline** | After each phase | `node scripts/prd/gate.mjs baseline --update --full` | writes lower numbers only |

Report: `.prd-gate/report.md` (git-ignored); paste its table into the wave/phase log.
Blocking issues (do not commit): any gate FAIL; an unmet acceptance criterion; a new console error on a touched page; a data migration without rollback; an unresolved blocking verifier finding.

## 5. Lanes and file ownership

- A file appears in at most one task per wave. Shared hot spots are owned by one task or by the wave's integration task (lane `Z`).
- New files belong to the task that creates them.
- Strings for large locale files go to `workflow-log/pending-i18n/<task>.json`, merged by the integration task.
- Lockfile changes only in tasks with `deps_install: true`, at most one per wave.

## 6. Roles (sub-agents)

| Role | Isolation | Responsibility |
| --- | --- | --- |
| Orchestrator | Main checkout | Picks the wave, runs workflows, resolves blocked tasks, pushes, keeps the handoff current |
| Implementer | Worktree | Branch, failing test, implementation, task gate, commit on branch |
| Verifier | Worktree (detached) | Adversarial check of criteria, scope, test quality, regressions; runs the gate |
| Fixer | Worktree | One round on blocking findings |
| Integrator | Main checkout, one at a time | Squash, gate `--base HEAD`, commit, record, push |
| Logger | Main checkout | Wave log, PROGRESS, scorecard, cleanup |

Run a wave: `Workflow({ name: "prd-wave", args: { wave: "P0-W1", date: "<YYYY-MM-DD>", pushTo: "prd/P0-W1", maxParallel: 2 } })`.
Close a phase: `Workflow({ name: "prd-phase-exit", args: { phase: "P0", date: "<YYYY-MM-DD>" } })`.
Audit the scorecard: `Workflow({ name: "prd-scorecard", args: { date: "<YYYY-MM-DD>", phase: "P0" } })`.
Model policy: see the decision record in `workflow-log/decisions/`.

## 7. Logging

| File | Written | Content |
| --- | --- | --- |
| `workflow-log/PROGRESS.md` | After every integration (`prd.mjs progress`) | Status table, last commit, next runnable per lane |
| `workflow-log/<wave>-<date>.md` | End of each wave | Results, gate tables, verifier notes, deviations, blocked items, scorecard delta, next steps |
| `workflow-log/<phase>-phase-complete-<date>.md` | Phase exit | Exit criteria evidence, gate/probe reports, baseline before/after, deferred items |
| `workflow-log/decisions/<date>-<slug>.md` | Each decision / standing approval | Context, rule, conditions, applied, consequences |
| `SCORECARD.md` | After each wave and before phase exit | Requirements vs implementation |

## 8. Resuming manually (runbook)

1. `git switch {{BRANCH}} && git pull` (or the wave branch per LOCAL-HANDOFF.md).
2. `node scripts/prd/prd.mjs status`; read the newest wave log's *Next steps*.
3. `node scripts/prd/prd.mjs show <id>`.
4. `git switch -c prd/<id>`; failing test; implement; `node scripts/prd/gate.mjs task --task <id>` until PASS; commit.
5. Independent review against the card.
6. `node scripts/prd/prd.mjs integrate <id> prd/<id> --push-to prd/<wave>`.
7. Wave closed → wave log, `prd.mjs progress`, `prd.mjs scorecard --write`, push, mark the wave PR ready.

## 9. Handling problems

| Situation | Action |
| --- | --- |
| Gate FAIL on the task branch | Fix within the task; pre-existing and outside the lane → record and stop |
| Gate FAIL after squash | `git reset --hard HEAD`; mark `blocked` with the check ids; keep the branch |
| Merge conflict at integration | Resolve only mechanical conflicts; else abort, `blocked: conflict with <task>` |
| Verifier and implementer disagree after one fix round | `review`; escalate |
| Committed task is wrong | `git revert <sha>` (`revert: <summary> [<id>]`), status `todo`, log it |
| Flaky test | Rerun once alone to confirm; record; open a `Q` task; never retry until green |
| Spec ambiguity | Conservative option; record the question; decision task if it affects others |
| Owner overrides the process | Do it; record the deviation (status `review`, note, commit line, wave log) |
