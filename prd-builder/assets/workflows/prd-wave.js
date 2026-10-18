export const meta = {
  name: 'prd-wave',
  description: 'Run one PRD wave: implement and verify tasks in parallel worktrees, integrate and push each approved task serially behind the gate, write the wave log',
  whenToUse: 'Execute the open wave of docs/prd (find it with: node scripts/prd/prd.mjs status). Args: { wave, date, pushTo?, only?, maxParallel?, trailers?, models?, opusTasks? }',
  phases: [
    { title: 'Load', detail: 'runnable tasks of the wave and project config from the ledger' },
    { title: 'Implement', detail: 'one implementer per task in its own git worktree, test first, task gate' },
    { title: 'Verify', detail: 'adversarial verifier per task; one fix round, then re-verify with a stronger model' },
    { title: 'Integrate', detail: 'as each task is approved: serial squash, gate --base HEAD, commit with verification, push' },
    { title: 'Log', detail: 'wave log, PROGRESS.md, SCORECARD.md, cleanup' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs and model policy (decision record: docs/prd/workflow-log/decisions/)
// ---------------------------------------------------------------------------
const A = args || {}
if (!A.wave || !A.date) throw new Error('args.wave (e.g. "P0-W1") and args.date (YYYY-MM-DD) are required')
const WAVE = A.wave
const DATE = A.date
const MAX_PARALLEL = A.maxParallel || 2
const TRAILERS = A.trailers || ''
const PUSH_TO = A.pushTo || null

const SIZE_EFFORT = { S: 'low', M: 'medium', L: 'high' }
function route(role, t) {
  const size = (t && t.size) || 'M'
  const forced = t && (A.opusTasks || []).includes(t.id)
  const defaults = {
    load: { model: 'haiku', effort: 'low' },
    implement: forced ? { model: 'opus', effort: 'medium' } : { model: 'sonnet', effort: SIZE_EFFORT[size] || 'medium' },
    verify: size === 'L' || forced ? { model: 'opus', effort: 'medium' } : { model: 'sonnet', effort: 'high' },
    fix: size === 'L' || forced ? { model: 'opus', effort: 'medium' } : { model: 'sonnet', effort: 'high' },
    reverify: { model: 'opus', effort: 'medium' },
    integrate: { model: 'haiku', effort: 'medium' },
    log: { model: 'haiku', effort: 'medium' },
  }
  return Object.assign({}, defaults[role], (A.models || {})[role])
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
phase('Load')
const loaded = await agent(
  `In the repository root run: node scripts/prd/prd.mjs wave ${WAVE} --json
Return its JSON verbatim as the structured result. Do not modify anything.`,
  {
    label: `load:${WAVE}`, phase: 'Load', ...route('load'),
    schema: {
      type: 'object',
      properties: {
        wave: { type: 'string' }, description: { type: 'string' },
        config: { type: 'object', properties: { project: { type: 'string' }, integrationBranch: { type: 'string' }, gateCommand: { type: 'string' }, prdDir: { type: 'string' } } },
        tasks: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string' }, lane: { type: 'string' }, size: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, runnable: { type: 'boolean' },
          waiting_on: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'array', items: { type: 'string' } }, test: { type: 'string' }, spec: { type: 'string' },
          findings: { type: 'array', items: { type: 'string' } }, reqs: { type: 'array', items: { type: 'string' } },
          deps_install: { type: 'boolean' }, depends_on: { type: 'array', items: { type: 'string' } },
        }, required: ['id', 'title', 'status', 'runnable', 'files', 'acceptance'] } },
      },
      required: ['wave', 'tasks'],
    },
  },
)
const CONF = (loaded && loaded.config) || {}
const BRANCH = A.integrationBranch || CONF.integrationBranch || 'main'
const GATE = CONF.gateCommand || 'node scripts/prd/gate.mjs'
const all = (loaded && loaded.tasks) || []
const tasks = all.filter((t) => t.runnable && (!A.only || A.only.includes(t.id)))
const skipped = all.filter((t) => !tasks.includes(t))
skipped.forEach((t) => log(`skip ${t.id}: status=${t.status}${t.waiting_on && t.waiting_on.length ? ', waiting on ' + t.waiting_on.join(', ') : ''}`))
if (!tasks.length) {
  log(`Nothing runnable in ${WAVE}.`)
  return { wave: WAVE, runnable: 0, skipped: skipped.map((t) => t.id) }
}
tasks.forEach((t) => log(`${t.id} [${t.size || '?'}]: implement ${route('implement', t).model}/${route('implement', t).effort}, verify ${route('verify', t).model}`))
log(`${tasks.length} runnable task(s) in ${WAVE}; up to ${MAX_PARALLEL} at a time; integration branch ${BRANCH}${PUSH_TO ? `, pushing each task to ${PUSH_TO}` : ''}`)

