# Decision records

One file per decision: `<YYYY-MM-DD>-<slug>.md`. Agents cite them by path; the owner is not asked
again for anything a standing decision covers. Superseded decisions stay, marked superseded.

## Template

```markdown
# Decision: <title>  (<date>)
**Decided by:** <owner> · **Applies to:** <scope> · **Status:** accepted | superseded by <link>

## Context
## Rule / decision
## Conditions        (when it applies; what must still hold)
## Applied           (append a row each time it is used)
| Task | What | Why |
| --- | --- | --- |
## Consequences
```

## Standing decisions worth recording at the start of a project

### Scope widening
When a task cannot meet its acceptance criteria only because the files it must change are
outside its card's `files`, the orchestrator widens the task to those files and proceeds,
provided the result passes the task gate on the integrated branch and merges without
non-mechanical conflicts. The widening is recorded in the task notes, the commit message and
the wave log. Other blockers (missing evidence, product decisions, spec ambiguity) still go to
the owner.

### Evidence when the environment cannot run a check
A criterion that needs a browser, device or credentials the environment lacks may be accepted
on unit/component evidence, recorded as `unverified` in the ledger with the reason, and checked
again at phase exit where the full probe runs.

### Model policy
| Role | S | M | L |
| --- | --- | --- | --- |
| load, log, record, commit/push, exploration | Haiku | Haiku | Haiku |
| implement | Sonnet low | Sonnet medium | Sonnet high |
| verify / fix | Sonnet high | Sonnet high | Opus medium |
| re-verify, phase challenge | Opus | Opus | Opus |
Escalate a task to Opus (`opusTasks`) when it is rejected twice for the same finding.

### Push policy
Each task is integrated, committed and pushed to the wave branch as soon as it is approved;
every task branch is pushed before a session stops.
