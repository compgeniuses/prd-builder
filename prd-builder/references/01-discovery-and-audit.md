# 01 — Discovery and audit

An audit answers "what actually works today, and why not?" with evidence. It is the input for
the first phase of the PRD (usually *Stabilise*), and it creates the measuring instruments
(probe, scans) that the gates later re-run. Skip it only for greenfield products.

## Contents
1. Principles
2. Choose the golden paths
3. Static pass
4. Runtime pass (probe and crawl)
5. Writing findings
6. Systemic root causes
7. Audit README structure
8. Scanners worth building
9. Done-when checklist

---

## 1. Principles

- **Evidence or it did not happen.** Every claim has a screenshot, console line, command output,
  or `file:line`. "Seems broken" is not a finding.
- **Run the real thing.** Static reading finds missing functions; only running the app finds the
  in-memory database, the fail-open login, the dropdown that empties itself. Do both.
- **Classify, do not just list.** Each golden-path step is *works*, *works but misleads / stores
  wrong data*, or *blocked*. The "misleads" bucket is the dangerous one — call it out.
- **Root causes over symptoms.** Thirty bugs from four root causes is a four-task fix, not thirty.
- **Leave instruments behind.** A probe script with check ids (C01…) that fails today becomes the
  acceptance test for the tasks that fix it.

## 2. Choose the golden paths

Write the 5–10 journeys a real user must complete in the first week, as numbered steps. Example
for a school system: install → set up school → create year/terms → classes → admit learner →
fee template → bill term → record payment → enter marks → report card → promote. For an
e-commerce app: browse → cart → checkout → pay → fulfilment → refund.

Name them `GP-1…GP-n`. The PRD's goals and the final phase's e2e suite refer to these names.

## 3. Static pass

For each golden-path step, trace UI → state/hooks → services → storage:

- Calls to functions that do not exist at runtime (typecheck errors are a free map of these).
- Contract mismatches: `update(obj)` against an `update(id, patch)` API; wrong collection/table names.
- Type coercions that corrupt data (e.g. `Number(uuid)`), silent `catch {}`, swallowed promise rejections.
- Mock/demo data paths reachable in production; config read from two places.
- Hard-coded domain assumptions (one curriculum, one currency, one country) in core code.
- Dead registrations: routes not mounted, menu items pointing nowhere.

Capture counts — they become gate metrics later ("94 missing functions across 40 pages").

## 4. Runtime pass (probe and crawl)

Write `scripts/audit/<topic>-probe.mjs` (Playwright/Puppeteer for web, an HTTP client for APIs,
a CLI harness for tools). Each check:

```text
C01  Data persists across reload            PASS/FAIL + detail
C02  Setup wizard saves step 1              ...
...
C16  Crawl: every route renders, 0 crashes   lists broken pages
```

Rules: deterministic (fixed seed, fresh profile), one line per check, non-zero exit if any check
fails, writes a Markdown report next to the audit. Include a **crawl** check that visits every
registered route/tab and records crashes, 404s and console errors — it finds a surprising share
of the bugs.

Record the probe run (date, commit, output) as `probe-<date>.md` in the audit folder.

## 5. Writing findings

One heading per finding. Severity: **P0** blocker (data loss, security, golden path blocked),
**P1** major (wrong results, painful workaround), **P2** quality/consistency.

```markdown
#### SO-07 · Terms cannot be created without a financial year, and there is no UI to create one
- **Symptom:** saving a term shows "financial year required"; Finance has no financial-year page. ([screenshot](./evidence/03-term-blocked.jpg))
- **Root cause:** `src/modules/finance/schema.ts:41` requires `financial_year_id`; no page or seed creates one.
- **Impact:** GP-1 blocked at step 3; no term → no billing → no payments.
- **Fix direction:** financial-year CRUD under Finance settings; seed one at school creation. Spec: `05-finance.md §3`.
- **Evidence:** probe C06 FAIL.
```

Keep "fix direction" short — the spec and PRD carry the design. Number findings in severity
order; never renumber after publishing (other documents reference them).

## 6. Systemic root causes

After listing findings, group them: "the data layer contract is untyped (SO-11, SO-23, SO-24)",
"ids are coerced to numbers in 38 places (SO-22)". Each root cause usually becomes one
foundation task plus several page-level tasks. This section is what makes the plan small.

## 7. Audit README structure

```markdown
# <Product> — <topic> audit (<date>)
**Commit audited:** <sha> · **Environment:** <browser/OS/build> · **Auditor:** <who>

## 1. Verdict            (3–6 sentences + a measures table: steps attempted / working / misleading / blocked, pages crawled/crashing, scan counts)
## 2. Test scenario      (golden paths and the data used; 2.1 golden-path results table: step | result | finding)
## 3. Findings           (3.1 P0, 3.2 P1, 3.3 P2 — format above)
## 4. Systemic root causes
## 5. Inventories        (optional: e.g. every picker/combobox and its data source)
## 6. Recommended order of work
## 7. Reproducing this audit   (exact commands for probe and scans)
### What was not covered
```

## 8. Scanners worth building

Static scanners turn whole bug classes into numbers the gate can ratchet down:

| Scanner | Counts | Gate use |
| --- | --- | --- |
| Contract scan | calls to non-existent functions, wrong arity, undefined collections/tables, routes outside navigation, mock hooks used in UI | each section ≤ baseline, target 0 at phase exit |
| Typecheck | total errors, "missing name" errors | ≤ baseline (ratchet) |
| Encoding scan | double-encoded UTF-8 (mojibake) | 0 added |
| Forbidden patterns | `as any as`, `alert(`, `Number(id)`, `console.log` in src | 0 added lines |

Write them as plain Node scripts with JSON output (`--json`) so `gate.mjs` can read the numbers.

## 9. Done-when checklist

- [ ] Every golden-path step classified with evidence.
- [ ] Every finding has id, severity, symptom, root cause (`file:line`), impact, fix direction, evidence.
- [ ] Root causes grouped.
- [ ] Probe script runs from a clean checkout with one command and fails where findings say it should.
- [ ] Scanner counts recorded (they become the first `gate-baseline.json`).
- [ ] Committed: `docs(audit): <topic> audit <date>`.
