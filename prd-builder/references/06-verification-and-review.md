# 06 — Verification and review

The verifier is what makes "done" mean something. Its job is to **refute** the implementer's
claim. It runs in its own worktree, detached at the task branch, changes nothing, and returns a
structured verdict.

## Contents
1. Review levels
2. Verifier prompt (task level)
3. Verdict schema
4. Fixer prompt and the fix loop
5. Reviewing work that was merged without review
6. Review rubric (what verifiers miss most)
7. Phase-exit challenge
8. Recording verification in the ledger

---

## 1. Review levels

| Level | When | Who | Output |
| --- | --- | --- | --- |
| Self-check | Implementer, before returning | Implementer | Gate PASS, summary |
| **Task verify** | Every task, before integration | Independent verifier | `VERDICT` (approve / changes_required) |
| Re-verify | After a fix round | A *stronger* or different verifier | `VERDICT` |
| Integration gate | After squash | Integrator | Gate PASS on `--base HEAD` |
| Wave gate | End of wave | Orchestrator | Gate over the whole wave diff |
| **Scorecard audit** | Before phase exit, or on demand | Per-requirement auditors (`prd-scorecard`) | Criterion-level evidence |
| **Phase challenge** | Phase exit | Skeptic per exit criterion | Refuted / upheld |

## 2. Verifier prompt (task level)

```text
You are the adversarial VERIFIER for task <id>. Assume the change is wrong until proven right.
Do not modify, commit or push anything.

Setup: fresh worktree; link dependencies; git switch --detach <branch>; BASE=$(git merge-base <branch> <integration>)
Task card: <card JSON>          Implementer summary: <summary>
Owner rules that apply: <links to decision records, e.g. scope widening>

Check, with evidence (commands and output excerpts):
1. Each acceptance criterion: met or not met. If you cannot verify one (no browser, no data), mark it NOT met and say what is missing.
2. Scope: git diff --name-only $BASE..HEAD contains only card files, new tests/fixtures, and widenings allowed by owner rules.
3. Test quality: restore the base version of the changed source files, run the new tests, confirm they FAIL for the
   right reason; restore the branch version; confirm they pass. Report test_fails_on_base.
4. Regressions and contracts: no calls to functions that do not exist, no id coercion, no `as any as`, no swallowed
   errors, no hard-coded domain/market terms in core code, no debug leftovers.
5. Idempotency and data safety where relevant (re-running a step creates no duplicates; nothing overwrites data the
   change did not create).
6. Run the gate yourself: node scripts/prd/gate.mjs task --task <id> --base $BASE
7. Merge check: git merge-tree --write-tree <wave-tip> HEAD (clean?)

Verdict "approve" only if every criterion is met, scope is ok, the test fails on base, and the gate passes.
List blocking findings with file and a concrete fix; list non-blocking notes separately.
```

## 3. Verdict schema

```json
{
  "type": "object",
  "properties": {
    "verdict": { "type": "string", "enum": ["approve", "changes_required"] },
    "acceptance": { "type": "array", "items": { "type": "object", "properties": {
      "criterion": { "type": "string" }, "met": { "type": "boolean" }, "evidence": { "type": "string" } },
      "required": ["criterion", "met", "evidence"] } },
    "blocking_findings": { "type": "array", "items": { "type": "object", "properties": {
      "issue": { "type": "string" }, "file": { "type": "string" }, "fix": { "type": "string" } },
      "required": ["issue", "fix"] } },
    "non_blocking": { "type": "array", "items": { "type": "string" } },
    "scope_ok": { "type": "boolean" },
    "test_fails_on_base": { "type": "boolean" },
    "gate_passed": { "type": "boolean" }
  },
  "required": ["verdict", "acceptance", "blocking_findings", "scope_ok", "gate_passed"]
}
```

## 4. Fixer prompt and the fix loop

```text
You are the FIXER for <id>. Branch prd/<id>-fix1 from <implementer branch>.
Blocking findings: <JSON>   Unmet criteria: <JSON>
Same rules as the implementer: stay in the card's files (plus owner-approved widenings), test first for each finding,
gate until GATE PASSED, commit "wip(<id>): address review", push the branch. Return the implementer result structure.
```

Loop: implement → verify → (changes_required) → fix → **re-verify with a stronger model** →
approve → integrate. If the re-verify still finds blocking issues, stop: status `review`,
both arguments in the wave log, escalate. Never loop silently more than once per wave; repeated
rejection for the same finding means escalate the model (`opusTasks`) or re-scope the task.

## 5. Reviewing work that was merged without review

When the owner asks to merge before review, or a session ran out before review:

```text
Adversarially verify commit <sha> against task <id> in docs/prd/tasks.json.
Diff: git diff <sha>^..<sha>   (base = <sha>^, resolve to a full SHA first)
Same checks as the task verifier; test_fails_on_base = run the new tests with the source files from <sha>^.
```

Fixes go on a branch from the wave tip and are integrated the same way; then
`prd.mjs set <id> done` and `prd.mjs verify-import` with the verdict.

## 6. Review rubric — what verifiers miss most

Ask these explicitly; they were the real defects found in practice:

- **Overwrite of pre-existing data** by "idempotent" steps (re-running reuses a record the step did not create and then updates it).
- **Schema drift**: the UI writes field names the storage schema does not declare, so a strict provider silently drops them (`amount` vs `fine_amount`).
- **Type lies**: ids declared numeric in shared types while values are strings, hidden behind `as unknown as` casts.
- **Swallowed errors**: `catch {}` or unhandled promise rejections in pages; errors not shown to the user.
- **Tests that pass on the base** or only fail because of an import error (weak evidence — say so).
- **Race conditions**: computing balances from a stale snapshot; actions enabled before data loads.
- **Vacuous gates**: empty diff, wrong base, skipped checks reported as PASS.
- **Off-by-one in reports and print**: trailing blank page, denominators, `x || 100` treating 0 as missing.
- **Unverifiable criteria marked met** (e.g. a browser probe in an environment without a browser).

## 7. Phase-exit challenge

`prd-phase-exit` first collects evidence for each exit criterion (commands and output), then
gives each criterion claimed as met to an independent skeptic prompted to **refute** it
("default to refuted if uncertain"). Only upheld criteria count. Refuted criteria become tasks
in the phase (or a decision to defer, recorded with owner). The results are written to the
phase's `exit_results` in the ledger and appear in the scorecard.

## 8. Recording verification in the ledger

Write verdicts as JSON and import them:

```json
{ "date": "2026-10-18", "by": "verifier (opus)",
  "tasks": [ { "id": "P0-A05", "verdict": "approve",
    "criteria": [ { "criterion": "Back/Next twice creates exactly 1 year, 3 terms", "status": "met", "evidence": "setup-wizard.spec 8/8" },
                  { "criterion": "Probe C02 PASS", "status": "met", "evidence": "PASS C02 (chromium-1194)" } ],
    "non_blocking": ["LiveStore schema lacks setup_completed_at"] } ] }
```

```bash
node scripts/prd/prd.mjs verify-import docs/prd/verification/<date>.json
node scripts/prd/prd.mjs scorecard --write
```

Criterion statuses: `met`, `partial` (works with a gap that is not blocking), `missing`
(not implemented or fails), `unverified` (could not be checked here — say why).
