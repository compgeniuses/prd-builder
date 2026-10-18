export const meta = {
  name: 'prd-scorecard',
  description: 'Independently audit requirements against the implementation, grade every acceptance criterion with evidence, challenge Must requirements graded done, and regenerate SCORECARD.md',
  whenToUse: 'Before a phase exit, after a wave, or when the owner asks what is done / partial / missing. Args: { date, phase?, only?, push?, pushTo?, trailers? }',
  phases: [
    { title: 'Load', detail: 'requirements, mapped tasks and criteria from the ledger scorecard' },
    { title: 'Audit', detail: 'one read-only auditor per requirement grades criteria met / partial / missing / unverified with evidence' },
    { title: 'Challenge', detail: 'a stronger skeptic tries to refute Must requirements graded done' },
    { title: 'Record', detail: 'write verification JSON, import into the ledger, regenerate the scorecard, commit' },
  ],
}

const A = args || {}
if (!A.date) throw new Error('args.date (YYYY-MM-DD) is required')
const TRAILERS = A.trailers || ''
const phaseFlag = A.phase ? ` --phase ${A.phase}` : ''

phase('Load')
const sc = await agent(`In the repository root run: node scripts/prd/prd.mjs scorecard --json${phaseFlag}
Return only these parts of its JSON as the structured result: "requirements" (each with id, title, priority, phase, acceptance, status, tasks)
and "tasks" (each with id, title, size, status, commit, reqs, criteria). Do not modify anything.`, {
  label: 'load', phase: 'Load', model: 'haiku', effort: 'low',
  schema: {
    type: 'object',
    properties: {
      requirements: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string' }, phase: { type: 'string' }, acceptance: { type: 'string' }, status: { type: 'string' },
        tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, commit: { type: ['string', 'null'] } } } } },
        required: ['id', 'title', 'status', 'tasks'] } },
      tasks: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, title: { type: 'string' }, size: { type: 'string' }, status: { type: 'string' }, commit: { type: ['string', 'null'] },
        criteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, status: { type: 'string' } } } } },
        required: ['id', 'status'] } },
    },
    required: ['requirements', 'tasks'],
  },
})
if (!sc) return { error: 'load failed' }

const taskById = new Map(sc.tasks.map((t) => [t.id, t]))
const reqs = sc.requirements.filter((r) => (!A.only || A.only.includes(r.id)) && r.status !== 'deferred' && r.tasks.some((t) => ['done', 'review', 'in_progress'].includes(t.status)))
const skipped = sc.requirements.filter((r) => !reqs.includes(r))
log(`${reqs.length} requirement(s) with implemented work to audit; ${skipped.length} skipped (unmapped, deferred, not started, or filtered)`)

const AUDIT = {
  type: 'object',
  properties: {
    requirement: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'missing'] }, evidence: { type: 'string' } }, required: ['id', 'status', 'evidence'] },
    tasks: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, verdict: { type: 'string', enum: ['approve', 'changes_required'] },
      criteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, status: { type: 'string', enum: ['met', 'partial', 'missing', 'unverified'] }, evidence: { type: 'string' } }, required: ['criterion', 'status', 'evidence'] } },
      non_blocking: { type: 'array', items: { type: 'string' } } }, required: ['id', 'verdict', 'criteria'] } },
  },
  required: ['requirement', 'tasks'],
}
const CHALLENGE = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, evidence: { type: 'string' } }, required: ['refuted', 'reason'] }

const modelFor = (r) => (r.tasks.some((t) => (taskById.get(t.id) || {}).size === 'L') ? 'opus' : 'sonnet')

