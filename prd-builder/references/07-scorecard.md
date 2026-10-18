# 07 — The scorecard: requirements vs implementation

`docs/prd/SCORECARD.md` answers "what is done, partial, missing — and how do we know?" It is
**generated** by `node scripts/prd/prd.mjs scorecard --write` from the ledger (and optionally
the PRD and audit Markdown), so it can never drift from the source of truth. Never edit it by
hand; change the ledger or record verification instead.

## Contents
1. Inputs
2. Status vocabulary
3. Task credit
4. Requirement status rules
5. Scores
6. Findings and exit criteria
7. Evidence rules (what counts)
8. The independent audit (`prd-scorecard` workflow)
9. Reading the output and acting on it
10. Worked example

---

## 1. Inputs

| Source | Used for | Where |
| --- | --- | --- |
| `tasks.json → tasks[]` | status, size, `reqs`, `findings`, `acceptance`, `commit`, `verification` | always |
| `tasks.json → requirements[]` | requirement id, title, priority, phase range, acceptance | if present |
| PRD tables (`docs/prd/README.md`) | same, parsed from rows whose first cell is `FR-nn` / `NFR-nn` | fallback (`prd.config.json → requirementsSource`) |
| `tasks.json → findings[]` or audit headings `#### SO-01 · …` | finding closure | optional (`findingsSource`) |
| `tasks.json → phases[].exit_criteria / exit_results` | phase exit status | always |
| `tasks.json → verification.requirements` | auditor's requirement-level verdicts | written by `verify-import` |

## 2. Status vocabulary

**Requirement:**

| Status | Meaning |
| --- | --- |
| **Done** | Every mapped task is `done` **and verified**, every criterion `met`, and the requirement's last phase is covered by mapped tasks (or an auditor confirmed it) |
| **Partial** | Some credit: some mapped tasks done, or done but unverified, or criteria partial, or later phases of a ranged requirement still open |
| **Missing** | Zero credit although it is due: its phase is complete, a mapped task's wave is already closed/passed, or a mapped task is blocked |
| **Not started** | Zero credit and not yet due (scheduled in a later wave/phase) |
| **Deferred** | All mapped tasks deferred (with owner) |
| **Unmapped** | No task references it — a planning gap; counts as zero coverage |

**Acceptance criterion:** `met`, `partial`, `missing`, `unverified` (could not be checked; why
must be stated). **Task:** the ledger status plus a *verified* flag.

"Done but unverified" is never Done. That one rule is what keeps the scorecard honest when
work is merged in a hurry.

## 3. Task credit

| Task state | Credit |
| --- | --- |
| `done` + verification with criteria | mean of criteria (met 1, partial 0.5, unverified 0.5, missing 0) |
| `done` + verification verdict `approve`, no criteria | 1 |
| `done` without verification, or `review` | 0.5 |
| `in_progress` | 0.25 |
| `todo`, `blocked` | 0 |
| `deferred` | excluded |

Weights by size: S 1, M 2, L 3 (so one large task is not outvoted by two trivial ones).

## 4. Requirement status rules

```
mapped   = tasks whose reqs include the requirement (not deferred)
if no task references it:            status = all-deferred ? Deferred : Unmapped
credit   = Σ weight·taskCredit / Σ weight
if auditor verdict exists:           status = auditor verdict (derived status shown alongside; disagreement flagged)
elif credit == 1 and covers last phase:  Done
elif credit > 0:                     Partial
elif due:                            Missing
else:                                Not started
```

*Covers last phase*: for a ranged requirement (`P0→P2`), at least one mapped task belongs to the
last phase of the range; otherwise P0 work alone can only reach Partial.
*Due*: the requirement's first phase is complete, or a mapped task sits in a wave earlier than
the phase's open wave, or a mapped task is blocked.

## 5. Scores

- **Weighted coverage** = Σ priorityWeight·credit / Σ priorityWeight over non-deferred requirements (Must 3, Should 2, Could 1; Unmapped contributes 0).
- **Must coverage** = same over Must requirements only. This is the number to quote to owners.
- **Status counts** per priority and per phase.
- `--phase P0` restricts to requirements whose range includes P0 and to P0 tasks — a phase scorecard.

Scores measure *verified delivery against requirements*, not effort. A phase can be 90 % of
tasks done and 60 % Must coverage — that gap is the point.

## 6. Findings and exit criteria

- Finding **Closed**: all mapped tasks done and verified. **Closed (unverified)**: done but some unverified. **Partial**: some done. **Open**: none done. **Unmapped**: no task.
- Exit criteria: taken from `phases[].exit_results` (written by `prd-phase-exit` or by hand with evidence). Without results they show **Not assessed** — which is itself a signal before a phase exit.

## 7. Evidence rules (what counts)

| Strong evidence | Weak / not evidence |
| --- | --- |
| Named test that fails on the base and passes on the commit | "Tests pass" with no names |
| Probe/scan check id with PASS output and environment | "Works on my machine" |
| Gate table from the integrated commit | Gate run against a stale or empty base |
| Measured number vs threshold (benchmark output) | "Fast enough" |
| `file:line` showing the behaviour, plus a test | Implementer's own summary |

Every `met` in the ledger must carry an evidence string. Auditors write `unverified` rather
than `met` when they cannot run the check, and say what is needed (browser, data, credentials).

## 8. The independent audit (`prd-scorecard` workflow)

```
Workflow({ name: "prd-scorecard", args: { date: "<YYYY-MM-DD>", phase: "P0", only?: ["FR-01"] } })
```

1. **Load** (cheap model): requirements, mapped tasks, criteria.
2. **Audit** (one agent per requirement, read-only, worktree at the integration tip): read the
   code paths and tests for each mapped task's criteria, run the named tests/probe checks,
   grade each criterion `met/partial/missing/unverified` with evidence, and grade the
   requirement as a whole.
3. **Challenge** (stronger model, only for Must requirements graded Done): try to refute.
4. **Record** (one agent): write `docs/prd/verification/<date>.json`, run
   `prd.mjs verify-import`, `prd.mjs scorecard --write`, commit
   `docs(prd): scorecard <date> [<phase>]`, push if asked.

Cost control: Haiku for load/record, Sonnet for audits of S/M-only requirements, Opus for the
challenge and for requirements with L tasks (see 09).

## 9. Reading the output and acting on it

The **Gaps** section is the action list, in this order:

1. Must requirements Missing or Unmapped → add or schedule tasks (planning gap) or fix blocked ones.
2. Must requirements Partial → find the missing criterion; usually a follow-up task.
3. Done-but-unverified tasks → run reviews (cheap, high value).
4. Open P0/P1 findings.
5. Exit criteria not assessed or not met before a phase exit.

Commit the regenerated scorecard with every wave log so its history shows the trend.

## 10. Worked example

| Req | Priority | Mapped tasks | Credit | Status |
| --- | --- | --- | --- | --- |
| FR-01 persistence | Must, P0 | A01 (L, done, verified 3/3 met) | 1.00 | **Done** |
| FR-04 setup wizard | Must, P0→P2 | A04 (M, done+verified), A05 (L, done+verified) | 1.00 | **Partial** — P2 not covered yet |
| FR-14 report cards | Must, P0→P2 | F05 (L, done, unverified) | 0.50 | **Partial** — needs review |
| FR-19 statements | Should, P3 | (none) | 0 | **Unmapped** — planning gap |
| FR-24 localisation | Should, P5 | P5-L01 (todo) | 0 | **Not started** |

Must coverage here = (3·1 + 3·1 + 3·0.5) / 9 = 83 %; but only 1 of 3 Must requirements is Done.