const COMMON = `
Binding rules: docs/prd/EXECUTION.md (read §2–§5 first) and the project's CLAUDE.md. Owner decisions that apply: docs/prd/workflow-log/decisions/ (e.g. scope widening).
The gate: ${GATE} task --task <id>   (must end with "GATE PASSED"; any FAIL is blocking).
Never edit the gate baseline or ratchet files to pass. Never skip, delete or weaken tests. Never use --no-verify.
`
const WORKTREE_SETUP = `
Worktree setup (you are in a fresh git worktree): link or install dependencies the way docs/prd/LOCAL-HANDOFF.md §1 describes
(for Node: MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)"); [ -e node_modules ] || ln -s "$MAIN/node_modules" node_modules).
If the task card says deps_install=true, install instead (this updates the lockfile; commit it).
`
const TASK_RESULT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'blocked'] }, branch: { type: 'string' }, head_sha: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } }, tests_added: { type: 'array', items: { type: 'string' } },
    gate_passed: { type: 'boolean' }, gate_table: { type: 'string' }, test_waiver: { type: 'string' },
    widened: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'branch', 'gate_passed', 'summary', 'blockers'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes_required'] },
    acceptance: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, status: { type: 'string', enum: ['met', 'partial', 'missing', 'unverified'] }, evidence: { type: 'string' } }, required: ['criterion', 'status', 'evidence'] } },
    blocking_findings: { type: 'array', items: { type: 'object', properties: { issue: { type: 'string' }, file: { type: 'string' }, fix: { type: 'string' } }, required: ['issue', 'fix'] } },
    non_blocking: { type: 'array', items: { type: 'string' } },
    scope_ok: { type: 'boolean' }, test_fails_on_base: { type: 'boolean' }, gate_passed: { type: 'boolean' },
  },
  required: ['verdict', 'acceptance', 'blocking_findings', 'scope_ok', 'gate_passed'],
}
const INTEGRATION = {
  type: 'object',
  properties: { id: { type: 'string' }, status: { type: 'string', enum: ['integrated', 'blocked'] }, commit_sha: { type: 'string' }, pushed: { type: 'boolean' }, gate_table: { type: 'string' }, reason: { type: 'string' } },
  required: ['id', 'status'],
}
const card = (t) => JSON.stringify({ id: t.id, size: t.size, title: t.title, lane: t.lane, files: t.files, acceptance: t.acceptance, test: t.test, spec: t.spec, findings: t.findings, reqs: t.reqs, depends_on: t.depends_on, deps_install: t.deps_install }, null, 2)

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const implementPrompt = (t) => `${COMMON}
You are the IMPLEMENTER for PRD task ${t.id} (wave ${WAVE}).
${WORKTREE_SETUP}
Task card:
${card(t)}

Steps:
1. git switch -c prd/${t.id} ${BRANCH}   (if the branch exists, use prd/${t.id}-retry).
2. Read the spec section in the card (relative to docs/), the audit finding(s), and every file you own.
3. Write the failing test described in "test" first; run it; confirm it fails for the right reason.
4. Implement the smallest change that meets every acceptance criterion. Edit ONLY the card's files plus new tests/fixtures.
   If another file must change: apply the owner's scope-widening decision if one exists (list the files in "widened"), otherwise STOP and return "blocked" naming the file and why.
5. Run the related tests until green, then the gate: ${GATE} task --task ${t.id} --base ${BRANCH}
   Fix and repeat until GATE PASSED. A failure that is pre-existing and outside your files → return "blocked" with evidence.
6. Commit on the branch ("wip(${t.id}): <summary>") and push it: git push -u origin prd/${t.id} (or the -retry name). Do not merge.
Return: status, branch, head_sha, files_changed, tests_added, gate_passed, gate_table (.prd-gate/report.md), widened, summary, blockers, test_waiver.`

