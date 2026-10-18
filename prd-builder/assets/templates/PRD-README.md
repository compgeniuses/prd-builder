# {{PROJECT}} — Product Requirements Document (PRD)

**Version:** 0.1 · **Date:** {{DATE}} · **Owner:** <owner> · **Status:** Draft
**Derived from:** [Specification](../specs/README.md) · [Audit](../audit/README.md) (if any)

| Companion documents | Purpose |
| --- | --- |
| [EXECUTION.md](./EXECUTION.md) | How work is run: branches, one commit per task, gates, lanes, sub-agents, resuming |
| [phases/](./phases) | One plan per phase: waves, lanes, tasks, file ownership, exit gates |
| [tasks.json](./tasks.json) | Machine-readable ledger (source of truth for status) |
| [SCORECARD.md](./SCORECARD.md) | Generated requirements-vs-implementation scorecard (`node scripts/prd/prd.mjs scorecard --write`) |
| [LOCAL-HANDOFF.md](./LOCAL-HANDOFF.md) | Where work stopped and the exact next commands |
| [workflow-log/](./workflow-log) | Append-only wave/phase logs, decisions; `PROGRESS.md` shows where we are |
| `scripts/prd/gate.mjs`, `scripts/prd/prd.mjs` | Gate and ledger tools |

---

## 1. Problem

<What is wrong or missing today, for whom, with the evidence that matters. Why now.>

## 2. Goals and non-goals

### Goals (measurable)
| ID | Goal | Measure |
| --- | --- | --- |
| G1 | <outcome> | <measure: test suite / probe / metric / sign-off> |

### Non-goals (this PRD)
<Capabilities deliberately excluded.>

## 3. Users

<Persona — primary job (one line each), link to spec §4. Primary persona for the first phase: …>

## 4. Requirements

Requirement ids are referenced by tasks in `tasks.json` (`reqs`). Never renumber; withdraw instead.

### 4.1 Functional
| ID | Requirement | Priority | Phase | Spec | Acceptance |
| --- | --- | --- | --- | --- | --- |
| FR-01 | <one behaviour> | Must | P0 | <doc §n> | <check: probe id / test / threshold> |

### 4.2 Non-functional
| ID | Requirement | Priority | Phase | Target | Acceptance |
| --- | --- | --- | --- | --- | --- |
| NFR-01 | <quality attribute> | Must | P0 | <threshold> | <how it is measured> |

## 5. Release plan (phases)

| Phase | Name | Outcome | Depends on | Parallel with | Plan |
| --- | --- | --- | --- | --- | --- |
| **P0** | <name> | <outcome> | — | — | [P0](./phases/P0-PLACEHOLDER.md) |

```
P0 ──▶ P1 ──┬──▶ P2 ──┐
            └──▶ P3 ──┴──▶ P4 (1.0)
```

**Usable from:** <the phase exit after which the primary persona can rely on the product>.
**Indicative calendar:** <phase ≈ weeks with N parallel agents + reviewers>.

## 6. Definition of done

**Task:** acceptance criteria met; failing test written first (or waiver recorded); task gate PASS on the integrated result; one commit with the task id; ledger updated; independent verifier APPROVE.
**Wave:** all tasks done or deferred-with-owner; wave gate PASS; wave log written; scorecard regenerated; wave PR merged with a merge commit.
**Phase:** all tasks done/deferred-with-owner; phase gate PASS; exit criteria met with evidence and upheld by an independent challenge; phase-complete log written; baseline tightened; scorecard regenerated.

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Parallel agents edit the same files | Conflicts, regressions | Lane file ownership per wave; worktrees; serial integration behind the gate |
| Agents "pass" by weakening tests or baselines | Silent quality loss | Gate compares to baseline; adversarial verifier; baseline only tightens |
| <domain risk> | <impact> | <mitigation that is a real task or check> |

## 8. Open decisions (tracked as tasks)

| ID | Decision | Due | Task |
| --- | --- | --- | --- |
| DR-01 | <question> | <phase/wave> | <task id> |
