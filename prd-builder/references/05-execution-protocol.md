# 05 — Execution protocol

`docs/prd/EXECUTION.md` in the project is the binding version of this file (the template is in
`assets/templates/EXECUTION.md`). This reference explains the reasoning so you can adapt it.

## Contents
1. Golden rules
2. Branch model (task → wave → integration)
3. The local alias trick and the stop-hook false alarm
4. The gate
5. Integration, step by step
6. Commit message format
7. Push policy
8. Handling problems
9. Manual runbook (no sub-agents)

---

## 1. Golden rules

1. One task → one commit on the wave branch (squash at integration). The ledger update rides in that commit or the next `chore(prd): record <id> commit [<id>]` commit.
2. The gate decides, on the integrated result, before the commit. FAIL blocks. WARN is recorded.
3. Test first; waivers are explicit (`--no-test-reason`) and recorded in the commit and wave log.
4. Never weaken the bar (tests, lint, baselines, ratchets, hooks).
5. Stay in the lane (card `files`); widen only under the owner's recorded rule.
6. Independent verification before `done`.
7. Small diffs (< 400 changed lines).
8. Log as you go; handoff always current.

## 2. Branch model

```
<integration> ──●─────────────────────────────●──▶   (merge commit per wave PR)
                 \                           ↑ PR merged with a MERGE COMMIT
                  prd/P0-W3 ──●──●──●──●──●──┘        (one squashed, gated commit per task)
                               ↑ squash
                    prd/P0-E04 (worktree)  prd/P0-E04-fix1
```

- **Task branch** `prd/<id>` from the current wave tip, inside an isolated worktree. Fix rounds `prd/<id>-fix<n>`; a re-implementation from scratch `prd/<id>-retry`.
- **Wave branch** `prd/<wave>` from the integration branch; one PR per wave into the integration branch.
- **Merge wave PRs with a merge commit**, never squash or rebase: the task commit ids recorded in the ledger and logs must stay valid, and the next wave may already be stacked on them.
- Push every task branch before stopping (they are the only copy of unreviewed work).

## 3. The local alias trick and the stop-hook false alarm

Workflows integrate into a branch with a fixed name (the integration branch name, e.g.
`consolidation`). To build a wave on its own branch, point the **local** integration branch at
the wave branch and push back to the wave branch:

```bash
git fetch origin && git switch -C consolidation origin/prd/P0-W3   # local alias only
# ... workflow integrates ...
git push origin consolidation:prd/P0-W3                              # never push the alias to origin/consolidation
```

Consequence: hooks or tools that compare the local branch with `origin/<same name>` will report
"N unpushed commits" for the whole wave. That is expected — verify with
`git log origin/prd/<wave>..consolidation` (should be empty) and explain it once; do **not**
push the alias to the real integration branch to silence it (that skips the PR and CI).
Alternative: configure `integrationBranch` in `prd.config.json` as a dedicated local name such
as `wave` and pass it to the workflows, so no alias is needed.

## 4. The gate

`scripts/prd/gate.mjs` compares the change against `gate-baseline.json`. Checks are configured in
`prd.config.json → gate.checks`; the defaults model what worked:

| Id | Check | Type | Typical command | Blocking rule |
| --- | --- | --- | --- | --- |
| G1 | Typecheck errors do not increase | `metric` | `npx tsc --noEmit` (count `error TS` lines) | value ≤ baseline |
| G2 | Static scanners do not increase | `metric` (one per section) | `node scripts/audit/contract-scan.cjs --json` | each value ≤ baseline |
| G3 | Related tests pass | `command` | `npx vitest related --run {changed}` / `pytest {changed_tests}` | exit 0 |
| G4 | Source changes include tests (TDD) | `tdd` | — | a changed source file needs a changed test file, or a waiver |
| G5 | No encoding damage added | `forbidden` | — | no added line contains mojibake sequences |
| G6 | No forbidden patterns added | `forbidden` | — | no added line matches e.g. `as any as`, `alert(`, `Number(.*[iI]d)` |
| G7 | Lint on changed files | `command` | `npx eslint {changed}` | exit 0 |
| P1–P3 | Phase only: full suite, production build, probe | `command`/`metric` | `npx vitest run`, `pnpm build`, probe | per baseline |

Design rules:

- **Ratchet, do not require zero.** Legacy debt is a baseline number; the gate fails only if the change makes it worse. Phase exits tighten the baseline (`baseline --update` writes only lower numbers).
- **Base resolution.** On a task branch the base is the merge-base with the local integration branch; on the integration branch after a squash the base is `HEAD` (uncommitted changes are the task). Always resolve the base to a full SHA before using it (shell quoting can eat `^` on Windows — this once made a gate silently diff `HEAD` against itself and skip every check while printing PASSED). If the diff is empty, the gate must say so loudly, not pass vacuously.
- **Related tests only** at task level (fast); the full suite runs at wave and phase level.
- **Report** to `.prd-gate/report.md` (git-ignored); paste the table into the wave log.
- Keep checks project-specific in config, not in code; the same `gate.mjs` serves any stack.

