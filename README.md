# prd-builder

An agent skill that turns "here is a product / codebase / idea" into a plan agents and humans can
execute safely, in parallel, and **prove**.

Every requirement gets an id, every id is traced to tasks, every task to one gated commit, and every
commit to verifiable evidence. A generated scorecard then answers the only question owners really ask:
**what is done, what is partial, what is missing — and how do we know?**

Not a PRD template. A PRD *process*: a machine-readable ledger, a ratcheting quality gate, one commit
per task, independent verification, and a requirements-vs-implementation scorecard.

## Install

Standard skill installation:

```bash
npx skills add compgeniuses/prd-builder          # into the current project
npx skills add compgeniuses/prd-builder -g -y    # globally, for every agent, no prompts
```

Or by hand — the skill is just a folder, so copy `prd-builder/` into whichever directory your agent
reads skills from:

| Agent | User-level skills directory |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| Codex | `~/.codex/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| OpenCode | `~/.config/opencode/skills/` |
| most others | `~/.agents/skills/` |

To use one copy everywhere, install once into `~/.agents/skills/prd-builder/` and link it from each
agent's directory (`mklink /J` on Windows, `ln -s` elsewhere). Edit the canonical copy only.

## Requirements

- **Node ≥ 18** and **git on PATH**. No npm dependencies — the two CLIs are plain Node.
- A git repository to work in. The skill commits as it goes, one commit per task.
- Optional: an agent that can run sub-agent workflows (Claude Code) for the parallel-wave path.
  Everything else works with a single agent using the manual runbook in `references/05 §9`.

## What it produces

Scaffolded into your repo by `node <skill-dir>/scripts/prd.mjs --root . init`:

```
docs/audit/<YYYY-MM>-<topic>/     findings with ids, severity, evidence, root causes
docs/specs/<product>/             vision, principles, scope, personas, glossary, domain specs
docs/prd/
  README.md                       the PRD: problem, goals, non-goals, FR/NFR tables, phases, DoD, risks
  EXECUTION.md                    binding protocol: units of work, branches, commits, gates, lanes, roles
  prd.config.json                 project name, integration branch, gate checks, trailers, model policy
  tasks.json                      the ledger — single source of truth for phases, waves, lanes, tasks
  phases/P<n>-<slug>.md           one plan per phase: exit criteria, finding→task map, wave diagram
  SCORECARD.md                    generated: requirements × implementation status with evidence
  LOCAL-HANDOFF.md                where work stopped and the exact next commands
  workflow-log/                   append-only wave/phase logs, decision records, PROGRESS.md
scripts/prd/
  prd.mjs                         ledger CLI: init, check, status, wave, next, set, integrate, scorecard
  gate.mjs                        configurable gate with a ratcheting baseline
```

## The pipeline

| Stage | What happens | Done when |
| --- | --- | --- |
| 0 Intake | Infer from the repo, ask only what you cannot | Mode chosen, constraints and owner rules written down |
| 1 Discovery/audit | Static read + running the app; findings with `file:line` and a probe | Every golden-path step classified with evidence |
| 2 Specification | Vision, principles, scope, personas, glossary, one doc per domain | Every capability has a section to link to |
| 3 The PRD | Numbered `FR-nn` / `NFR-nn`, each with priority, phase, spec link, acceptance | Every requirement is testable and prioritised |
| 4 Phase plans + ledger | Phases → waves → lanes → tasks in `tasks.json` | `prd.mjs check` reports 0 errors |
| 5 Tooling | Gate checks, baseline, CI | `gate.mjs task` prints `GATE PASSED` on a clean tree |
| 6 Execute waves | One task → one gated commit; implementer / verifier / fixer | Every task done or deferred, wave log written |
| 7 Verify | Adversarial verifier; nothing is "done" because an implementer says so | Verdict with command evidence per criterion |
| 8 Scorecard | Independent per-requirement audit feeds `SCORECARD.md` | Requirements graded done/partial/missing/unmapped |
| 9 Logs & handoff | Append-only logs, decision records, `LOCAL-HANDOFF.md` | A new session can resume from the handoff alone |

## Why it holds up

- **The gate decides, not the agent.** Checks run against the integrated result; the baseline only ever
  tightens. "Done but unverified" never counts as done on the scorecard.
- **Traceability is the product.** Requirement → task → commit (`[task-id]` in the subject) → evidence.
  A change with no task id did not happen as far as the plan is concerned.
- **Parallel where it is safe, serial where it is not.** Lanes own files per wave; integration is
  strictly serial behind the gate, so the gate always sees the real integrated result.
- **The pitfalls are documented, not rediscovered.** `references/10-pitfalls.md` records 22 failures
  that actually happened — vacuous gates, `grep`/`^` mangled by Windows shells, squash-merged wave PRs,
  usage limits killing agents mid-wave — each with its prevention.

## Repository layout

```
README.md                 this file
LICENSE
prd-builder/              the skill itself — this is the folder an installer copies
  SKILL.md                entry point: modes, stages, golden rules, command cheat sheet
  references/01..10        the detailed method, read as you reach each stage
  scripts/prd.mjs         ledger CLI
  scripts/gate.mjs        quality gate
  scripts/test/           end-to-end tests against a throwaway git repo
  assets/templates/       PRD, EXECUTION, phase plan, ledger, logs, decision record
  assets/workflows/       implement→verify→fix→integrate workflows for agents with a workflow runner
```

## Tests

```bash
node --test prd-builder/scripts/test/*.test.mjs
```

11 end-to-end tests against a throwaway git repository — no dependencies beyond Node ≥ 18 and git.
They exercise `init` (and that it never overwrites), plan validation, the ratcheting baseline, the
gate's TDD and forbidden-pattern checks, serial integration with push, and the scorecard's status
rules. They pass on Windows and POSIX (the metric fixtures are Node, not shell).

## Notes

- The `assets/workflows/*.js` files are only usable by agents with a workflow runner (Claude Code).
  Every other path — the ledger, the gate, the logs, the scorecard — is plain Node and works anywhere.
- The skill was extracted from a real multi-phase project (audit → spec → PRD → seven-phase plan →
  waves executed by parallel sub-agents). The templates are the generalised versions of what worked
  there.

## Licence

MIT — see [LICENSE](LICENSE).
