# 03 — The PRD document (`docs/prd/README.md`)

The PRD is the contract between the owner and everyone who builds. It is short (aim for
150–250 lines), stable, and **every row has an id** so tasks, commits and the scorecard can
point at it. Detail lives in the spec; the PRD links to it.

## Contents
1. Header and companion table
2. Problem
3. Goals and non-goals
4. Users
5. Requirements (FR / NFR) — the heart of it
6. Release plan (phases)
7. Definition of done
8. Risks
9. Open decisions
10. Quality checklist

---

## 1. Header and companion table

```markdown
# <Product> — Product Requirements Document (PRD)

**Version:** 1.0 · **Date:** <YYYY-MM-DD> · **Owner:** <org/person> · **Status:** Draft | Approved for P0
**Derived from:** [Spec](../specs/<product>/README.md) and the [Audit](../audit/<folder>/README.md)

| Companion documents | Purpose |
| --- | --- |
| [EXECUTION.md](./EXECUTION.md) | How work is run: branches, one commit per task, gates, lanes, sub-agents, resuming |
| [phases/](./phases) | One plan per phase: waves, lanes, tasks, file ownership, exit gates |
| [tasks.json](./tasks.json) | Machine-readable ledger (source of truth for status) |
| [SCORECARD.md](./SCORECARD.md) | Generated requirements-vs-implementation scorecard |
| [workflow-log/](./workflow-log) | Append-only logs per wave/phase; `PROGRESS.md` shows where we are |
| `scripts/prd/gate.mjs`, `scripts/prd/prd.mjs` | Gate and ledger tools |
```

Bump the version when requirements change after approval; record the change in a decision record.

## 2. Problem

One or two paragraphs: what is wrong or missing today, for whom, with the evidence that matters
(audit counts, user complaints, market need). End with why it must be solved now.

## 3. Goals and non-goals

```markdown
### Goals (measurable)
| ID | Goal | Measure |
| --- | --- | --- |
| G1 | A new customer goes from install to first invoice without support | ≤ 2 h; GP-1 green |
| G2 | No data loss, no fake data, no fail-open auth | Probe C01–C04 pass; zero incidents in pilot |

### Non-goals (this PRD)
<capabilities deliberately excluded, so nobody "helpfully" builds them>
```

A goal without a measure is a wish. Prefer measures that a script, a test suite or a pilot
sign-off can produce. 4–8 goals is typical.

## 4. Users

Personas from the spec in one sentence each, with a link. Name the primary persona for the
first phase.

## 5. Requirements (FR / NFR)

```markdown
### 5.1 Functional
| ID | Requirement | Priority | Phase | Spec | Acceptance |
| --- | --- | --- | --- | --- | --- |
| FR-01 | Data persists across reloads; storage failure blocks writes with a clear message | Must | P0 | 06 §3 | Probe C01; reload test |
| FR-04 | Setup wizard creates profile, year, terms, classes idempotently | Must | P0→P2 | 01 WS1.3 | Back/Next twice → no duplicates |

### 5.2 Non-functional
| ID | Requirement | Target | Phase | Acceptance |
| --- | --- | --- | --- | --- |
| NFR-02 | Performance | Billing 1,000 customers ≤ 2 min; initial JS ≤ 500 KB gz | P3 | Benchmark script in CI |
```

Rules:

- **One behaviour per row.** If a row contains "and" twice, split it.
- **Priority** is MoSCoW: Must (the phase fails without it), Should, Could. Won't goes in non-goals.
- **Phase** may be a range (`P0→P2`) when a requirement is delivered incrementally; the phase plan then says what each phase delivers (e.g. "report card v0" in P0, full engine in P2). The scorecard treats such a requirement as *partial* until its last phase's tasks are done.
- **Acceptance** is the check, not the restatement: a probe id, test name, measurable threshold, or observable outcome. A verifier must be able to decide met / not met from it.
- **Stable ids.** Never renumber. Retired requirements stay in the table with `Status: withdrawn` (and a DR).
- Mirror the table into `tasks.json → requirements[]` (or let `prd.mjs` parse the Markdown table — it reads any table whose first column is `FR-nn`/`NFR-nn`). Tasks reference requirement ids in `reqs`.

## 6. Release plan (phases)

```markdown
| Phase | Name | Outcome | Depends on | Parallel with | Plan |
| --- | --- | --- | --- | --- | --- |
| **P0** | Stabilise | Existing features work end-to-end on persistent storage; probe 16/16 | — | — | [P0](./phases/P0-stabilisation.md) |
| **P1** | Core model | Canonical model, repositories, migrations | P0 | — | [P1](./phases/P1-core-model.md) |
```

Add an ASCII dependency diagram and an indicative calendar ("P0 ≈ 2–3 weeks with N parallel
agents and one reviewer"). Say explicitly **which phase exit makes the product usable** (for the
primary persona) — owners always ask.

Phase design heuristics:

- Phase 0 for an existing product is almost always *Stabilise*: make what exists work, no new concepts except unavoidable ones.
- Then foundations (data model, contracts), then capability phases that can run in parallel once the foundation's first waves land (`start_after: "P1-W2"` in the ledger).
- The last phase is release/ecosystem: docs, licence, packaging, pilot sign-off.
- Each phase has 3–8 numbered **exit criteria** that are commands or observable facts.

## 7. Definition of done

```markdown
**Task:** acceptance criteria met; failing test written first (or waiver recorded); task gate PASS on the integrated result;
one commit with the task id; ledger updated; independent verifier APPROVE.
**Wave:** all tasks done or deferred-with-owner; wave gate PASS; wave log written; wave PR merged.
**Phase:** all tasks done/deferred-with-owner; phase gate PASS; exit criteria met with evidence and challenged by an
independent skeptic; phase-complete log written; baseline tightened; scorecard regenerated.
```

## 8. Risks

```markdown
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Parallel agents edit the same files | Conflicts, regressions | Lane file ownership per wave; worktrees; serial integration with gate |
| Agents "pass" by weakening tests or baselines | Silent quality loss | Gate compares to baseline; verifier is adversarial; baseline only tightens |
```

Always include the two process risks above plus the top domain risks. Each mitigation should
be something the plan actually does (a task, a gate check, a review step).

## 9. Open decisions

```markdown
| ID | Decision | Due | Task |
| --- | --- | --- | --- |
| DR-01 | Schema/validation library | P1 W1 | P1-A01 |
```

Every open question from the spec appears here, tied to a task that produces a decision record.
Tasks that depend on the decision list that task in `depends_on`.

## 10. Quality checklist (run before asking for approval)

- [ ] Every goal has a measure; every requirement has priority, phase, spec link and acceptance.
- [ ] No requirement is untestable ("user-friendly", "fast") without a threshold.
- [ ] Every Must requirement of the first phase maps to at least one task (`prd.mjs check`).
- [ ] Non-goals are explicit.
- [ ] The phase that makes the product usable is named.
- [ ] Risks include process risks; every mitigation is real.
- [ ] Every open decision has a due point and a task.
- [ ] Committed: `docs(prd): <product> PRD v<version>`.