## 5. Integration, step by step

Strictly one task at a time, in the main checkout, on a clean tree:

```bash
git switch <integration>                       # the local alias of the wave branch
git status --porcelain --untracked-files=no     # must be empty
git merge --squash <task-branch>                # conflicts: resolve only mechanical ones, else reset and mark blocked
pnpm install --frozen-lockfile                  # only if the lockfile changed
node scripts/prd/gate.mjs task --task <id> --base HEAD     # must print GATE PASSED
node scripts/prd/prd.mjs set <id> done --date <d>          # or `review` if not independently verified
git add -A && git commit                        # message format §6
node scripts/prd/prd.mjs set <id> done --commit $(git rev-parse --short HEAD) --date <d>
git commit -am "chore(prd): record <id> commit [<id>]"
git push origin <integration>:prd/<wave>
```

`node scripts/prd/prd.mjs integrate <id> <branch> --push-to prd/<wave> [--unreviewed]` does all of
this portably (no shell-script line-ending problems on Windows) and stops at the first failure.
On gate FAIL after the squash: `git reset --hard HEAD` (discards only the uncommitted squash),
mark the task `blocked` with the failing check ids, keep the branch.

## 6. Commit message format

```
<type>(<scope>): <imperative summary> [<task-id>]

<what changed and why, 2–6 lines>

Findings: SO-01, SO-02
Requirements: FR-01
Gate: task PASS — G1 2841/3056 · G2 ≤ baseline · G3 94 files/672 tests · G4 2 test files · G5–G7 PASS
Reviewed: verifier APPROVE (opus) | Not yet independently reviewed (owner request); status=review
Test waiver: <reason>          # only when used
Widened: <file> (owner's scope-widening rule)   # only when used

<trailers required by the environment, e.g. Co-Authored-By>
```

`type` ∈ `fix feat refactor test chore docs perf build ci revert`.

## 7. Push policy

- Push each task as soon as it is integrated (to the wave branch), not at the end of the wave.
- Push every task branch (`git push origin prd/<id>`) when a session stops, including unreviewed and blocked ones; list them in the handoff with their state.
- Never force-push a shared branch. On your own task branch, `--force-with-lease=<branch>:<expected-sha>` is acceptable (e.g. folding an emergency save).
- Emergency saves before a usage limit: commit work-in-progress on the task branch (`wip(<id>): ... (saved at usage limit)`), push, and note it in the handoff; the next session replaces it with a proper commit.

## 8. Handling problems

| Situation | Action |
| --- | --- |
| Gate FAIL on the task branch | Fix within the task; if pre-existing and outside the lane, record evidence and stop (blocked) |
| Gate FAIL after squash | `git reset --hard HEAD`, mark `blocked` with the check ids, keep the branch |
| Blocked only by file ownership | Apply the owner's widening rule (decision record) if it exists: widen, gate, note it; otherwise report |
| Test in another lane encodes the old behaviour | Same as above — move the test's seed/fixture to the new path without weakening assertions; record the widening |
| Merge conflict at integration | Resolve only mechanical conflicts; otherwise abort, mark `blocked: conflict with <task>`, reschedule |
| Verifier and implementer disagree after one fix round | Mark `review`; escalate with both arguments |
| Committed task turns out wrong | `git revert <sha>` (`revert: <summary> [<id>]`), status back to `todo`, log it |
| Flaky test | Never retry until green silently; rerun once alone to confirm, record it, open a `Q` task |
| Stale gate base | Pass `--base <integration>` explicitly (or fix the base resolution — it is a gate bug) |
| Spec ambiguity | Choose the conservative option, record the question in the wave log, open a decision task if it affects others |
| Owner overrides the process | Do it, record the deviation (status `review`, note, commit line, wave log) |

## 9. Manual runbook (no sub-agents)

1. `git switch <integration> && git pull`
2. `node scripts/prd/prd.mjs status` and read the newest wave log's *Next steps*.
3. `node scripts/prd/prd.mjs show <id>`.
4. `git switch -c prd/<id>`; write the failing test; implement; `node scripts/prd/gate.mjs task --task <id>` until PASS; commit on the branch.
5. Ask an independent reviewer (another session/model or a human) to verify against the card (06).
6. Integrate (§5).
7. When the wave is closed: wave log (08), `prd.mjs progress`, `prd.mjs scorecard --write`, push, mark the wave PR ready.
