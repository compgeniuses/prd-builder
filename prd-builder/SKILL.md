---
name: prd-builder
description: Build, run and verify a structured, evidence-driven Product Requirements Document (PRD) for any software project — discovery/audit, specification, PRD with numbered measurable requirements (FR/NFR), phases → waves → lanes → tasks in a machine-readable ledger (tasks.json), a ratcheting quality gate, one-commit-per-task execution with implementer / adversarial verifier / fixer sub-agents, wave and phase logs, decision records, a resumable handoff document, and a requirements-vs-implementation scorecard (done / partial / missing / not started). Use this skill whenever the user asks for a PRD, product spec, roadmap, phased or wave plan, implementation plan, task breakdown, backlog from an audit, traceability matrix, "what is done vs missing", a progress or compliance scorecard, or wants to start, continue, verify, review or close PRD waves and phases — even if they never say "PRD".
---

# PRD Builder

Turns "here is a product / codebase / idea" into a plan that agents and humans can execute
safely, in parallel, and prove. Every requirement gets an id, every id is traced to tasks,
every task to one gated commit, and every commit to verifiable evidence. A scorecard then
answers the only question owners really care about: **what is done, what is partial, what is
missing — and how do we know?**

The method was extracted from a real multi-phase project (an audit → spec → PRD → seven-phase
plan → waves executed by parallel sub-agents). The templates, scripts and workflows in this
skill are the generalised versions of what worked there, and `references/10-pitfalls.md`
records what went wrong so you do not repeat it.

---

## 1. Pick the mode first

Look at the repository before asking anything. Then choose one mode (or a sequence of modes):

| Mode | Signals | Start at |
| --- | --- | --- |
| **A. New product** | Idea, brief, no code (or a fresh repo) | §3 Stage 0 → Stage 2 (spec) |
| **B. Existing codebase** | Code exists, no `docs/prd/tasks.json` | Stage 0 → Stage 1 (audit) |
| **C. Retrofit** | A PRD/roadmap exists as prose (Notion, Markdown, tickets) but no ledger | Stage 3 (normalise PRD) → Stage 4 |
| **D. Execute** | `docs/prd/tasks.json` exists and has `todo` tasks | Stage 6 (run the open wave) |
| **E. Verify & score** | User asks "what's done / missing / are we on track", or a phase is about to close | Stage 7 → Stage 8 |
| **F. Resume** | New session, other machine, or after a usage-limit stop | Stage 9 (handoff) → D or E |

Quick probe:

```bash
ls docs/prd docs/specs docs/audit 2>/dev/null; test -f docs/prd/tasks.json && node scripts/prd/prd.mjs status
git log --oneline -5; git branch -a | head -30
```

If `scripts/prd/prd.mjs` is absent but the ledger exists (older layout), run the skill's copy:
`node <skill-dir>/scripts/prd.mjs --root . status`.

---

## 2. What you will produce

```
docs/
  audit/<YYYY-MM>-<topic>/README.md      findings with ids, severity, evidence, root causes  (mode B)
  audit/<YYYY-MM>-<topic>/evidence/       screenshots, logs, probe output
  specs/<product>/README.md + 0n-*.md     vision, principles, scope, personas, glossary, domain specs
  prd/
    README.md            THE PRD: problem, goals, non-goals, users, FR/NFR tables, phases, DoD, risks, decisions
    EXECUTION.md         binding protocol: units of work, golden rules, branches, commits, gates, lanes, roles
    prd.config.json      project name, integration branch, gate checks, trailers, model policy
    tasks.json           the ledger — single source of truth for phases, waves, lanes, tasks, status, evidence
    phases/P<n>-<slug>.md  one plan per phase: exit criteria, finding→task map, wave diagram, file ownership, task tables
    SCORECARD.md         generated: requirements × implementation status with evidence (never hand-edited)
    LOCAL-HANDOFF.md     where work stopped and the exact next commands
    workflow-log/
      PROGRESS.md        generated status table
      TEMPLATE.md        wave log / phase-complete / decision templates
      <wave>-<date>.md   one per wave (append-only)
      <phase>-phase-complete-<date>.md
      decisions/<date>-<slug>.md   owner decisions and standing approvals
      pending-i18n/<task>.json     (optional) strings collected per task, merged by an integration task
scripts/prd/
  prd.mjs                ledger CLI: init, check, status, show, wave, next, set, progress, scorecard, integrate
  gate.mjs               configurable "no blocking issues" gate with a ratcheting baseline
  gate-baseline.json     numbers the gate compares against (only ever tightened)
.claude/workflows/
  prd-wave.js            implement → verify → fix → re-verify → integrate → log, in parallel worktrees
  prd-phase-exit.js      phase gate + exit-criteria evidence + adversarial challenge + close
  prd-scorecard.js       independent per-requirement audit that feeds the scorecard
```