const audited = await pipeline(reqs,
  (r) => agent(`You are an independent AUDITOR for requirement ${r.id} (${r.priority || 'Must'}, phase ${r.phase || '—'}): "${r.title}".
Requirement acceptance: ${r.acceptance || '(none stated — use the mapped tasks\' criteria)'}
Mapped tasks: ${r.tasks.map((t) => `${t.id} (${t.status}${t.commit ? ' @' + t.commit : ''})`).join(', ')}
Read-only: do not modify, commit or push. You are in a fresh worktree at the integration branch tip; link dependencies as docs/prd/LOCAL-HANDOFF.md §1 describes.
For each mapped task that is done/review/in_progress: node scripts/prd/prd.mjs show <id> for its acceptance criteria, then grade EACH criterion
met | partial | missing | unverified with evidence: the named test (run it), probe/scan check output, or file:line plus the test that covers it.
Unverified = you could not check it here; say what is needed. Never mark met from the implementer's summary or commit message alone.
Then grade the requirement as a whole: done (fully satisfied as stated for the phases delivered so far), partial, or missing, with a one-paragraph evidence summary.
Return the structured audit.`, { label: `audit:${r.id}`, phase: 'Audit', model: modelFor(r), effort: 'medium', isolation: 'worktree', schema: AUDIT }),
  (audit, r) => {
    if (!audit || audit.requirement.status !== 'done' || !/must/i.test(r.priority || 'Must')) return { r, audit, challenge: null }
    return agent(`You are a SKEPTIC. An auditor graded Must requirement ${r.id} ("${r.title}") as DONE with this evidence:
${audit.requirement.evidence}
Criteria graded: ${JSON.stringify(audit.tasks.flatMap((t) => t.criteria))}
Try to refute it, read-only, in a fresh worktree: re-run the key tests/checks; look for criteria graded met on weak evidence, behaviour missing for some inputs,
schema/UI mismatches, or a requirement wider than what the tasks delivered. Default to refuted=true if you cannot reproduce the evidence.`,
      { label: `challenge:${r.id}`, phase: 'Challenge', model: 'opus', effort: 'medium', isolation: 'worktree', schema: CHALLENGE }).then((challenge) => ({ r, audit, challenge }))
  })

const results = audited.filter(Boolean).map((x) => x.r ? x : { r: null })
const verification = { date: A.date, by: 'prd-scorecard', tasks: [], requirements: [] }
for (const x of results) {
  if (!x.r || !x.audit) continue
  const refuted = x.challenge && x.challenge.refuted
  verification.requirements.push({ id: x.r.id, status: refuted ? 'partial' : x.audit.requirement.status,
    evidence: `${x.audit.requirement.evidence}${x.challenge ? ` | challenge: ${refuted ? 'REFUTED — ' : 'upheld — '}${x.challenge.reason}` : ''}` })
  for (const t of x.audit.tasks) if (!verification.tasks.some((v) => v.id === t.id)) verification.tasks.push({ ...t, by: `auditor (${modelFor(x.r)})` })
}
log(`audited ${verification.requirements.length} requirement(s), ${verification.tasks.length} task(s)`)

phase('Record')
const rec = await agent(`You are the RECORDER. Work in the main checkout. Do not edit anything except the files named here.
1. Write this JSON exactly to docs/prd/verification/scorecard-${A.date}${A.phase ? '-' + A.phase : ''}.json:
${JSON.stringify(verification)}
2. node scripts/prd/prd.mjs verify-import docs/prd/verification/scorecard-${A.date}${A.phase ? '-' + A.phase : ''}.json
3. node scripts/prd/prd.mjs scorecard --write${A.phase ? ` && node scripts/prd/prd.mjs scorecard --phase ${A.phase} --write` : ''} && node scripts/prd/prd.mjs progress
4. git add docs/prd && git commit -m "docs(prd): scorecard audit ${A.date}${A.phase ? ' ' + A.phase : ''} [${A.phase || 'PRD'}]"${TRAILERS ? ` -m "${TRAILERS.replace(/"/g, '\\"')}"` : ''}
${A.pushTo ? `5. git push origin HEAD:${A.pushTo}` : A.push ? '5. git push (retry up to 4 times with 2s/4s/8s/16s waits on network errors).' : '5. Do not push.'}
Return the scorecard summary lines printed in step 3 and the commit sha.`, { label: 'record', phase: 'Record', model: 'haiku', effort: 'medium' })

return { audited: verification.requirements, skipped: skipped.map((r) => ({ id: r.id, status: r.status })), record: rec }
