# 10 — Pitfalls (real ones) and how to avoid them

Each item happened in a real run of this method. Read before the first wave.

| # | What happened | Effect | Prevention |
| --- | --- | --- | --- |
| 1 | A `git commit` in the main checkout while the integrator had a squash staged | The task's source landed in an unrelated commit | Never commit in the main checkout during integration; use a separate worktree or wait |
| 2 | Gate base `--base <sha>^` lost its `^` in Windows `cmd.exe` | Gate diffed HEAD with itself, skipped G3/G4/G7, printed PASSED | Resolve bases to full SHAs inside the gate; fail loudly on an empty diff |
| 3 | Default gate base = merge-base with `origin/<integration>` while the wave was unpushed | Gate linted 30+ files from earlier tasks and failed on someone else's lint error | Resolve the base against the **local** integration branch; or pass `--base` explicitly |
| 4 | Shell integrator script with CRLF line endings | Could not run on a Windows checkout | Use the Node `prd.mjs integrate` (portable); add `.gitattributes` `*.sh text eol=lf` |
| 5 | Usage limits killed agents mid-wave, twice | Unreviewed work existed only in worktrees | Push per task; emergency `wip` commits; handoff updated before long runs |
| 6 | Workflow resumed after a failure re-ran later agents | A finished implementation was rebuilt as `-retry` | Expect it; keep original branches on origin; resume soon after the limit resets |
| 7 | A test in another lane seeded data the old way | Correct page migrations failed the gate | Owner's widening rule: move the seed to the new path without weakening assertions; record it |
| 8 | A test derived "coverage" from `Math.random()` | CI failed intermittently | Treat flakes as bugs (`Q` task); never retry until green |
| 9 | Strict seed validation only under `CI=true` | Green locally, red in CI | Run the gate with the CI environment variables locally |
| 10 | Gate failures did not print their cause in CI | Slow diagnosis | Gate prints the failing command's tail and writes `.prd-gate/report.md`; CI uploads it |
| 11 | An "idempotent" wizard step updated a record it had only reused | Pre-existing data was overwritten on Back/Next | Track what the step created; only update created rows (verifier rubric item) |
| 12 | UI wrote `amount`, schema declared `fine_amount` | Value silently dropped by the strict provider | Verifier checks schema vs writes; integration tests use the real provider |
| 13 | Browser-only acceptance (probe) in an environment without a browser | Criteria could not be verified | Find the preinstalled browser (`/opt/pw-browsers`), or record `unverified` and get owner acceptance of unit evidence |
| 14 | Owner asked to merge everything before review | Risk of unreviewed code counted as done | Merge, but status `review`, note in ledger/commit/log; scorecard shows Partial; review next |
| 15 | Local integration alias compared with `origin/<same name>` by a stop hook | Repeated "N unpushed commits" warnings | Expected; verify against the wave branch; never push the alias to the integration branch |
| 16 | Wave PR squash-merged (in an earlier project) | Ledger commit ids and stacked branches broke | Merge wave PRs with a merge commit |
| 17 | The same wave worked on by a cloud and a local session | Duplicate, independently reviewed commits | One integrator per wave; keep pushed commits, discard duplicates, log it |
| 18 | `.env` with a live DSN was tracked | Secret exposure | Secret scan task in P0; `.env.example` only |
| 19 | Deleting remote branches returned 403 from the agent environment | Branch clutter | List branches to delete in the handoff for the owner |
| 20 | Typecheck + tests in parallel agents exhausted a 4-core box | Timeouts that looked like failures | `maxParallel` 2 per 4 cores; `VITEST_MAX_FORKS`-style limits in gates |
| 21 | Tasks that "migrate N pages" were too big | Long reviews, many findings | Split by file group (part 1 / part 2) at planning time |
| 22 | `reqs` left empty on most stabilisation tasks | Scorecard could not show requirement coverage | Fill `reqs` at planning; `prd.mjs check` warns on empty `reqs` + `findings` |