Scaffold everything that does not exist yet (never overwrites):

```bash
node <skill-dir>/scripts/prd.mjs --root . init --project "<Product name>" --branch <integration-branch>
```

`init` copies the templates from `assets/templates/`, the scripts into `scripts/prd/`, and the
workflows into `.claude/workflows/`. Then fill the documents stage by stage.

---

## 3. The pipeline

Work through the stages in order. Each stage ends with a **commit** (and a push when a human is
following along), so progress is never lost. Each stage has a "done when" bar — do not move on
until it is met, because later stages assume it.

### Stage 0 — Intake (always, 5–10 minutes)

Infer as much as possible from the repo, README, package files, issue tracker and any document
the user points to. Then ask **only what you cannot infer**, in one batch (≤ 8 questions):

1. Who are the users and what job must the product do for them first? (one sentence each)
2. What does "usable" mean — the first milestone someone would actually rely on?
3. Hard constraints: deadline, budget, team size, hosting, compliance, offline, languages.
4. What is explicitly out of scope?
5. Integration branch and merge policy (merge commit vs squash; PR required?).
6. Who approves decisions, and may the agent widen a task's file scope when blocked only by ownership?
7. Test policy (unit/integration/e2e expectations, TDD?) and existing CI.
8. Model/cost policy for sub-agents (see `references/09-orchestration-and-models.md`).

Record standing answers as decision records (`workflow-log/decisions/`) so later sessions obey
them without asking again. **Done when:** mode chosen, constraints and owner rules written down.

### Stage 1 — Discovery / audit (mode B)

Find out what really works before planning. Static read of the code paths behind each user
journey **plus** running the app (or tests/probe) end to end. Every problem becomes a finding:
`<PREFIX>-<nn> · title`, severity P0/P1/P2, symptom, root cause with `file:line`, impact, fix
direction, evidence link, and (ideally) a probe check id that fails today and must pass later.
Group findings into systemic root causes — that is what keeps the plan small.
**Read `references/01-discovery-and-audit.md`.**
**Done when:** every golden-path step is classified (works / misleads / blocked) with evidence,
and a reproducible probe or scan exists that later gates can re-run.

### Stage 2 — Specification

Describe the target, independent of today's bugs: vision, principles, scope in/out, personas
and their primary jobs, a glossary of canonical terms, then one document per domain (data
model, workflows, rules, UX standards, architecture, quality & release). Specs carry the detail;
the PRD points into them by section. **Read `references/02-spec.md`.**
**Done when:** every capability the PRD will require has a spec section to link to, and terms
are used consistently (the glossary is the tie-breaker).

### Stage 3 — The PRD document

`docs/prd/README.md`: problem; measurable goals (G1…, each with a measure); non-goals; users;
**functional requirements** `FR-nn` and **non-functional** `NFR-nn` tables (id, requirement,
priority Must/Should/Could, phase, spec link, acceptance); release plan of phases with
dependencies and a dependency diagram; definition of done for task/wave/phase; risks with
mitigations; open decisions `DR-nn` (each tied to a task). **Read `references/03-prd-document.md`.**
**Done when:** every requirement is testable (someone could write the check), prioritised,
phased, and linked; every goal has a measure; every risk has a mitigation.

### Stage 4 — Phase plans and the ledger

