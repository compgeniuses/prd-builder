#!/usr/bin/env node
// ABOUTME: PRD ledger CLI: scaffolds a PRD, validates tasks.json, reports progress, integrates tasks and builds the scorecard.
// ABOUTME: Zero dependencies (Node >= 18); runs from the skill folder (--root <repo>) or copied to <repo>/scripts/prd/prd.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked', 'deferred'];
const CLOSED = new Set(['done', 'deferred']);
const CRITERION = ['met', 'partial', 'missing', 'unverified'];
const SIZE_WEIGHT = { S: 1, M: 2, L: 3 };
const PRIORITY_WEIGHT = { must: 3, should: 2, could: 1 };

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = rawArgs[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
  } else positional.push(a);
}
const ROOT = path.resolve(flags.root || process.cwd());
const command = positional[0] || 'status';

const HELP = `prd.mjs — PRD ledger tool

  node prd.mjs [--root <repo>] <command> [...]

  init --project "<name>" [--branch <integration>]   scaffold docs/prd, scripts/prd, .claude/workflows (never overwrites)
  status                                              phases, last done, blocked/review, next runnable per lane
  show <task>                                         full task card
  wave <wave> [--json]                                tasks of a wave with readiness (json includes config)
  next [--json]                                       runnable tasks
  set <task> <status> [--commit <sha>] [--date <d>] [--note "..."]
  complete-phase <phase> --date <d>
  check                                               validate the ledger (exit 1 on errors)
  progress                                            regenerate <prdDir>/workflow-log/PROGRESS.md
  scorecard [--write] [--json] [--phase P0] [--date <d>]
  verify-import <file.json> [--promote]               merge verification results; --promote sets approved review tasks to done
  integrate <task> <branch> [--push-to <branch>] [--unreviewed] [--verification <file.json>] [--date <d>] [--type fix] [--scope x]
                                                      squash → gate --base HEAD → commit → record sha → push (stops at the first failure)

Statuses: ${STATUSES.join(', ')}`;

if (flags.help || command === 'help') { console.log(HELP); process.exit(0); }

// ---------------------------------------------------------------------------
// Config and ledger
// ---------------------------------------------------------------------------
function loadConfig() {
  const candidates = [flags.config, 'docs/prd/prd.config.json', 'prd.config.json'].filter(Boolean).map((p) => path.resolve(ROOT, p));
  const found = candidates.find((p) => fs.existsSync(p));
  const user = found ? JSON.parse(fs.readFileSync(found, 'utf8')) : {};
  const prdDir = user.prdDir || 'docs/prd';
  return {
    project: user.project || path.basename(ROOT),
    integrationBranch: user.integrationBranch || 'main',
    prdDir,
    ledger: user.ledger || `${prdDir}/tasks.json`,
    requirementsSource: user.requirementsSource === undefined ? `${prdDir}/README.md` : user.requirementsSource,
    findingsSource: user.findingsSource || null,
    gateCommand: user.gateCommand || 'node scripts/prd/gate.mjs',
    installCommand: user.installCommand || null,
    lockfiles: user.lockfiles || ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'poetry.lock', 'Cargo.lock', 'go.sum'],
    trailers: user.trailers || [],
    _file: found || null,
  };
}
const CFG = loadConfig();
const LEDGER_PATH = path.resolve(ROOT, CFG.ledger);

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) { console.error(`No ledger at ${LEDGER_PATH}. Run: prd.mjs init --project "<name>"`); process.exit(1); }
  const l = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  l.phases ||= []; l.tasks ||= [];
  for (const t of l.tasks) { t.depends_on ||= []; t.files ||= []; t.acceptance ||= []; t.reqs ||= []; t.findings ||= []; }
  for (const p of l.phases) { p.waves ||= {}; p.lanes ||= {}; p.exit_criteria ||= []; }
  return l;
}
const saveLedger = (l) => fs.writeFileSync(LEDGER_PATH, JSON.stringify(l, null, 2) + '\n');

const waveNo = (w) => Number(String(w).split('-W')[1]);
const phaseNo = (p) => Number(String(p).replace(/^P/, ''));
const today = () => new Date().toISOString().slice(0, 10);

function model(l) {
  const byId = new Map(l.tasks.map((t) => [t.id, t]));
  const phaseOf = (id) => l.phases.find((p) => p.id === id);
  const waveClosed = (w) => l.tasks.filter((t) => t.wave === w).every((t) => CLOSED.has(t.status));
  // A phase starts when its start_after wave is closed, or else when every phase it depends on is complete.
  function phaseStarted(p) {
    if (!p) return true;
    if (p.start_after) {
      const [pid] = p.start_after.split('-');
      return l.tasks.filter((t) => t.phase === pid && waveNo(t.wave) <= waveNo(p.start_after)).every((t) => CLOSED.has(t.status));
    }
    return (p.depends_on || []).every((d) => {
      const dp = l.phases.find((x) => x.id === d);
      return !dp || dp.completed_at || l.tasks.filter((t) => t.phase === d).every((t) => CLOSED.has(t.status));
    });
  }
  function runnable(t) {
    if (t.status !== 'todo') return false;
    if (!phaseStarted(phaseOf(t.phase))) return false;
    if (!t.depends_on.every((d) => byId.get(d)?.status === 'done')) return false;
    return l.tasks.filter((x) => x.phase === t.phase && waveNo(x.wave) < waveNo(t.wave)).every((x) => CLOSED.has(x.status));
  }
  function openWave(p) { return Object.keys(p.waves).sort((a, b) => waveNo(a) - waveNo(b)).find((w) => !waveClosed(w)) || null; }
  function summary(p) {
    const ts = l.tasks.filter((t) => t.phase === p.id);
    const c = (s) => ts.filter((t) => t.status === s).length;
    const status = p.completed_at ? 'complete' : (c('done') || c('in_progress') || c('review') ? 'in progress' : (phaseStarted(p) ? 'ready' : 'waiting'));
    return { id: p.id, name: p.name, total: ts.length, done: c('done'), deferred: c('deferred'), blocked: c('blocked'), review: c('review'), inProgress: c('in_progress'), status, openWave: openWave(p) };
  }
  const lastDone = () => l.tasks.filter((t) => t.status === 'done' && t.completed_at).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))[0] || null;
  function nextByLane() {
    const out = {};
    for (const t of l.tasks.filter(runnable)) (out[`${t.phase} · ${t.lane}`] ||= []).push(t);
    return out;
  }
  return { byId, phaseOf, waveClosed, phaseStarted, runnable, openWave, summary, lastDone, nextByLane };
}

