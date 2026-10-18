# Workflow Log Templates

File names: `<wave>-<YYYY-MM-DD>.md`, `<phase>-phase-complete-<YYYY-MM-DD>.md`,
`<phase>-phase-exit-attempt-<YYYY-MM-DD>.md`, `000-planning-<YYYY-MM-DD>.md`.
Logs are append-only: never rewrite an old log; write a new one that supersedes it.

---

## Wave log

```markdown
# <wave> — <focus>  (<date>)

**Operator:** <who/what> · **Start commit:** <sha> · **End commit:** <sha> · **Pushed:** yes/no · **PR:** <link>

## Result
| Task | Outcome | Commit | Tests added | Notes |
| --- | --- | --- | --- | --- |

## Gate summary (integration gate per task)
| Task | G1 | G2 | G3 related tests | G4 | G5–G7 |
| --- | --- | --- | --- | --- | --- |
| Wave gate (`--base <start>`) | | | | | |

## Verifier notes (non-blocking)
- <task>: <note> → follow-up task <id> | accepted (decision <link>)

## Waivers and deviations
- Test waivers · scope widenings · owner overrides · tooling problems · concurrent sessions

## Pending i18n files

## Blocked / needs review
| Task | Reason | Proposed resolution |
| --- | --- | --- |

## Scorecard delta
Must coverage <before> → <after> · newly Done: <ids> · new gaps: <ids>

## Next steps
1. `node scripts/prd/prd.mjs status` → next wave: <wave>
2. <exact commands>
```

---

## Phase completion

```markdown
# <phase> — <name> — phase complete (<date>)

**Commits:** <first>..<last> · **Tasks:** <done>/<total> done, <deferred> deferred · **Pushed:** yes/no

## Exit criteria
| Criterion | Met | Evidence (command → output) | Challenge |
| --- | --- | --- | --- |

## Phase gate
## Probe
## Scorecard (summary; SCORECARD.md at this commit)
## Baseline before → after
| Metric | Before | After |
| --- | --- | --- |
## Deferred tasks (owner, target phase)
## Lessons learned / process changes
## How to start the next phase
1. `node scripts/prd/prd.mjs status`
2. Refine the next phase's coarse tasks into full cards (files, acceptance, test).
3. `Workflow({ name: "prd-wave", args: { wave: "<P?-W1>", date: "<date>", pushTo: "prd/<P?-W1>" } })`
```

---

## Planning log

```markdown
# Planning — <product> (<date>)
## Produced      (audit, spec, PRD, phase plans, ledger, tooling — with commits)
## Decisions     (links to decision records)
## Open questions
## First wave to run
```