Split each phase into **waves** (sets of tasks that can run in parallel because their files do
not overlap and their dependencies are met) and **lanes** (streams of related tasks that own a
set of files for a wave). Tasks are small (S/M/L, < 400 changed lines), one concern, test-first,
one commit. Write `phases/P<n>-*.md` (exit criteria, finding→task map, wave diagram, critical
path, file-ownership highlights, notes for implementers, task tables) and the machine-readable
`tasks.json`. **Read `references/04-phase-plans-and-ledger.md`** — it has the schema, sizing rules
and how to write acceptance criteria that a verifier can check.

Then validate:

```bash
node scripts/prd/prd.mjs check        # ids, deps, cycles, wave order, file overlaps, unmapped Must requirements, unmapped findings
node scripts/prd/prd.mjs scorecard    # baseline scorecard: everything "not started" or "unmapped"
```

**Done when:** `check` reports 0 errors; every Must requirement and every P0/P1 finding maps to at
least one task; every phase has numbered exit criteria that are commands or observable facts.

### Stage 5 — Tooling: gate, baseline, CI

Configure `prd.config.json` → `gate.checks` for this stack (typecheck, related tests, tests
accompany source, lint on changed files, forbidden patterns, project scanners), then capture the
baseline: `node scripts/prd/gate.mjs baseline --update --full`. Wire the gate into CI on pull
requests. **Read `references/05-execution-protocol.md` §4.**
**Done when:** `node scripts/prd/gate.mjs task --base HEAD` prints `GATE PASSED` on a clean tree,
and CI runs it.

### Stage 6 — Execute waves

One task → one squashed, gated commit on the wave branch. Implementers work in isolated git
worktrees; an adversarial verifier checks each task; at most one fix round, then re-verify;
integration is strictly serial; each approved task is committed **and pushed** immediately.
One wave = one branch (`prd/<wave>`) = one pull request into the integration branch, merged with
a merge commit. Run with the workflow:

```
Workflow({ name: "prd-wave", args: { wave: "P0-W1", date: "<YYYY-MM-DD>", pushTo: "prd/P0-W1", maxParallel: 2 } })
```

**Read `references/05-execution-protocol.md` and `references/09-orchestration-and-models.md`.**
**Done when:** every task of the wave is `done` or `deferred` (with owner), the wave log is
written, PROGRESS.md regenerated, the wave PR is green and merged.

### Stage 7 — Verify and review

Nothing is "done" because an implementer says so. The verifier assumes the change is wrong
until proven right: each acceptance criterion met/not met with command evidence, scope check,
the new test fails on the base and passes on the branch, forbidden patterns, the gate run
independently. Tasks merged without review are recorded as `review`, never `done`.
**Read `references/06-verification-and-review.md`** (prompts, verdict schema, review rubric,
phase-exit challenge).

### Stage 8 — Scorecard

`node scripts/prd/prd.mjs scorecard --write` regenerates `docs/prd/SCORECARD.md` from the
ledger: per requirement **Done / Partial / Missing / Not started / Deferred / Unmapped**, per
task acceptance criteria **Met / Partial / Missing / Unverified**, per finding open/closed, per
phase exit criteria, plus weighted coverage (Must ×3, Should ×2, Could ×1) and a gap list.
For an evidence-backed scorecard, run the independent audit first:

```
Workflow({ name: "prd-scorecard", args: { date: "<YYYY-MM-DD>", phase: "P0" } })
```

