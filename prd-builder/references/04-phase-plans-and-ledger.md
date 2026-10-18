# 04 — Phase plans, waves, lanes, tasks and the ledger

This is where the PRD becomes executable. A good plan lets several agents work at once without
touching the same files, lets anyone see what is runnable next, and gives every task a check
that an independent verifier can decide.

## Contents
1. Units of work
2. Designing waves and lanes
3. Writing a task card
4. Sizing and splitting
5. Acceptance criteria that can be verified
6. The ledger (`tasks.json`) schema
7. Phase plan document structure
8. Traceability maps
9. Validating the plan (`prd.mjs check`)
10. Changing the plan later

---

## 1. Units of work

| Unit | Example | Meaning |
| --- | --- | --- |
| **Phase** | `P0` | Release-level outcome with exit criteria |
| **Wave** | `P0-W2` | Tasks that can run **in parallel**: files do not overlap, dependencies met. A wave is also an integration checkpoint — later waves of the phase wait until it is closed |
| **Lane** | `Lane E (Finance)` | Stream of related tasks; owns a set of files for the duration of a wave |
| **Task** | `P0-E04` | Smallest unit: one concern, test first, one commit |

## 2. Designing waves and lanes

1. List the tasks (from findings → root causes → fixes, or from requirements → capabilities).
2. Draw dependencies. Foundations (contracts, data layer, storage) come first.
3. **W0** is for repository-wide hygiene that touches many files (re-encoding, formatter, lint config). It runs alone; everything else branches after it.
4. Group remaining tasks into waves by dependency depth. Inside a wave, assign each task to a lane so **no file appears in two tasks of the same wave**. Shared hot spots (routing table, central context, collection registry, locale files) are owned by exactly one task per wave or by an integration task (`Z` lane) at the end of the wave.
5. Put one `Z` (integration) task in the last wave of each phase: merge pending i18n files, update docs index, regenerate PROGRESS.
6. Allow at most one dependency-changing task (`deps_install: true`, edits the lockfile) per wave.
7. Mark the **critical path** and the **highest-risk tasks** in the phase plan; schedule risky tasks early in their wave and give them L size and Opus review (see 09).
8. Aim for 4–16 tasks per wave. Fewer means no parallelism; more means integration becomes the bottleneck.

Wave diagram format (phase plan):

```
W0  G00 encoding ─┐  G01 eslint
                  ▼
W1  A01 A02 │ B01 B02 │ C01 C02 │ D01 D02 │ E01 E02 │ F01 F02 │ G02 G03      (14 tasks, all independent)
                  ▼
W2  A03 A04 │ B03 │ C03 C04 │ D03 D04 │ E03 │ F03 │ G06 G07                     (11 tasks)
```

## 3. Writing a task card

```json
{
  "id": "P0-E04",
  "phase": "P0", "wave": "P0-W3", "lane": "E",
  "title": "Finance pages part 1 to useFinance(): receipts, opening balances, fines, transport",
  "size": "M",
  "depends_on": ["P0-B02"],
  "files": ["src/modules/finance/pages/GeneralReceiptsPage.tsx", "src/modules/finance/pages/TransportRoutesPage.tsx"],
  "acceptance": [
    "Create, edit and delete persist on each page (page test against an in-memory database)",
    "No Number()/parseInt on ids in these files (gate G6)",
    "Save errors are shown in the dialog and the dialog stays open"
  ],
  "test": "Page tests with UUID ids: create/edit/delete per page; failing save shows the error",
  "reqs": ["FR-18"],
  "findings": ["SO-11", "SO-22", "SO-23", "SO-28"],
  "spec": "specs/product/05-finance.md#5-payments",
  "deps_install": false,
  "status": "todo", "commit": null, "notes": "", "completed_at": null
}
```

Field rules:

- **title** — imperative, says what changes and where. Readable alone in a commit log.
- **files** — every file the task may edit (globs allowed: `src/components/setup/**`, `steps/* (new)`). New test files are always allowed and need not be listed. This list is the lane ownership the integrator and verifier enforce.
- **acceptance** — 1–5 checkable criteria (see §5).
- **test** — the failing test to write first: what it does, not just "unit tests".
- **reqs / findings** — every requirement advanced and every audit finding closed. Empty `reqs` is allowed only for pure hygiene tasks; `prd.mjs check` warns otherwise.
- **spec** — path relative to `docs/` (anchor optional).
- Never put status-like words in the title ("fix remaining", "finish"); the ledger carries status.

## 4. Sizing and splitting

| Size | Typical change | Guidance |
| --- | --- | --- |
| **S** | ≤ 100 lines, 1–3 files, one behaviour | Mechanical or local; Sonnet low effort implements; Sonnet reviews |
| **M** | 100–300 lines, ≤ 8 files | Default; one page group or one service |
| **L** | 300–400 lines, a subsystem or a risky change | Opus reviews; consider splitting; schedule early |

Split when: > 400 changed lines, two unrelated acceptance criteria, files in two lanes, or a task
that "migrates N pages" with N > 5 (split into part 1 / part 2 by file group, as E04/E05 were).
Sub-tasks keep the parent id with a suffix (`P1-B02a`) or take the next free number.

## 5. Acceptance criteria that can be verified

Each criterion must let a skeptical verifier answer met / not met with evidence:

| Weak | Strong |
| --- | --- |
| "Fees work" | "Adding/editing/removing fee items persists after reload (probe C10 PASS)" |
| "No crashes" | "Probe C16 crawl reports 0 broken pages" |
| "Faster" | "40 report cards assemble in ≤ 30 s (benchmark test)" |
| "Better errors" | "Every failed save shows the error in the dialog; dialog stays open (page test)" |
| "Clean code" | "No `as any as` added (gate G6); ESLint clean on changed files (G7)" |

Prefer criteria tied to a probe check, a named test, a scanner count, or a measurable
threshold. A criterion that needs a browser or data the environment lacks must say so — the
verifier then reports it as unverified rather than met (and the owner may accept unit
evidence via a decision record).

## 6. The ledger (`tasks.json`) schema

```jsonc
{
  "version": 2,
  "project": "Product name",
  "generated_from": "docs/prd (planning session <date>)",
  "requirements": [                       // optional: prd.mjs can parse the PRD tables instead
    { "id": "FR-01", "title": "Data persists across reloads", "priority": "Must",
      "phase": "P0", "spec": "06 §3", "acceptance": "Probe C01" }
  ],
  "findings": [                           // optional: audit findings for closure tracking
    { "id": "SO-01", "severity": "P0", "title": "Data is never persisted" }
  ],
  "phases": [
    {
      "id": "P0", "name": "Stabilise", "depends_on": [], "start_after": null,   // e.g. "P1-W2": may start once P1-W2 closes
      "lanes": { "A": "Persistence & auth", "Z": "Wave integration" },
      "waves": { "P0-W0": "Repo hygiene (runs alone)", "P0-W1": "Foundations" },
      "exit_criteria": ["Probe 16/16 PASS", "Contract scan: every section 0"],
      "exit_results": [],                 // filled by prd-phase-exit: { criterion, status, evidence }
      "completed_at": null
    }
  ],
  "tasks": [
    {
      "id": "P0-A01", "phase": "P0", "wave": "P0-W1", "lane": "A", "title": "...", "size": "L",
      "depends_on": [], "files": [], "acceptance": [], "test": "", "reqs": [], "findings": [],
      "spec": "", "deps_install": false,
      "status": "todo",                   // todo | in_progress | review | done | blocked | deferred
      "commit": null, "notes": "", "completed_at": null,
      "verification": {                   // written by verifiers / prd-scorecard via `prd.mjs verify-import`
        "date": "2026-10-18", "verdict": "approve", "by": "verifier (opus)",
        "criteria": [ { "criterion": "...", "status": "met", "evidence": "test X passes; probe C01 PASS" } ],
        "non_blocking": ["..."]
      }
    }
  ]
}
```

Status semantics:

| Status | Meaning |
| --- | --- |
| `todo` | Not started. Runnable when deps are `done`, earlier waves of the phase are closed, and the phase has started |
| `in_progress` | Someone is working on it (set when a session claims it by hand) |
| `review` | Built and merged or ready, **not independently verified** (or verifier and implementer disagree) |
| `done` | Integrated with a gated commit **and** verified |
| `blocked` | Cannot proceed; `notes` says why and what would unblock it |
| `deferred` | Moved out of the phase with an owner and target phase in `notes` |

## 7. Phase plan document structure (`phases/P<n>-<slug>.md`)

```markdown
# Phase <n> — <Name>
**Goal:** <one paragraph, including what is explicitly NOT in this phase>
**Inputs:** <audit / spec links> · **Depends on:** <phases> · **Unblocks:** <phases>
**Estimated duration:** <weeks with N agents + reviewers>

## Exit criteria (all required)
1. <command → expected output>
...

## Audit finding → task map        (mode B)  |  ## Requirement → task map  (mode A)
| Finding | Task(s) | Probe check |

## Wave plan and lanes
<ASCII diagram>
**Critical path:** ... · **Highest risk:** ...

### File ownership highlights (full lists in tasks.json)
| Wave | Hot file | Owner |

### Notes for implementers
- <task>: <the non-obvious constraint or preferred approach>

## Tasks
(generated tables per wave: Task | Lane | Title | Depends on | Size | Acceptance (summary) —
 snapshot only; status lives in tasks.json)
```

Later phases may be planned coarsely (tasks without full file lists); refine them into full
cards at the previous phase's exit ("How to start the next phase" in the phase-complete log).

## 8. Traceability maps

Two maps must be complete before execution starts, and `prd.mjs check` verifies both:

- **Requirement → tasks:** every `Must` requirement whose phase range includes an active or
  past phase has ≥ 1 task with that id in `reqs`.
- **Finding → tasks:** every P0/P1 finding has ≥ 1 task with that id in `findings`.

They are what turns the scorecard from "task progress" into "requirement coverage".

## 9. Validating the plan (`prd.mjs check`)

Errors (must be 0): duplicate ids; task phase/wave/lane not declared in its phase; unknown
dependency; dependency cycle; dependency on a task in a *later* wave of the same phase; the same
file in two tasks of one wave; more than one `deps_install` task per wave; invalid status;
`done` without `commit`.
Warnings: Must requirement with no task; P0/P1 finding with no task; task with no acceptance or
no test; task without `reqs` and without `findings`; L task with > 5 acceptance criteria;
`done` task without verification; `review` task older than its wave.

## 10. Changing the plan later

- Add tasks with new ids; never reuse an id. Quality follow-ups get `Q` ids.
- Re-scoping a task's files (owner's widening rule) → update `files` and add a note.
- Deferring → status `deferred`, note with owner and target phase, mention in the wave log.
- Requirement changes → PRD version bump + decision record + ledger update in one commit.
- Run `prd.mjs check` and `prd.mjs scorecard --write` after every plan edit.
