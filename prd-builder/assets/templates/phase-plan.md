# Phase 0 — <Name>

**Goal:** <one paragraph, including what is explicitly NOT in this phase>
**Inputs:** <audit / spec links> · **Depends on:** — · **Unblocks:** P1
**Estimated duration:** <weeks> with <N> parallel implementer agents and <M> human reviewers.

## Exit criteria (all required)

1. <command → expected output, e.g. `node scripts/audit/probe.mjs` → 16/16 PASS>
2. <scanner → every section 0>
3. <full test suite → 0 failed files>
4. `node scripts/prd/gate.mjs phase` → GATE PASSED; baseline tightened; phase-complete log written.
5. `node scripts/prd/prd.mjs scorecard --phase P0` → every Must requirement of P0 Done.

## Requirement → task map  (and/or Audit finding → task map)

| Requirement / finding | Task(s) | Evidence (probe / test) |
| --- | --- | --- |
| FR-01 | P0-A01 | C01 |

## Wave plan and lanes

```
W0  <hygiene task that touches many files — runs alone>
                  ▼
W1  A01 A02 │ B01 │ C01 C02                    (<n> tasks, all independent)
                  ▼
W2  A03 │ B02 │ C03 │ Z01 integration          (<n> tasks)
```

**Critical path:** <task → task → phase exit>.
**Highest risk:** <tasks and why>.

### File ownership highlights (full lists in `tasks.json`)

| Wave | Hot file | Owner |
| --- | --- | --- |
| W1 | <shared file> | <task> |

### Notes for implementers
- **<task>:** <non-obvious constraint or preferred approach>

## Tasks

Snapshot only — **status lives in [`../tasks.json`](../tasks.json)** (`node scripts/prd/prd.mjs wave P0-W1`).

#### P0-W1 — <wave description>

| Task | Lane | Title | Depends on | Size | Acceptance (summary) |
| --- | --- | --- | --- | --- | --- |
| `P0-A01` | A | <title> | — | M | <criteria> |