// ---------------------------------------------------------------------------
// Markdown parsing (requirements and findings)
// ---------------------------------------------------------------------------
const cellText = (c) => c.replace(/\*\*|`/g, '').trim();
function parseTables(md) {
  const lines = md.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const split = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cellText);
      const header = split(lines[i]).map((h) => h.toLowerCase());
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(split(lines[j])); j++; }
      tables.push({ header, rows });
      i = j - 1;
    }
  }
  return tables;
}
function parseRequirementsMarkdown(md) {
  const out = [];
  for (const { header, rows } of parseTables(md)) {
    const col = (...names) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
    const iId = 0, iReq = col('requirement', 'title'), iPri = col('priority'), iPhase = col('phase'), iSpec = col('spec'), iAcc = col('acceptance', 'target', 'measure');
    for (const r of rows) {
      const id = (r[iId] || '').match(/^(N?FR-\d+[a-z]?)/)?.[1];
      if (!id) continue;
      out.push({ id, title: r[iReq] || '', priority: iPri >= 0 ? r[iPri] : 'Must', phase: iPhase >= 0 ? r[iPhase] : '', spec: iSpec >= 0 ? r[iSpec] : '', acceptance: iAcc >= 0 ? r[iAcc] : '' });
    }
  }
  return out;
}
function parseFindingsMarkdown(md) {
  const out = [];
  let severity = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{2,6})\s+(.*)$/);
    if (!h) continue;
    const f = h[2].match(/^([A-Z][A-Z0-9]{0,5}-\d+)\s*[·:—–-]\s*(.+)$/);
    if (f) { out.push({ id: f[1], severity: severity || '', title: f[2].trim() }); continue; }
    const s = h[2].match(/\bP([0-3])\b/);
    if (s) severity = `P${s[1]}`;
  }
  return out;
}
function requirementsOf(l) {
  if (Array.isArray(l.requirements) && l.requirements.length) return l.requirements;
  const src = CFG.requirementsSource && path.resolve(ROOT, CFG.requirementsSource);
  if (src && fs.existsSync(src)) return parseRequirementsMarkdown(fs.readFileSync(src, 'utf8'));
  return [];
}
function findingsOf(l) {
  if (Array.isArray(l.findings) && l.findings.length) return l.findings;
  const src = CFG.findingsSource && path.resolve(ROOT, CFG.findingsSource);
  if (src && fs.existsSync(src)) return parseFindingsMarkdown(fs.readFileSync(src, 'utf8'));
  return [];
}
function phaseRange(phaseText) {
  const nums = [...String(phaseText || '').matchAll(/P(\d+)/g)].map((m) => Number(m[1]));
  return nums.length ? { from: Math.min(...nums), to: Math.max(...nums) } : null;
}
const priorityKey = (p) => (String(p || 'must').toLowerCase().match(/must|should|could/) || ['must'])[0];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
// File ownership entries are paths or globs, optionally followed by a note: "src/x/** (new)".
const cleanPattern = (f) => String(f).replace(/\s*\(.*\)\s*$/, '').trim();
function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); re += `(?:${g.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
// A concrete path the glob matches, used to test glob-vs-glob overlap heuristically.
const sampleOf = (g) => g.replace(/\*\*\//g, 'x/').replace(/\*\*/g, 'x').replace(/\*/g, 'x').replace(/\?/g, 'x').replace(/\{([^,}]*)[^}]*\}/g, '$1');
function filesOverlap(a, b) {
  const A = cleanPattern(a), B = cleanPattern(b);
  if (A === B) return true;
  const isGlob = (s) => /[*?{]/.test(s);
  if (!isGlob(A) && !isGlob(B)) return false;
  return globToRegex(A).test(isGlob(B) ? sampleOf(B) : B) || globToRegex(B).test(isGlob(A) ? sampleOf(A) : A);
}
function check(l) {
  const errors = [], warnings = [];
  const m = model(l);
  const seen = new Set();
  for (const t of l.tasks) {
    if (seen.has(t.id)) errors.push(`duplicate task id ${t.id}`);
    seen.add(t.id);
    const p = m.phaseOf(t.phase);
    if (!p) { errors.push(`${t.id}: phase ${t.phase} not declared`); continue; }
    if (!p.waves[t.wave]) errors.push(`${t.id}: wave ${t.wave} not declared in ${p.id}.waves`);
    if (Object.keys(p.lanes).length && !p.lanes[t.lane]) errors.push(`${t.id}: lane ${t.lane} not declared in ${p.id}.lanes`);
    if (!STATUSES.includes(t.status)) errors.push(`${t.id}: invalid status "${t.status}"`);
    if (t.status === 'done' && !t.commit) errors.push(`${t.id}: done without commit`);
    if (t.size && !SIZE_WEIGHT[t.size]) warnings.push(`${t.id}: size "${t.size}" is not S/M/L`);
    for (const d of t.depends_on) {
      const dep = m.byId.get(d);
      if (!dep) { errors.push(`${t.id}: unknown dependency ${d}`); continue; }
      if (dep.phase === t.phase && waveNo(dep.wave) > waveNo(t.wave)) errors.push(`${t.id}: depends on ${d} in a later wave (${dep.wave})`);
    }
    if (!t.acceptance.length) warnings.push(`${t.id}: no acceptance criteria`);
    if (!t.test) warnings.push(`${t.id}: no "test" (test-first description)`);
    if (!t.reqs.length && !t.findings.length) warnings.push(`${t.id}: no reqs and no findings (traceability gap)`);
    if (t.size === 'L' && t.acceptance.length > 5) warnings.push(`${t.id}: L task with ${t.acceptance.length} criteria — consider splitting`);
    if (t.status === 'done' && !t.verification) warnings.push(`${t.id}: done without recorded verification (counts as unverified in the scorecard)`);
  }
  // cycles
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { errors.push(`dependency cycle: ${[...stack, id].join(' → ')}`); return; }
    state.set(id, 1);
    for (const d of m.byId.get(id)?.depends_on || []) if (m.byId.has(d)) visit(d, [...stack, id]);
    state.set(id, 2);
  };
  for (const t of l.tasks) visit(t.id, []);
  // file overlap and deps_install per wave
  const byWave = {};
  for (const t of l.tasks) (byWave[t.wave] ||= []).push(t);
  for (const [w, ts] of Object.entries(byWave)) {
    const installers = ts.filter((t) => t.deps_install);
    if (installers.length > 1) errors.push(`${w}: ${installers.length} tasks change dependencies (${installers.map((t) => t.id).join(', ')}); max 1 per wave`);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      if (CLOSED.has(ts[i].status) && CLOSED.has(ts[j].status)) continue;
      for (const fa of ts[i].files) for (const fb of ts[j].files) {
        if (filesOverlap(fa, fb)) errors.push(`${w}: ${ts[i].id} and ${ts[j].id} both own ${fa === fb ? fa : `${fa} / ${fb}`}`);
      }
    }
  }
  // traceability
  const reqs = requirementsOf(l);
  const startedPhases = new Set(l.phases.filter((p) => m.summary(p).status !== 'waiting').map((p) => phaseNo(p.id)));
  for (const r of reqs) {
    if (priorityKey(r.priority) !== 'must') continue;
    const range = phaseRange(r.phase);
    const active = !range || [...startedPhases].some((n) => n >= range.from && n <= range.to);
    if (active && !l.tasks.some((t) => t.reqs.includes(r.id))) warnings.push(`requirement ${r.id} (Must) has no task`);
  }
  for (const f of findingsOf(l)) {
    if (!/P[01]/.test(f.severity || '')) continue;
    if (!l.tasks.some((t) => t.findings.includes(f.id))) warnings.push(`finding ${f.id} (${f.severity}) has no task`);
  }
  for (const p of l.phases) if (!p.exit_criteria.length) warnings.push(`phase ${p.id} has no exit criteria`);
  return { errors, warnings, requirements: reqs.length };
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------
function taskCriteria(t) {
  const v = t.verification;
  if (v && Array.isArray(v.criteria) && v.criteria.length) return v.criteria.map((c) => ({ criterion: c.criterion, status: CRITERION.includes(c.status) ? c.status : (c.met === true ? 'met' : c.met === false ? 'missing' : 'unverified'), evidence: c.evidence || '' }));
  const derived = t.status === 'done' ? (v && v.verdict === 'approve' ? 'met' : 'unverified') : t.status === 'review' ? 'unverified' : 'missing';
  const evidence = derived === 'met' ? `verifier approve ${v.date || ''}`.trim() : derived === 'unverified' ? 'no recorded verification' : '';
  return t.acceptance.map((a) => ({ criterion: a, status: derived, evidence }));
}
const CRIT_VALUE = { met: 1, partial: 0.5, unverified: 0.5, missing: 0 };
function taskCredit(t) {
  if (t.status === 'deferred') return null;
  const v = t.verification;
  if (t.status === 'done') {
    if (v && Array.isArray(v.criteria) && v.criteria.length) {
      const cs = taskCriteria(t);
      return cs.reduce((s, c) => s + CRIT_VALUE[c.status], 0) / cs.length;
    }
    return v && v.verdict === 'approve' ? 1 : 0.5;
  }
  if (t.status === 'review') return 0.5;
  if (t.status === 'in_progress') return 0.25;
  return 0;
}
const isVerified = (t) => t.status === 'done' && t.verification && (t.verification.verdict === 'approve' || (t.verification.criteria || []).length > 0);

function scorecard(l, opts = {}) {
  const m = model(l);
  const scopePhase = opts.phase || null;
  const tasksInScope = l.tasks.filter((t) => !scopePhase || t.phase === scopePhase);
  const audits = (l.verification && l.verification.requirements) || {};
  const due = (t) => {
    const p = m.phaseOf(t.phase);
    if (!p) return false;
    if (p.completed_at || t.status === 'blocked') return true;
    const ow = m.openWave(p);
    return ow ? waveNo(t.wave) < waveNo(ow) : true;
  };
  const reqRows = [];
  for (const r of requirementsOf(l)) {
    const range = phaseRange(r.phase);
    if (scopePhase && range && !(phaseNo(scopePhase) >= range.from && phaseNo(scopePhase) <= range.to)) continue;
    const mapped = tasksInScope.filter((t) => t.reqs.includes(r.id));
    const live = mapped.filter((t) => t.status !== 'deferred');
    let status, credit = 0, uncovered = '';
    if (!mapped.length) status = 'unmapped';
    else if (!live.length) status = 'deferred';
    else {
      const w = live.reduce((s, t) => s + (SIZE_WEIGHT[t.size] || 2), 0);
      credit = live.reduce((s, t) => s + (SIZE_WEIGHT[t.size] || 2) * taskCredit(t), 0) / w;
      const coversLast = scopePhase || !range || live.some((t) => phaseNo(t.phase) >= range.to);
      // A ranged requirement (P0→P2) delivered only in early phases earns credit for the covered share of its range.
      if (!coversLast) {
        const reached = Math.max(...live.map((t) => phaseNo(t.phase)));
        credit *= Math.max(0, reached - range.from + 1) / (range.to - range.from + 1);
      }
      const isDue = live.some(due) || (range && l.phases.some((p) => phaseNo(p.id) === range.from && p.completed_at));
      status = credit >= 0.999 && coversLast ? 'done' : credit > 0 ? 'partial' : isDue ? 'missing' : 'not_started';
      if (!coversLast) uncovered = `later phases up to P${range.to} have no mapped task yet`;
    }
    const audit = audits[r.id];
    const derived = status;
    if (audit && audit.status) status = audit.status;
    reqRows.push({ ...r, priorityKey: priorityKey(r.priority), status, derived, uncovered, credit: status === 'deferred' ? null : (audit && audit.status === 'done' ? 1 : audit && audit.status === 'missing' ? 0 : credit), audit: audit || null,
      tasks: mapped.map((t) => ({ id: t.id, status: t.status, verified: isVerified(t), commit: t.commit || null })) });
  }
  const scored = reqRows.filter((r) => r.status !== 'deferred');
  const weighted = (rows) => {
    const W = rows.reduce((s, r) => s + PRIORITY_WEIGHT[r.priorityKey], 0);
    return W ? rows.reduce((s, r) => s + PRIORITY_WEIGHT[r.priorityKey] * (r.credit || 0), 0) / W : null;
  };
  const counts = (rows) => Object.fromEntries(['done', 'partial', 'missing', 'not_started', 'deferred', 'unmapped'].map((s) => [s, rows.filter((r) => r.status === s).length]));
  const taskRows = tasksInScope.map((t) => {
    const cs = taskCriteria(t);
    const c = (s) => cs.filter((x) => x.status === s).length;
    return { id: t.id, phase: t.phase, wave: t.wave, title: t.title, size: t.size, status: t.status, verified: isVerified(t), commit: t.commit || null, credit: taskCredit(t),
      met: c('met'), partial: c('partial'), missing: c('missing'), unverified: c('unverified'), criteria: cs, reqs: t.reqs, findings: t.findings };
  });
  const findingRows = findingsOf(l).map((f) => {
    const mapped = tasksInScope.filter((t) => t.findings.includes(f.id) && t.status !== 'deferred');
    let status = 'unmapped';
    if (mapped.length) {
      const done = mapped.filter((t) => t.status === 'done');
      status = done.length === mapped.length ? (done.every(isVerified) ? 'closed' : 'closed_unverified') : done.length || mapped.some((t) => t.status === 'review') ? 'partial' : 'open';
    }
    return { ...f, status, tasks: mapped.map((t) => `${t.id} (${t.status})`) };
  }).filter((f) => !scopePhase || f.tasks.length || f.status === 'unmapped');
  const exitRows = l.phases.filter((p) => !scopePhase || p.id === scopePhase).flatMap((p) => p.exit_criteria.map((c, i) => {
    const r = (p.exit_results || []).find((x) => x.criterion === c) || (p.exit_results || [])[i];
    return { phase: p.id, criterion: c, status: r ? r.status || (r.met ? 'met' : 'missing') : 'not_assessed', evidence: r ? r.evidence || '' : '' };
  }));
  const gaps = [];
  for (const r of reqRows.filter((r) => r.priorityKey === 'must' && ['missing', 'unmapped'].includes(r.status))) gaps.push({ kind: 'Must requirement ' + r.status, id: r.id, detail: r.title, action: r.status === 'unmapped' ? 'Add or map a task (planning gap)' : 'Schedule/unblock its tasks' });
  for (const r of reqRows.filter((r) => r.priorityKey === 'must' && r.status === 'partial')) gaps.push({ kind: 'Must requirement partial', id: r.id, detail: `${Math.round((r.credit || 0) * 100)} % credit; tasks ${r.tasks.map((t) => `${t.id}:${t.status}${t.status === 'done' && !t.verified ? '(unverified)' : ''}`).join(', ')}${r.uncovered ? `; ${r.uncovered}` : ''}`, action: 'Finish/verify mapped tasks or plan the remaining phase work' });
  for (const t of taskRows.filter((t) => (t.status === 'done' && !t.verified) || t.status === 'review')) gaps.push({ kind: 'Unverified work', id: t.id, detail: t.title, action: 'Run an independent review and verify-import the verdict' });
  for (const t of taskRows.filter((t) => t.status === 'blocked')) gaps.push({ kind: 'Blocked task', id: t.id, detail: (l.tasks.find((x) => x.id === t.id).notes || '').slice(0, 160), action: 'Resolve the blocker' });
  for (const f of findingRows.filter((f) => /P[01]/.test(f.severity || '') && ['open', 'unmapped'].includes(f.status))) gaps.push({ kind: `Finding ${f.status}`, id: f.id, detail: f.title, action: f.status === 'unmapped' ? 'Map to a task' : 'Fix via its tasks' });
  return {
    project: l.project || CFG.project, date: opts.date || today(), phase: scopePhase,
    summary: { requirements: reqRows.length, counts: counts(reqRows), weighted: weighted(scored), must: weighted(scored.filter((r) => r.priorityKey === 'must')), mustCounts: counts(reqRows.filter((r) => r.priorityKey === 'must')),
      tasks: { total: taskRows.length, done: taskRows.filter((t) => t.status === 'done').length, verified: taskRows.filter((t) => t.verified).length, review: taskRows.filter((t) => t.status === 'review').length, blocked: taskRows.filter((t) => t.status === 'blocked').length } },
    perPhase: l.phases.map((p) => {
      const rows = reqRows.filter((r) => { const rg = phaseRange(r.phase); return !rg || (phaseNo(p.id) >= rg.from && phaseNo(p.id) <= rg.to); });
      const s = model(l).summary(p);
      return { id: p.id, name: p.name, status: s.status, tasksDone: s.done, tasksTotal: s.total, requirements: rows.length, must: weighted(rows.filter((r) => r.priorityKey === 'must' && r.status !== 'deferred')), counts: counts(rows) };
    }).filter((p) => !scopePhase || p.id === scopePhase),
    requirements: reqRows, tasks: taskRows, findings: findingRows, exit: exitRows, gaps,
  };
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`);
const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const LABEL = { done: '✅ Done', partial: '🟡 Partial', missing: '❌ Missing', not_started: '⚪ Not started', deferred: '⏸ Deferred', unmapped: '❓ Unmapped',
  met: '✅ met', unverified: '🔍 unverified', closed: '✅ Closed', closed_unverified: '🔍 Closed (unverified)', open: '❌ Open', not_assessed: '⚪ Not assessed' };
const label = (s) => LABEL[s] || s;

function renderScorecard(sc) {
  const L = [];
  const s = sc.summary;
  L.push(`# Scorecard — ${sc.project}${sc.phase ? ` (${sc.phase})` : ''}`, '',
    `_Generated by \`prd.mjs scorecard --write\` on ${sc.date} from the ledger — do not edit by hand. Method: prd-builder skill, references/07-scorecard.md._`, '');
  L.push('## Summary', '', '| Measure | Value |', '| --- | --- |',
    `| Requirements in scope | ${s.requirements} |`,
    `| ✅ Done · 🟡 Partial · ❌ Missing · ⚪ Not started · ⏸ Deferred · ❓ Unmapped | ${s.counts.done} · ${s.counts.partial} · ${s.counts.missing} · ${s.counts.not_started} · ${s.counts.deferred} · ${s.counts.unmapped} |`,
    `| **Must coverage** (verified credit, weighted) | **${pct(s.must)}** — ${s.mustCounts.done} done, ${s.mustCounts.partial} partial, ${s.mustCounts.missing + s.mustCounts.unmapped} missing/unmapped |`,
    `| Weighted coverage (Must ×3, Should ×2, Could ×1) | ${pct(s.weighted)} |`,
    `| Tasks done / verified / in review / blocked / total | ${s.tasks.done} / ${s.tasks.verified} / ${s.tasks.review} / ${s.tasks.blocked} / ${s.tasks.total} |`, '');
  L.push('## By phase', '', '| Phase | Name | Phase status | Tasks done | Requirements | Must coverage | Done | Partial | Missing | Not started | Unmapped |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of sc.perPhase) L.push(`| ${p.id} | ${esc(p.name)} | ${p.status} | ${p.tasksDone}/${p.tasksTotal} | ${p.requirements} | ${pct(p.must)} | ${p.counts.done} | ${p.counts.partial} | ${p.counts.missing} | ${p.counts.not_started} | ${p.counts.unmapped} |`);
  L.push('', '## Gaps (action list, most important first)', '');
  if (sc.gaps.length) { L.push('| # | Gap | Id | Detail | Action |', '| --- | --- | --- | --- | --- |'); sc.gaps.forEach((g, i) => L.push(`| ${i + 1} | ${g.kind} | \`${g.id}\` | ${esc(g.detail)} | ${g.action} |`)); }
  else L.push('_No gaps._');
  L.push('', '## Requirements vs implementation', '', '| Req | Priority | Phase | Requirement | Status | Credit | Tasks (status, ✓ = verified) | Evidence / audit |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of sc.requirements) {
    const tasks = r.tasks.length ? r.tasks.map((t) => `\`${t.id}\` ${t.status}${t.verified ? ' ✓' : ''}${t.commit ? ` @${t.commit}` : ''}`).join('<br>') : '—';
    const ev = r.audit ? `${esc(r.audit.evidence || '')} _(audit ${r.audit.date || ''}${r.derived !== r.status ? `; ledger says ${r.derived}` : ''})_` : '';
    L.push(`| ${r.id} | ${r.priority || ''} | ${esc(r.phase)} | ${esc(r.title)} | ${label(r.status)} | ${r.credit === null ? '—' : pct(r.credit)} | ${tasks} | ${ev} |`);
  }
  if (!sc.requirements.length) L.push('| — | | | No requirements found: add `requirements[]` to the ledger or FR/NFR tables to the PRD | | | | |');
  L.push('', '## Tasks: acceptance criteria', '', '| Task | Status | Verified | Met | Partial | Missing | Unverified | Credit | Commit | Title |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of sc.tasks.filter((t) => t.status !== 'todo' || sc.phase)) L.push(`| \`${t.id}\` | ${t.status} | ${t.verified ? '✓' : ''} | ${t.met} | ${t.partial} | ${t.missing} | ${t.unverified} | ${t.credit === null ? '—' : pct(t.credit)} | ${t.commit ? `\`${t.commit}\`` : ''} | ${esc(t.title)} |`);
  const detailed = sc.tasks.filter((t) => t.criteria.some((c) => c.status !== 'missing' || c.evidence));
  if (detailed.length) {
    L.push('', '<details><summary>Criterion-level evidence</summary>', '');
    for (const t of detailed) {
      L.push(`**${t.id}** — ${esc(t.title)}`, '');
      for (const c of t.criteria) L.push(`- ${label(c.status)} — ${esc(c.criterion)}${c.evidence ? ` _(evidence: ${esc(c.evidence)})_` : ''}`);
      L.push('');
    }
    L.push('</details>');
  }
  if (sc.findings.length) {
    L.push('', '## Audit findings closure', '', '| Finding | Severity | Title | Status | Tasks |', '| --- | --- | --- | --- | --- |');
    for (const f of sc.findings) L.push(`| ${f.id} | ${f.severity || ''} | ${esc(f.title)} | ${label(f.status)} | ${f.tasks.join(', ') || '—'} |`);
  }
  L.push('', '## Phase exit criteria', '', '| Phase | Criterion | Status | Evidence |', '| --- | --- | --- | --- |');
  for (const e of sc.exit) L.push(`| ${e.phase} | ${esc(e.criterion)} | ${label(e.status)} | ${esc(e.evidence)} |`);
  L.push('', '## How this is computed', '',
    '- Task credit: done + verified = criteria score (met 1, partial ½, unverified ½, missing 0) or 1 if approved without criteria; done without verification or review = ½; in progress = ¼; todo/blocked = 0; deferred excluded. Weighted by size (S 1, M 2, L 3).',
    '- Requirement: Done only when every mapped task is done and verified and the last phase of its range is covered; Partial with any credit; Missing when due (phase complete, wave passed, or a task blocked) with no credit; Not started otherwise; Unmapped when no task references it. An audit verdict (prd-scorecard) overrides the derived status.',
    '- Coverage weights: Must 3, Should 2, Could 1. Unmapped counts as 0.',
    '- Record verification with `prd.mjs verify-import <file.json>`; regenerate with `prd.mjs scorecard --write`.', '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
function renderProgress(l) {
  const m = model(l);
  const L = [];
  L.push('# PRD Progress', '', `_Generated by \`prd.mjs progress\` — do not edit by hand. Source of truth: [\`../tasks.json\`](../tasks.json)._`, '');
  const last = m.lastDone();
  L.push(`**Last completed task:** ${last ? `\`${last.id}\` ${last.title} (${last.completed_at}${last.commit ? `, commit \`${last.commit}\`` : ''})` : 'none yet'}`, '');
  try { const sc = scorecard(l); L.push(`**Scorecard:** Must coverage ${pct(sc.summary.must)} · ${sc.summary.counts.done} done, ${sc.summary.counts.partial} partial, ${sc.summary.counts.missing + sc.summary.counts.unmapped} missing/unmapped of ${sc.summary.requirements} requirements ([SCORECARD.md](../SCORECARD.md))`, ''); } catch { /* scorecard is optional here */ }
  L.push('## Phases', '', '| Phase | Name | Status | Done | Review | Deferred | Blocked | In progress | Total | Open wave |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of l.phases) { const s = m.summary(p); L.push(`| ${s.id} | ${esc(s.name)} | ${s.status} | ${s.done} | ${s.review} | ${s.deferred} | ${s.blocked} | ${s.inProgress} | ${s.total} | ${s.openWave || '—'} |`); }
  const stuck = l.tasks.filter((t) => t.status === 'blocked' || t.status === 'review');
  L.push('', '## Blocked / awaiting review', '', stuck.length ? stuck.map((t) => `- \`${t.id}\` (${t.status}) ${t.title} — ${t.notes || 'no note'}`).join('\n') : '_None._');
  const next = m.nextByLane();
  L.push('', '## Next runnable tasks by lane', '', Object.keys(next).length ? Object.entries(next).map(([k, ts]) => `- **${k}:** ${ts.map((t) => `\`${t.id}\` ${t.title}`).join('; ')}`).join('\n') : '_Nothing runnable — check blocked/review tasks or close the current phase._');
  const current = l.phases.find((p) => !p.completed_at);
  if (current) {
    L.push('', `## ${current.id} task status`, '', '| Task | Wave | Lane | Status | Commit | Title |', '| --- | --- | --- | --- | --- | --- |');
    for (const t of l.tasks.filter((x) => x.phase === current.id)) L.push(`| \`${t.id}\` | ${t.wave} | ${t.lane} | ${t.status} | ${t.commit ? `\`${t.commit}\`` : ''} | ${esc(t.title)} |`);
  }
  L.push('', '## How to continue', '', '1. `node scripts/prd/prd.mjs status` and read the newest file in `workflow-log/` (and `../LOCAL-HANDOFF.md`).',
    '2. Run the open wave: `Workflow({ name: "prd-wave", args: { wave: "<open wave>", date: "<YYYY-MM-DD>", pushTo: "prd/<open wave>" } })`, or one task by hand (EXECUTION.md, manual runbook).',
    '3. Before every commit: `node scripts/prd/gate.mjs task --task <id>` must print GATE PASSED.', '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Git helpers (integrate)
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: opts.shell || false, maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const git = (...args) => run('git', args);
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function integrate(l, id, branch) {
  const t = l.tasks.find((x) => x.id === id);
  if (!t) fail(`Unknown task ${id}`);
  if (!branch) fail('Usage: integrate <task> <branch>');
  if (git('log', '--format=%s', '-200').out.split('\n').some((s) => s.includes(`[${id}]`) && !s.startsWith('chore(prd): record'))) { console.log(`${id} already integrated (commit subject with [${id}] found)`); return; }
  const dirty = git('status', '--porcelain', '--untracked-files=no').out.trim();
  if (dirty) fail(`Working tree has tracked changes; commit or discard them first:\n${dirty}`);
  const date = flags.date || today();
  const reviewed = !flags.unreviewed;
  const sq = git('merge', '--squash', branch);
  if (!sq.ok) { git('reset', '--hard', 'HEAD'); fail(`${id} CONFLICT merging ${branch}:\n${sq.out.slice(-1500)}`); }
  const changed = git('diff', '--cached', '--name-only').out.split('\n').filter(Boolean);
  if (!changed.length) { fail(`${id}: squash of ${branch} produced no changes`); }
  if (CFG.installCommand && changed.some((f) => CFG.lockfiles.includes(path.basename(f)))) {
    const inst = run(CFG.installCommand, [], { shell: true });
    if (!inst.ok) { git('reset', '--hard', 'HEAD'); fail(`${id} INSTALL FAILED:\n${inst.out.slice(-1500)}`); }
  }
  console.log(`${id}: gating (${CFG.gateCommand} task --task ${id} --base HEAD) ...`);
  const gate = run(`${CFG.gateCommand} task --task ${id} --base HEAD`, [], { shell: true });
  const gateLines = gate.out.split('\n').filter((x) => /^(PASS|FAIL|WARN|SKIP)\s/.test(x));
  if (!gate.ok) {
    git('reset', '--hard', 'HEAD');
    const l2 = readLedger(); const t2 = l2.tasks.find((x) => x.id === id);
    t2.status = 'blocked'; t2.notes = [t2.notes, `integration gate failed ${date}: ${gateLines.filter((x) => x.startsWith('FAIL')).map((x) => x.split(/\s+/)[1]).join(', ')}`].filter(Boolean).join(' | ');
    saveLedger(l2);
    fail(`${id} GATE FAILED:\n${gateLines.filter((x) => x.startsWith('FAIL')).join('\n') || gate.out.slice(-1500)}\n(task marked blocked; ledger change left uncommitted)`);
  }
  const l2 = readLedger(); const t2 = l2.tasks.find((x) => x.id === id);
  t2.status = reviewed ? 'done' : 'review';
  if (reviewed) t2.completed_at = date;
  else t2.notes = [t2.notes, `integrated ${date} before independent review; verify before marking done`].filter(Boolean).join(' | ');
  if (flags.verification) {
    const vf = path.resolve(ROOT, String(flags.verification));
    if (fs.existsSync(vf)) applyVerification(l2, JSON.parse(fs.readFileSync(vf, 'utf8')), false);
    else console.error(`warning: verification file ${vf} not found; ledger records no verification`);
  }
  saveLedger(l2);
  git('add', '-A');
  const type = flags.type || (t.findings.length ? 'fix' : 'feat');
  const scope = flags.scope || t.phase.toLowerCase();
  const gateSummary = gateLines.map((x) => x.split(/\s+/).slice(0, 2).join(' ')).join(', ');
  const msg = [`${type}(${scope}): ${t.title} [${id}]`, '', `Squash of ${branch}.`, '',
    `Findings: ${t.findings.join(', ') || 'none'}`, `Requirements: ${t.reqs.join(', ') || 'none'}`, `Gate: task PASS — ${gateSummary}`,
    reviewed ? 'Reviewed: independent verifier approved before integration.' : 'Not yet independently reviewed; status=review.',
    ...(CFG.trailers.length ? ['', ...CFG.trailers] : [])].join('\n');
  const msgFile = path.join(ROOT, '.git', `PRD_MSG_${id}`);
  fs.writeFileSync(msgFile, msg + '\n');
  const c1 = git('commit', '-F', msgFile);
  if (!c1.ok) fail(`${id}: commit failed:\n${c1.out}`);
  const sha = git('rev-parse', '--short', 'HEAD').out.trim();
  const l3 = readLedger(); const t3 = l3.tasks.find((x) => x.id === id);
  t3.commit = sha; saveLedger(l3);
  fs.writeFileSync(msgFile, [`chore(prd): record ${id} commit [${id}]`, ...(CFG.trailers.length ? ['', ...CFG.trailers] : [])].join('\n') + '\n');
  git('add', path.relative(ROOT, LEDGER_PATH));
  const c2 = git('commit', '-F', msgFile);
  fs.rmSync(msgFile, { force: true });
  if (!c2.ok) fail(`${id}: record commit failed:\n${c2.out}`);
  console.log(`${id} INTEGRATED ${sha} (${reviewed ? 'done' : 'review'})`);
  if (flags['push-to']) {
    const target = String(flags['push-to']);
    const current = git('rev-parse', '--abbrev-ref', 'HEAD').out.trim();
    for (const wait of [0, 2000, 4000, 8000, 16000]) {
      if (wait) sleep(wait);
      const p = git('push', 'origin', `${current}:${target}`);
      if (p.ok) { console.log(`${id} pushed to origin/${target}`); return; }
      console.error(`push failed: ${p.out.trim().split('\n').pop()}`);
    }
    fail(`${id}: push to ${target} failed after retries (commits are local)`);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function copyIfAbsent(src, dest, replace) {
  if (fs.existsSync(dest)) { console.log(`keep    ${path.relative(ROOT, dest)}`); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let text = fs.readFileSync(src, 'utf8');
  if (replace) for (const [k, v] of Object.entries(replace)) text = text.split(`{{${k}}}`).join(v);
  fs.writeFileSync(dest, text);
  console.log(`create  ${path.relative(ROOT, dest)}`);
}
function init() {
  const project = flags.project && flags.project !== true ? String(flags.project) : path.basename(ROOT);
  const branch = flags.branch && flags.branch !== true ? String(flags.branch) : 'main';
  const date = flags.date || today();
  const R = { PROJECT: project, BRANCH: branch, DATE: date };
  const skillRoot = path.resolve(SELF_DIR, '..');
  const T = path.join(skillRoot, 'assets', 'templates');
  const W = path.join(skillRoot, 'assets', 'workflows');
  const map = [
    ['PRD-README.md', 'docs/prd/README.md'], ['EXECUTION.md', 'docs/prd/EXECUTION.md'], ['prd.config.json', 'docs/prd/prd.config.json'],
    ['tasks.json', 'docs/prd/tasks.json'], ['phase-plan.md', 'docs/prd/phases/P0-PLACEHOLDER.md'], ['LOCAL-HANDOFF.md', 'docs/prd/LOCAL-HANDOFF.md'],
    ['workflow-log-TEMPLATE.md', 'docs/prd/workflow-log/TEMPLATE.md'], ['decision-record.md', 'docs/prd/workflow-log/decisions/README.md'],
    ['spec-README.md', 'docs/specs/README.md'], ['audit-README.md', 'docs/audit/README.md'], ['gate-baseline.json', 'scripts/prd/gate-baseline.json'],
  ];
  if (!fs.existsSync(T)) fail(`Templates not found at ${T}; run init from the skill's copy of prd.mjs`);
  for (const [src, dest] of map) copyIfAbsent(path.join(T, src), path.resolve(ROOT, dest), R);
  for (const f of ['prd.mjs', 'gate.mjs']) copyIfAbsent(path.join(SELF_DIR, f), path.resolve(ROOT, 'scripts/prd', f));
  if (fs.existsSync(W)) for (const f of fs.readdirSync(W)) copyIfAbsent(path.join(W, f), path.resolve(ROOT, '.claude/workflows', f));
  const gi = path.resolve(ROOT, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!/^\.prd-gate\/?$/m.test(giText)) { fs.writeFileSync(gi, giText + (giText.endsWith('\n') || !giText ? '' : '\n') + '.prd-gate/\n'); console.log('update  .gitignore (.prd-gate/)'); }
  console.log(`\nNext: fill docs/prd/README.md (PRD), plan phases in docs/prd/phases/, add tasks to docs/prd/tasks.json,
configure gate checks in docs/prd/prd.config.json, then:
  node scripts/prd/prd.mjs check
  node scripts/prd/gate.mjs baseline --update --full
  node scripts/prd/prd.mjs scorecard --write`);
}

function fail(msg) { console.error(msg); process.exit(1); }

// Verification file format: { date, by, tasks: [{ id, verdict, criteria: [{ criterion, status|met, evidence }], non_blocking }],
// requirements: [{ id, status, evidence }], phases: [{ id, exit_results: [{ criterion, status, evidence }] }] }
function applyVerification(l, v, promote) {
  const byId = new Map(l.tasks.map((t) => [t.id, t]));
  let n = 0;
  for (const tv of v.tasks || []) {
    const t = byId.get(tv.id);
    if (!t) { console.error(`skip unknown task ${tv.id}`); continue; }
    t.verification = { date: tv.date || v.date || today(), verdict: tv.verdict || null, by: tv.by || v.by || null,
      criteria: (tv.criteria || []).map((c) => ({ criterion: c.criterion, status: CRITERION.includes(c.status) ? c.status : (c.met === true ? 'met' : c.met === false ? 'missing' : 'unverified'), evidence: c.evidence || '' })),
      non_blocking: tv.non_blocking || [] };
    if (promote && tv.verdict === 'approve' && t.status === 'review') { t.status = 'done'; t.completed_at = t.completed_at || t.verification.date; }
    n++;
  }
  for (const rv of v.requirements || []) {
    l.verification ||= {}; l.verification.requirements ||= {};
    l.verification.requirements[rv.id] = { status: rv.status, evidence: rv.evidence || '', date: rv.date || v.date || today(), by: rv.by || v.by || null };
    n++;
  }
  for (const pv of v.phases || []) {
    const p = l.phases.find((x) => x.id === pv.id);
    if (p) { p.exit_results = pv.exit_results || []; n++; }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
if (command === 'init') { init(); process.exit(0); }

const L = readLedger();
const M = model(L);

switch (command) {
  case 'status': {
    for (const p of L.phases) {
      const s = M.summary(p);
      console.log(`${s.id} ${String(s.name).padEnd(34)} ${s.status.padEnd(11)} ${s.done}/${s.total} done${s.review ? `, ${s.review} review` : ''}${s.blocked ? `, ${s.blocked} blocked` : ''}${s.openWave ? `, open wave ${s.openWave}` : ''}`);
    }
    const last = M.lastDone();
    console.log(`\nLast completed: ${last ? `${last.id} (${last.completed_at}${last.commit ? ' @' + last.commit : ''})` : 'none'}`);
    const stuck = L.tasks.filter((t) => t.status === 'blocked' || t.status === 'review');
    if (stuck.length) { console.log('\nBlocked / review:'); for (const t of stuck) console.log(`  ${t.id} ${t.status}: ${t.notes || t.title}`); }
    const next = M.nextByLane();
    console.log('\nNext runnable by lane:');
    for (const [k, ts] of Object.entries(next)) console.log(`  ${k}: ${ts.map((t) => t.id).join(', ')}`);
    if (!Object.keys(next).length) console.log('  (none)');
    break;
  }
  case 'show': {
    const t = M.byId.get(positional[1]);
    if (!t) fail(`Unknown task ${positional[1]}`);
    console.log(`${t.id} — ${t.title}
phase ${t.phase} · wave ${t.wave} · lane ${t.lane} · size ${t.size || '?'} · status ${t.status}${t.commit ? ' @' + t.commit : ''}
runnable now: ${M.runnable(t) ? 'yes' : 'no'}
depends on: ${t.depends_on.map((d) => `${d} (${M.byId.get(d)?.status})`).join(', ') || '—'}
requirements: ${t.reqs.join(', ') || '—'} · findings: ${t.findings.join(', ') || '—'}
spec: ${t.spec || '—'}${t.deps_install ? '\nchanges dependencies: yes' : ''}
files (lane ownership):
${t.files.map((f) => '  - ' + f).join('\n') || '  —'}
acceptance:
${t.acceptance.map((a) => '  - ' + a).join('\n') || '  —'}
test first: ${t.test || '—'}
verification: ${t.verification ? `${t.verification.verdict || ''} ${t.verification.date || ''} by ${t.verification.by || '?'}` : '—'}
notes: ${t.notes || '—'}`);
    break;
  }
  case 'wave': {
    const w = positional[1];
    if (!w) fail('Usage: wave <wave id>');
    const rows = L.tasks.filter((t) => t.wave === w).map((t) => ({ id: t.id, lane: t.lane, title: t.title, size: t.size, status: t.status, runnable: M.runnable(t),
      waiting_on: t.depends_on.filter((d) => M.byId.get(d)?.status !== 'done'), files: t.files, acceptance: t.acceptance, test: t.test, spec: t.spec,
      findings: t.findings, reqs: t.reqs, deps_install: !!t.deps_install, depends_on: t.depends_on }));
    if (flags.json) console.log(JSON.stringify({ wave: w, description: L.phases.find((p) => p.waves[w])?.waves[w] || '', config: { project: CFG.project, integrationBranch: CFG.integrationBranch, gateCommand: CFG.gateCommand, prdDir: CFG.prdDir }, tasks: rows }, null, 2));
    else for (const r of rows) console.log(`${r.runnable ? 'READY ' : r.status.toUpperCase().padEnd(6)} ${r.id} [${r.lane}/${r.size || '?'}] ${r.title}${r.waiting_on.length ? '  (waiting on ' + r.waiting_on.join(', ') + ')' : ''}`);
    break;
  }
  case 'next': {
    const list = L.tasks.filter(M.runnable);
    if (flags.json) console.log(JSON.stringify(list.map((t) => ({ id: t.id, wave: t.wave, lane: t.lane, size: t.size, title: t.title })), null, 2));
    else for (const t of list) console.log(`${t.id} (${t.wave}, lane ${t.lane}) ${t.title}`);
    break;
  }
  case 'set': {
    const [, id, status] = positional;
    const t = M.byId.get(id);
    if (!t) fail(`Unknown task ${id}`);
    if (!STATUSES.includes(status)) fail(`Status must be one of ${STATUSES.join(', ')}`);
    t.status = status;
    if (flags.commit) t.commit = String(flags.commit);
    if (flags.note) t.notes = [t.notes, String(flags.note)].filter(Boolean).join(' | ');
    if (status === 'done') t.completed_at = flags.date || t.completed_at || today();
    saveLedger(L);
    console.log(`${id} → ${status}${t.commit ? ' @' + t.commit : ''}`);
    break;
  }
  case 'complete-phase': {
    const p = M.phaseOf(positional[1]);
    if (!p) fail(`Unknown phase ${positional[1]}`);
    const open = L.tasks.filter((t) => t.phase === p.id && !CLOSED.has(t.status));
    if (open.length) fail(`Cannot complete ${p.id}: open tasks ${open.map((t) => t.id).join(', ')}`);
    p.completed_at = flags.date || today();
    saveLedger(L);
    console.log(`${p.id} marked complete (${p.completed_at})`);
    break;
  }
  case 'check': {
    const r = check(L);
    for (const e of r.errors) console.log(`ERROR ${e}`);
    for (const w of r.warnings) console.log(`WARN  ${w}`);
    console.log(`\n${L.tasks.length} tasks, ${L.phases.length} phases, ${r.requirements} requirements — ${r.errors.length} errors, ${r.warnings.length} warnings`);
    process.exitCode = r.errors.length ? 1 : 0;
    break;
  }
  case 'progress': {
    const out = path.resolve(ROOT, CFG.prdDir, 'workflow-log', 'PROGRESS.md');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderProgress(L));
    console.log(`Wrote ${path.relative(ROOT, out)}`);
    break;
  }
  case 'scorecard': {
    const sc = scorecard(L, { phase: flags.phase && flags.phase !== true ? String(flags.phase) : null, date: flags.date && flags.date !== true ? String(flags.date) : null });
    if (flags.json) { console.log(JSON.stringify(sc, null, 2)); break; }
    const md = renderScorecard(sc);
    if (flags.write) {
      const name = sc.phase ? `SCORECARD-${sc.phase}.md` : 'SCORECARD.md';
      const out = path.resolve(ROOT, CFG.prdDir, name);
      fs.writeFileSync(out, md);
      console.log(`Wrote ${path.relative(ROOT, out)}`);
    }
    const s = sc.summary;
    console.log(`Requirements ${s.requirements}: done ${s.counts.done}, partial ${s.counts.partial}, missing ${s.counts.missing}, not started ${s.counts.not_started}, deferred ${s.counts.deferred}, unmapped ${s.counts.unmapped}`);
    console.log(`Must coverage ${pct(s.must)} · weighted coverage ${pct(s.weighted)} · tasks done ${s.tasks.done}/${s.tasks.total} (verified ${s.tasks.verified}) · gaps ${sc.gaps.length}`);
    break;
  }
  case 'verify-import': {
    const file = positional[1];
    if (!file || !fs.existsSync(path.resolve(ROOT, file))) fail('Usage: verify-import <file.json>');
    const n = applyVerification(L, JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8')), !!flags.promote);
    saveLedger(L);
    console.log(`Imported ${n} verification record(s) from ${file}`);
    break;
  }
  case 'integrate': integrate(L, positional[1], positional[2]); break;
  default: fail(`Unknown command "${command}".\n\n${HELP}`);
}
