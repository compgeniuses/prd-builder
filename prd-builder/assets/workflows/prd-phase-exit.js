export const meta = {
  name: 'prd-phase-exit',
  description: 'Close a PRD phase: phase gate, evidence for every exit criterion, independent challenge of each claimed criterion, baseline tightening, scorecard, phase-complete log',
  whenToUse: 'After every task of a phase is done or deferred (node scripts/prd/prd.mjs status). Args: { phase, date, push?, pushTo?, trailers? }',
  phases: [
    { title: 'Check', detail: 'open tasks, phase gate, evidence per exit criterion' },
    { title: 'Challenge', detail: 'an independent skeptic tries to refute each criterion claimed as met' },
    { title: 'Close', detail: 'record exit results, tighten baseline, scorecard, phase log, commit' },
  ],
}

const A = args || {}
if (!A.phase || !A.date) throw new Error('args.phase (e.g. "P0") and args.date (YYYY-MM-DD) are required')
const TRAILERS = A.trailers || ''

const EVIDENCE = {
  type: 'object',
  properties: {
    open_tasks: { type: 'array', items: { type: 'string' } },
    integration_branch: { type: 'string' },
    gate_passed: { type: 'boolean' },
    gate_table: { type: 'string' },
    criteria: { type: 'array', items: { type: 'object', properties: {
      criterion: { type: 'string' }, met: { type: 'boolean' }, command: { type: 'string' }, evidence: { type: 'string' } },
      required: ['criterion', 'met', 'evidence'] } },
  },
  required: ['open_tasks', 'gate_passed', 'criteria'],
}
const CHALLENGE = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, evidence: { type: 'string' } },
  required: ['refuted', 'reason'],
}

phase('Check')
const ev = await agent(`You are collecting phase-exit evidence for phase ${A.phase}. Work in the main checkout; do not modify tracked files.
1. node scripts/prd/prd.mjs status ; list every task of ${A.phase} that is not done/deferred (open_tasks). Read integrationBranch from docs/prd/prd.config.json.
2. Run the phase gate: node scripts/prd/gate.mjs phase   (paste .prd-gate/report.md as gate_table).
3. Read the exit criteria: node -e 'const l=require("./docs/prd/tasks.json");console.log(JSON.stringify(l.phases.find(p=>p.id==="${A.phase}").exit_criteria,null,1))'
   For EACH criterion run the command or observation that proves or disproves it, and record met=true/false with the command and an output excerpt.
   A criterion you cannot check here (missing browser, data, credentials) is met=false with the reason.
Return the structured evidence.`, { label: `check:${A.phase}`, phase: 'Check', model: 'sonnet', effort: 'high', schema: EVIDENCE })

if (!ev) return { phase: A.phase, closed: false, reason: 'evidence agent failed' }

phase('Challenge')
const claimed = (ev.criteria || []).filter((c) => c.met)
const challenges = await parallel(claimed.map((c) => () => agent(`You are an independent SKEPTIC for the exit of phase ${A.phase}. Try to REFUTE this claim; default to refuted=true if you cannot reproduce the evidence yourself.
Claim: "${c.criterion}" is met.
Evidence offered: command: ${c.command || '(none)'} — ${c.evidence}
Re-run the check independently (read-only; a fresh worktree if you need to run builds). Look for: a stale or empty diff base, skipped checks reported as PASS,
evidence from a different commit, criteria that are only partly met, environment differences (CI variables, browsers).
Return refuted, reason, and your own evidence.`, { label: `challenge:${c.criterion.slice(0, 40)}`, phase: 'Challenge', model: 'opus', effort: 'medium', isolation: 'worktree', schema: CHALLENGE }).then((v) => ({ ...c, challenge: v }))))

const results = (ev.criteria || []).map((c) => {
  const ch = challenges.filter(Boolean).find((x) => x.criterion === c.criterion)
  const upheld = c.met && ch && ch.challenge && !ch.challenge.refuted
  return { criterion: c.criterion, status: upheld ? 'met' : 'missing', evidence: `${c.evidence}${ch && ch.challenge ? ` | challenge: ${ch.challenge.refuted ? 'REFUTED — ' : 'upheld — '}${ch.challenge.reason}` : ''}` }
})
const allMet = results.length > 0 && results.every((r) => r.status === 'met')
const closable = allMet && ev.gate_passed && !(ev.open_tasks || []).length
log(`${A.phase}: ${results.filter((r) => r.status === 'met').length}/${results.length} criteria upheld; gate ${ev.gate_passed ? 'PASS' : 'FAIL'}; open tasks ${(ev.open_tasks || []).length}`)

phase('Close')
const closeResult = await agent(`You are closing (or recording a failed exit attempt for) phase ${A.phase}. Work in the main checkout on the integration branch.
Exit results (JSON): ${JSON.stringify(results)}
Gate passed: ${ev.gate_passed} · Open tasks: ${JSON.stringify(ev.open_tasks || [])} · Closable: ${closable}
Gate report:
${ev.gate_table || '(none)'}

1. Write {"date":"${A.date}","phases":[{"id":"${A.phase}","exit_results":<the exit results above>}]} to docs/prd/verification/${A.phase}-exit-${A.date}.json and run:
   node scripts/prd/prd.mjs verify-import docs/prd/verification/${A.phase}-exit-${A.date}.json
2. ${closable ? `node scripts/prd/gate.mjs baseline --update --full ; node scripts/prd/prd.mjs complete-phase ${A.phase} --date ${A.date}` : 'Do NOT tighten the baseline or complete the phase.'}
3. node scripts/prd/prd.mjs scorecard --write && node scripts/prd/prd.mjs scorecard --phase ${A.phase} --write && node scripts/prd/prd.mjs progress
4. Write docs/prd/workflow-log/${A.phase}-${closable ? 'phase-complete' : 'phase-exit-attempt'}-${A.date}.md from docs/prd/workflow-log/TEMPLATE.md (phase section):
   exit criteria table with evidence and challenge outcome, gate report, scorecard summary (from SCORECARD-${A.phase}.md), baseline before → after,
   deferred tasks with owners, lessons learned, and ${closable ? '"How to start the next phase"' : 'the exact list of what must be fixed before the next attempt'}.
5. Update the top of docs/prd/LOCAL-HANDOFF.md.
6. git add docs/prd scripts/prd/gate-baseline.json && git commit -m "chore(prd): ${closable ? 'complete' : 'exit attempt'} ${A.phase} [${A.phase}]"${TRAILERS ? ` -m "${TRAILERS.replace(/"/g, '\\"')}"` : ''}
${A.pushTo ? `7. git push origin HEAD:${A.pushTo}` : A.push ? '7. git push (retry up to 4 times with 2s/4s/8s/16s waits on network errors).' : '7. Do not push.'}
Return a short plain-text summary: log path, commit sha, criteria met, scorecard Must coverage for ${A.phase}.`, { label: `close:${A.phase}`, phase: 'Close', model: 'haiku', effort: 'medium' })

return { phase: A.phase, closed: closable, results, gate_passed: ev.gate_passed, open_tasks: ev.open_tasks, log: closeResult }