const verifyPrompt = (t, impl) => `${COMMON}
You are the adversarial VERIFIER for PRD task ${t.id}. Assume the change is wrong until proven right. Do not modify, commit or push anything.
${WORKTREE_SETUP}
Then: git fetch origin ${impl.branch} 2>/dev/null; git switch --detach ${impl.branch}; BASE=$(git merge-base ${impl.branch} ${BRANCH})
Task card:
${card(t)}
Implementer summary: ${impl.summary}
Widened files claimed: ${JSON.stringify(impl.widened || [])}

Check with evidence (commands and output excerpts):
1. Each acceptance criterion: status met | partial | missing | unverified (cannot be checked here — say what is needed). Unverifiable is never "met".
2. Scope: git diff --name-only $BASE..HEAD contains only card files, new tests/fixtures, and widenings allowed by an owner decision (scope_ok).
3. Test quality: restore the base version of the changed source files (git checkout $BASE -- <files>), run the new tests, confirm they FAIL for the right reason, restore (git checkout ${impl.branch} -- <files>). Report test_fails_on_base.
4. Regressions: no calls to non-existent functions, no id coercion, no "as any as", no swallowed errors, no hard-coded market/domain terms in core code, no overwrite of data the change did not create, UI writes match the storage schema.
5. Run the gate yourself: ${GATE} task --task ${t.id} --base $BASE
6. Merge check: git merge-tree --write-tree ${BRANCH} HEAD
Verdict "approve" only if every criterion is met (or partial with a non-blocking reason), scope_ok, the test fails on base, and the gate passes.`

const fixPrompt = (t, impl, v) => `${COMMON}
You are the FIXER for PRD task ${t.id}. A verifier found blocking issues.
${WORKTREE_SETUP}
Then: git fetch origin ${impl.branch} 2>/dev/null; git switch -c prd/${t.id}-fix1 ${impl.branch}
Task card:
${card(t)}
Blocking findings:
${JSON.stringify(v.blocking_findings, null, 2)}
Criteria not met:
${JSON.stringify((v.acceptance || []).filter((a) => a.status !== 'met'), null, 2)}
Same rules as the implementer: stay in the card's files (plus owner-approved widenings), a test first for each finding, gate until GATE PASSED, commit "wip(${t.id}): address review", push the branch.
Return the implementer structure (branch = prd/${t.id}-fix1).`