which writes criterion-level verification into the ledger before the scorecard is generated.
**Read `references/07-scorecard.md`** — the status rules are strict on purpose (e.g. "done but
unverified" never counts as Done).

### Stage 9 — Logs, decisions, handoff, phase exit

Wave logs and phase-complete logs are append-only. Decisions (including standing approvals)
get a decision record. `LOCAL-HANDOFF.md` always says where work stopped and the exact next
commands — update it at every checkpoint, not at the end. Close a phase with
`Workflow({ name: "prd-phase-exit", args: { phase: "P0", date: "<date>" } })`.
**Read `references/08-logs-decisions-handoff.md`.**

---

## 4. Golden rules (the short version of EXECUTION.md)

1. **Traceability is the product.** Requirement → task (`reqs`) → commit (`[task-id]` in the subject) → evidence (gate table, verifier verdict, scorecard). A change with no task id did not happen as far as the plan is concerned.
2. **One task, one commit** on the wave branch; task branches are squashed at integration. The ledger update rides in the task commit or the immediately following `chore(prd): record <id> commit` commit.
3. **The gate decides**, before every commit, against the real integrated result (`--base HEAD` after the squash). FAIL is blocking. The baseline only ever tightens.
4. **Test first.** A source change without a test needs an explicit, recorded waiver.
5. **Never weaken the bar** to pass: no skipped or deleted tests, no `--no-verify`, no edited baselines, no loosened lint rules. If the bar is wrong, open a task to change it and get it approved.
6. **Stay in your lane** (files listed on the card). Blocked only by file ownership → apply the owner's widening rule if one exists (record it in the task notes), otherwise stop and report.
7. **Independent verification.** The implementer never approves its own work. Unreviewed work is `review`, not `done`.
8. **Push early, push often.** Push each task as soon as it is integrated and every task branch before stopping; usage limits and container resets are routine.
9. **Serial integration, parallel implementation.** Never commit in the main checkout while an integrator is working there — the commit sweeps up its staged files.
10. **Logs are append-only and the handoff is always current.** Anyone (human or a new session) must be able to resume from `LOCAL-HANDOFF.md` and the newest wave log alone.

---

## 5. Conventions

| Thing | Format | Example |
| --- | --- | --- |
| Phase | `P<n>` | `P0` Stabilise |
| Wave | `<phase>-W<n>` | `P0-W3` |
| Lane | single capital letter per phase, `Z` = wave integration | `E` Finance |
| Task | `<phase>-<lane><nn>` | `P0-E04` |
| Follow-up / quality task | `<phase>-Q<nn>` | `P0-Q01` |
| Functional requirement | `FR-<nn>` | `FR-17` |
| Non-functional requirement | `NFR-<nn>` | `NFR-02` |
| Goal | `G<n>` | `G3` |
| Audit finding | `<PREFIX>-<nn>` | `SO-11` |
| Decision record | `DR-<nn>` or `decisions/<date>-<slug>.md` | `DR-02` |
| Probe check | `C<nn>` | `C11` |
| Gate check | `G<n>` (gate ids, not goals — the context disambiguates) | `G3` related tests |
| Task branch / fix | `prd/<task-id>`, `prd/<task-id>-fix<n>`, `prd/<task-id>-retry` | |
| Wave branch | `prd/<wave>` (local alias = integration branch name, see 05 §3) | `prd/P0-W3` |
| Commit subject | `<type>(<scope>): <imperative summary> [<task-id>]` | `fix(finance): record payments through useFinance [P0-E02]` |

Task statuses: `todo`, `in_progress`, `review`, `done`, `blocked`, `deferred`.
Scorecard statuses: requirement `done | partial | missing | not_started | deferred | unmapped`;
criterion `met | partial | missing | unverified`.

---

## 6. Command cheat sheet

```bash
node scripts/prd/prd.mjs status                    # phases, last done, blocked/review, next runnable per lane
node scripts/prd/prd.mjs show P0-C03               # full task card
node scripts/prd/prd.mjs wave P0-W2 [--json]       # wave tasks with readiness
node scripts/prd/prd.mjs next [--json]             # runnable tasks
node scripts/prd/prd.mjs set P0-C03 done --commit <sha> --date <d> [--note "..."]
node scripts/prd/prd.mjs check                     # ledger lint (run after every plan edit)
node scripts/prd/prd.mjs progress                  # regenerate workflow-log/PROGRESS.md
node scripts/prd/prd.mjs scorecard [--write] [--json] [--phase P0]
node scripts/prd/prd.mjs verify-import <file.json> [--promote]   # merge verification results; --promote: approved review → done
node scripts/prd/prd.mjs integrate P0-C03 prd/P0-C03 [--push-to prd/P0-W2] [--unreviewed] [--verification v.json]
node scripts/prd/gate.mjs task --task P0-C03 [--base <ref>] [--no-test-reason "<why>"]
node scripts/prd/gate.mjs phase [--full]
node scripts/prd/gate.mjs baseline --update [--full]   # tightens only
```

---

### Installing and adopting

- **Standard install:** `npx skills add compgeniuses/prd-builder` for the current project, or
  `npx skills add compgeniuses/prd-builder -g -y` for every agent on the machine. Source:
  <https://github.com/compgeniuses/prd-builder> — the repo root holds `README.md`, `LICENSE` and the
  `prd-builder/` skill folder, which is the layout the installer looks for.
- **One project, by hand:** copy the folder into the repo's `.claude/skills/` (Claude Code) or `.agents/skills/` and commit it, so the whole team gets the same version.
- **Every agent on one machine (recommended):** keep one canonical copy in the cross-agent store and link it everywhere, so no agent drifts:
  `~/.agents/skills/prd-builder/` (canonical) → junction/link into `~/.claude/skills/`, `~/.cursor/skills/`, `~/.codex/skills/`, `~/.gemini/skills/`, `~/.config/opencode/skills/` and any other agent's `skills/` folder.
  On Windows `mklink /J <link> <target>` (no admin needed), elsewhere `ln -s <target> <link>`. Edit the canonical copy only; re-link, never fork per agent.
- **Projects with an older PRD layout** (e.g. `scripts/prd/status.mjs` and a project-specific `gate.mjs` already exist): keep them. Add `docs/prd/prd.config.json`, copy only `scripts/prd/prd.mjs` and the `prd-scorecard` workflow, run `prd.mjs check`, fix errors, then `prd.mjs scorecard --write`. Past tasks show as *unverified* until their verdicts are imported or audited — that is correct, not a bug.
- **Agents without a workflow runner** (anything other than Claude Code): the `prd-wave` / `prd-scorecard` / `prd-phase-exit` workflows in `assets/workflows/` will not run there. Use the manual runbook in `05 §9` with one independent review agent; everything else (ledger, gate, logs, scorecard) is plain Node and works anywhere.
- **Self-test of the tools:** `node --test <skill-dir>/scripts/test/*.test.mjs` (needs Node ≥ 18 and git). The shipped tests and the default `gate.checks` commands are POSIX (`grep`, `true`, `npx …`); on Windows run them from Git Bash or WSL, or adapt the commands in `prd.config.json` to the stack.

## 7. Working with the owner

- Ask for decisions in one batch with a recommendation each; record answers as decision records.
- Report outcomes, not activity: what is done (with commits), what is blocked (with the exact reason and proposed fix), what needs the owner.
- When the owner overrides the process (e.g. "merge everything now"), do it, but record the deviation truthfully: status `review`, a note in the ledger, a line in the commit message and the wave log. The scorecard will then show it honestly.
- Estimate in waves and phases, and say what becomes **usable** at which point (usually the first phase exit with an end-to-end golden-path test).

---

## 8. Reference index (read when you reach the stage)

| File | Read when |
| --- | --- |
| `references/01-discovery-and-audit.md` | Auditing an existing product; writing findings and a probe |
| `references/02-spec.md` | Writing the specification set |
| `references/03-prd-document.md` | Writing `docs/prd/README.md` (requirements, goals, phases, DoD, risks) |
| `references/04-phase-plans-and-ledger.md` | Phases, waves, lanes, task cards, `tasks.json` schema, sizing, acceptance criteria |
| `references/05-execution-protocol.md` | Branches, commits, gate design, integration, wave PRs, problem handling |
| `references/06-verification-and-review.md` | Verifier/fixer prompts, verdict schema, review rubric, phase-exit challenge |
| `references/07-scorecard.md` | Scorecard statuses, scoring maths, evidence rules, reading the gap list |
| `references/08-logs-decisions-handoff.md` | Wave log, phase-complete log, decision records, PROGRESS, LOCAL-HANDOFF |
| `references/09-orchestration-and-models.md` | Sub-agent roles, workflows, worktrees, concurrency, model/effort routing, usage limits |
| `references/10-pitfalls.md` | Before the first wave, and whenever something odd happens |

Templates live in `assets/templates/`, workflows in `assets/workflows/`, scripts in `scripts/`.