// ---------------------------------------------------------------------------
// Integrate: as soon as a task is approved, strictly one at a time, then push
// ---------------------------------------------------------------------------
const integrations = []
let lock = Promise.resolve()
function integrate(r) {
  const t = r.task
  const verification = { date: DATE, tasks: [{ id: t.id, verdict: r.verdict.verdict, by: `verifier (${r.verifiedBy})`, criteria: r.verdict.acceptance, non_blocking: r.verdict.non_blocking || [] }] }
  const run = lock.then(async () => {
    const res = await agent(`You are the INTEGRATOR for PRD task ${t.id}. Work in the main checkout (not a worktree), on this one task only. Run commands exactly; never edit source files.
1. git switch ${BRANCH}; git status --porcelain --untracked-files=no must print nothing — otherwise return status "blocked", reason "checkout busy".
2. Write this JSON exactly to .prd-gate/verify-${t.id}.json (create the folder if needed):
${JSON.stringify(verification)}
3. Run: node scripts/prd/prd.mjs integrate ${t.id} ${r.branch} --verification .prd-gate/verify-${t.id}.json --date ${DATE}${PUSH_TO ? ` --push-to ${PUSH_TO}` : ''}
   It squashes, runs the gate with --base HEAD, commits, records the sha and ${PUSH_TO ? 'pushes' : 'does not push'}. It stops and explains on conflict or gate failure (the squash is reset; the task is marked blocked).
4. If it failed: return status "blocked" with the reason (conflicting files or FAIL lines). If the ledger shows an uncommitted "blocked" change, commit it: git commit -am "chore(prd): ${t.id} blocked at integration [${t.id}]"${TRAILERS ? ` -m "${TRAILERS.replace(/"/g, '\\"')}"` : ''}${PUSH_TO ? ` && git push origin ${BRANCH}:${PUSH_TO}` : ''}
Return id, status, commit_sha (the task commit, not the record commit), pushed, gate_table (.prd-gate/report.md).`,
      { label: `integrate:${t.id}`, phase: 'Integrate', ...route('integrate', t), schema: INTEGRATION })
    integrations.push(res || { id: t.id, status: 'blocked', reason: 'integrator failed' })
    if (res && res.status === 'integrated') log(`${t.id} integrated ${res.commit_sha}${res.pushed ? ' and pushed to ' + PUSH_TO : ''}`)
    return r
  })
  lock = run.catch(() => {})
  return run
}

async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try { results[i] = await fn(items[i], i) } catch (e) { results[i] = { task: items[i], outcome: 'blocked', reason: String(e) } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const reviewed = await pool(tasks, MAX_PARALLEL, async (t) => {
  const impl = await agent(implementPrompt(t), { label: `implement:${t.id}`, phase: 'Implement', ...route('implement', t), isolation: 'worktree', schema: TASK_RESULT })
  if (!impl || impl.status !== 'ready' || !impl.gate_passed) return { task: t, impl, outcome: 'blocked', reason: impl ? (impl.blockers || []).join('; ') || 'gate did not pass' : 'implementer failed' }
  const v = await agent(verifyPrompt(t, impl), { label: `verify:${t.id}`, phase: 'Verify', ...route('verify', t), isolation: 'worktree', schema: VERDICT })
  if (v && v.verdict === 'approve') return integrate({ task: t, impl, verdict: v, verifiedBy: route('verify', t).model, branch: impl.branch, outcome: 'approved' })
  const fix = await agent(fixPrompt(t, impl, v || { blocking_findings: [{ issue: 'verifier failed to run', fix: 're-run the gate and self-review' }] }), { label: `fix:${t.id}`, phase: 'Verify', ...route('fix', t), isolation: 'worktree', schema: TASK_RESULT })
  if (!fix || fix.status !== 'ready' || !fix.gate_passed) return { task: t, impl, verdict: v, fix, outcome: 'review', reason: 'fix round did not pass the gate' }
  const v2 = await agent(verifyPrompt(t, fix), { label: `re-verify:${t.id}`, phase: 'Verify', ...route('reverify', t), isolation: 'worktree', schema: VERDICT })
  if (v2 && v2.verdict === 'approve') return integrate({ task: t, impl: fix, verdict: v2, verifiedBy: route('reverify', t).model, branch: fix.branch, outcome: 'approved' })
  return { task: t, impl: fix, verdict: v2, outcome: 'review', reason: 'still has blocking findings after one fix round' }
})
await lock

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
phase('Log')
const summary = {
  wave: WAVE, date: DATE,
  integrated: integrations.filter((i) => i.status === 'integrated').map((i) => ({ id: i.id, commit: i.commit_sha, pushed: !!i.pushed })),
  blocked_at_integration: integrations.filter((i) => i.status !== 'integrated').map((i) => ({ id: i.id, reason: i.reason })),
  needs_review: reviewed.filter((r) => r && r.outcome === 'review').map((r) => ({ id: r.task.id, branch: r.impl && r.impl.branch, reason: r.reason, findings: r.verdict && r.verdict.blocking_findings })),
  blocked_in_implementation: reviewed.filter((r) => r && r.outcome === 'blocked').map((r) => ({ id: r.task.id, branch: r.impl && r.impl.branch, reason: r.reason })),
  skipped: skipped.map((t) => ({ id: t.id, status: t.status, waiting_on: t.waiting_on })),
  details: reviewed.filter(Boolean).map((r) => ({ id: r.task.id, outcome: r.outcome, branch: r.branch || (r.impl && r.impl.branch), summary: r.impl && r.impl.summary,
    tests_added: r.impl && r.impl.tests_added, test_waiver: r.impl && r.impl.test_waiver, widened: r.impl && r.impl.widened, verifier_non_blocking: r.verdict && r.verdict.non_blocking })),
}

const logResult = await agent(`${COMMON}
You are the LOGGER for wave ${WAVE}. Work in the main checkout on branch ${BRANCH}. Wave results (JSON):
${JSON.stringify(summary, null, 2)}

1. For tasks needing review or blocked in implementation: node scripts/prd/prd.mjs set <id> <review|blocked> --note "<short reason; branch <name>>"
2. Write docs/prd/workflow-log/${WAVE}-${DATE}.md following docs/prd/workflow-log/TEMPLATE.md (wave section): results with commits, gate summaries
   (git show <commit> for each integrated task), verifier non-blocking notes (each → proposed follow-up), waivers, widenings, deviations,
   blocked/review items with branches and exact next actions, the scorecard delta, and an exact "Next steps" list.
3. node scripts/prd/prd.mjs progress && node scripts/prd/prd.mjs scorecard --write
4. Update the top section of docs/prd/LOCAL-HANDOFF.md: state of every task of the wave (branch and sha on origin) and the next action.
5. git worktree prune; delete LOCAL branches of integrated tasks (keep remote branches).
6. git add docs/prd && git commit -m "chore(prd): log ${WAVE} [${WAVE}]"${TRAILERS ? ` -m "${TRAILERS.replace(/"/g, '\\"')}"` : ''}
${PUSH_TO ? `7. git push origin ${BRANCH}:${PUSH_TO} (retry up to 4 times with 2s/4s/8s/16s waits on network errors; never force).` : '7. Do not push.'}
Return a short plain-text summary: log path, commit sha, counts, scorecard Must coverage, next wave.`, { label: `log:${WAVE}`, phase: 'Log', ...route('log') })

return { summary, log: logResult }
