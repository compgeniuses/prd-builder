#!/usr/bin/env node
// ABOUTME: Configurable "no blocking issues" gate for PRD tasks and phases, driven by prd.config.json → gate.checks.
// ABOUTME: Compares metrics to a ratcheting baseline (only ever tightened) and checks tests, TDD, lint and forbidden patterns on the diff.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'task';
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const ROOT = path.resolve(opt('root', process.cwd()));

if (!['task', 'phase', 'baseline'].includes(mode) || flag('help')) {
  console.log(`Usage:
  node gate.mjs task  [--task <id>] [--base <ref>] [--no-test-reason "<why>"] [--allow-empty]
  node gate.mjs phase [--base <ref>]
  node gate.mjs baseline [--update] [--full]      # --update only ever lowers (tightens) stored numbers
Options: --root <repo>  --config <path to prd.config.json>`);
  process.exit(flag('help') ? 0 : 2);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cfgPath = [opt('config'), 'docs/prd/prd.config.json', 'prd.config.json'].filter(Boolean).map((p) => path.resolve(ROOT, p)).find((p) => fs.existsSync(p));
const CFG = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const G = CFG.gate || {};
const BASELINE = path.resolve(ROOT, G.baselineFile || 'scripts/prd/gate-baseline.json');
const REPORT_DIR = path.resolve(ROOT, G.reportDir || '.prd-gate');
const INTEGRATION = CFG.integrationBranch || 'main';
const SOURCE_RE = new RegExp(G.sourcePattern || '^(src|lib|app|packages/[^/]+/src)/.*\\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs)$');
const TEST_RE = new RegExp(G.testPattern || '(^|/)(__tests__|tests?|spec)/|\\.(test|spec)\\.[a-z]+$|_test\\.(go|py)$|^test_.*\\.py$');
const CHECKS = G.checks || [
  { id: 'G4', name: 'Source changes include tests (TDD)', type: 'tdd' },
  { id: 'G5', name: 'No encoding damage added', type: 'forbidden', patterns: ['\\u00c3[\\u0080-\\u00bf]', '\\u00e2\\u20ac', '\\u00c2\\u00a0'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sh(command) {
  const r = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const git = (args) => sh(`git ${args}`);
const quote = (f) => `"${f.replace(/"/g, '\\"')}"`;
const tail = (s, n = 25) => s.trim().split('\n').slice(-n).join('\n');

function resolveBase() {
  const given = opt('base');
  const rev = (ref) => { const r = git(`rev-parse --verify --quiet ${quote(`${ref}^{commit}`)}`); return r.ok ? r.out.trim() : null; };
  if (given) {
    const sha = rev(given);
    if (!sha) { console.error(`Cannot resolve --base ${given}`); process.exit(2); }
    return { sha, how: `--base ${given}` };
  }
  const branch = git('rev-parse --abbrev-ref HEAD').out.trim();
  if (branch === INTEGRATION) return { sha: rev('HEAD'), how: `HEAD of ${INTEGRATION} (uncommitted changes are the task)` };
  for (const ref of [INTEGRATION, `origin/${INTEGRATION}`]) {
    if (!rev(ref)) continue;
    const mb = git(`merge-base HEAD ${quote(ref)}`);
    if (mb.ok) return { sha: mb.out.trim(), how: `merge-base with ${ref}` };
  }
  return { sha: rev('HEAD'), how: 'HEAD (no integration branch found)' };
}

function changedFiles(base) {
  const tracked = git(`diff --name-only --diff-filter=ACMR ${base}`).out.split('\n').filter(Boolean);
  const untracked = git('ls-files --others --exclude-standard').out.split('\n').filter(Boolean);
  const deleted = git(`diff --name-only --diff-filter=D ${base}`).out.split('\n').filter(Boolean);
  return { files: [...new Set([...tracked, ...untracked])].filter((f) => !f.startsWith('.prd-gate/')), deleted };
}

function addedLines(base, files) {
  const out = [];
  let file = null;
  for (const line of git(`diff -U0 --no-color ${base}`).out.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (line.startsWith('+') && !line.startsWith('+++') && file) out.push({ file, text: line.slice(1) });
  }
  const untracked = new Set(git('ls-files --others --exclude-standard').out.split('\n').filter(Boolean));
  for (const f of files.filter((x) => untracked.has(x))) {
    try { for (const text of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) out.push({ file: f, text }); } catch { /* binary or unreadable: skip */ }
  }
  return out;
}

function measure(check) {
  const r = sh(check.command);
  if (!r.ok && !check.allowFail) return { error: `command failed (exit ${r.status}):\n${tail(r.out)}` };
  if (check.json) {
    let data;
    try { data = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { return { error: `could not parse JSON output:\n${tail(r.out)}` }; }
    const v = check.json.split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), data);
    if (typeof v === 'number') return { values: { [check.key]: v } };
    if (v && typeof v === 'object') return { values: Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number').map(([k, n]) => [`${check.key}.${k}`, n])) };
    return { error: `JSON path ${check.json} is not a number or object of numbers` };
  }
  if (check.extract) {
    const m = r.out.match(new RegExp(check.extract, 'm'));
    return m ? { values: { [check.key]: Number(m[1]) } } : { error: `pattern /${check.extract}/ not found in output:\n${tail(r.out)}` };
  }
  const re = new RegExp(check.count || '.+', 'm');
  return { values: { [check.key]: r.out.split('\n').filter((l) => re.test(l)).length } };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const results = [];
const record = (id, name, status, detail = '') => { results.push({ id, name, status, detail }); console.log(`${status.padEnd(4)} ${id} ${name}${detail ? ' — ' + detail : ''}`); };
const inScope = (c, m) => { const s = c.scope || 'both'; return s === 'both' || s === m || (m === 'baseline'); };

if (mode === 'baseline') {
  const full = flag('full');
  const next = { ...baseline };
  const changes = [];
  for (const c of CHECKS.filter((c) => c.type === 'metric' && ((c.scope || 'both') !== 'phase' || full))) {
    const r = measure(c);
    if (r.error) { console.log(`SKIP ${c.id} ${c.name} — ${r.error.split('\n')[0]}`); continue; }
    for (const [k, v] of Object.entries(r.values)) {
      const old = baseline[k];
      console.log(`${c.id} ${k}: ${old ?? '—'} → measured ${v}`);
      if (old === undefined || v < old) { next[k] = v; changes.push(`${k}: ${old ?? '—'} → ${v}`); }
    }
  }
  if (flag('update')) {
    next._updated = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(changes.length ? `Baseline tightened:\n  ${changes.join('\n  ')}` : 'Baseline unchanged (nothing improved; numbers are never raised).');
  } else console.log('(dry run — add --update to write; only lower numbers are written)');
  process.exit(0);
}

const base = resolveBase();
const { files, deleted } = changedFiles(base.sha);
console.log(`Gate ${mode}${opt('task') ? ` for ${opt('task')}` : ''} · base ${base.sha.slice(0, 12)} (${base.how}) · ${files.length} changed, ${deleted.length} deleted\n`);

if (mode === 'task' && !files.length && !deleted.length && !flag('allow-empty')) {
  record('G0', 'Diff is not empty', 'FAIL', `no changes against ${base.sha.slice(0, 12)} — wrong base? (pass --base <ref> or --allow-empty)`);
}

const sourceFiles = files.filter((f) => SOURCE_RE.test(f) && !TEST_RE.test(f));
const testFiles = files.filter((f) => TEST_RE.test(f));
let added = null;
for (const c of CHECKS.filter((c) => inScope(c, mode))) {
  const label = c.name || c.id;
  if (c.type === 'metric') {
    const r = measure(c);
    if (r.error) { record(c.id, label, c.optional ? 'WARN' : 'FAIL', r.error.split('\n')[0]); if (!c.optional) console.log(r.error); continue; }
    const worse = [], parts = [];
    for (const [k, v] of Object.entries(r.values)) {
      const b = baseline[k];
      parts.push(`${k} ${v}/${b ?? '—'}`);
      if (b !== undefined && v > b) worse.push(`${k} ${v} > ${b}`);
    }
    const missing = Object.keys(r.values).filter((k) => baseline[k] === undefined);
    record(c.id, label, worse.length ? 'FAIL' : missing.length ? 'WARN' : 'PASS', worse.length ? worse.join('; ') : `${parts.join(', ')}${missing.length ? ' (no baseline yet: run baseline --update)' : ''}`);
  } else if (c.type === 'command') {
    const filter = c.files ? new RegExp(c.files) : null;
    const sel = filter ? files.filter((f) => filter.test(f)) : files;
    const needsFiles = /\{changed(Tests|Sources)?\}/.test(c.command);
    const pick = { '{changed}': sel, '{changedTests}': testFiles.filter((f) => !filter || filter.test(f)), '{changedSources}': sourceFiles.filter((f) => !filter || filter.test(f)) };
    if (mode === 'task' && needsFiles && Object.entries(pick).every(([ph, list]) => !c.command.includes(ph) || !list.length)) { record(c.id, label, 'SKIP', 'no matching changed files'); continue; }
    let cmd = c.command.replace('{base}', base.sha).replace('{task}', opt('task') || '');
    for (const [ph, list] of Object.entries(pick)) cmd = cmd.split(ph).join(list.map(quote).join(' '));
    const r = sh(cmd);
    const summary = c.summary ? (r.out.match(new RegExp(c.summary, 'm')) || [])[0] : '';
    record(c.id, label, r.ok ? 'PASS' : (c.optional ? 'WARN' : 'FAIL'), r.ok ? (summary || '') : `exit ${r.status}${summary ? ' — ' + summary : ''}`);
    if (!r.ok) console.log(tail(r.out, 40));
  } else if (c.type === 'tdd') {
    if (mode !== 'task') continue;
    const waiver = opt('no-test-reason');
    if (!sourceFiles.length) record(c.id, label, 'SKIP', 'no source changes');
    else if (testFiles.length) record(c.id, label, 'PASS', `${testFiles.length} test file(s) changed for ${sourceFiles.length} source file(s)`);
    else if (waiver) record(c.id, label, 'WARN', `waiver: ${waiver}`);
    else record(c.id, label, 'FAIL', `${sourceFiles.length} source file(s) changed without a test (or pass --no-test-reason "<why>")`);
  } else if (c.type === 'forbidden') {
    added ||= addedLines(base.sha, files);
    const filter = c.files ? new RegExp(c.files) : null;
    const res = (c.patterns || []).map((p) => new RegExp(p));
    const hits = added.filter((a) => (!filter || filter.test(a.file)) && res.some((re) => re.test(a.text)));
    record(c.id, label, hits.length ? 'FAIL' : 'PASS', hits.length ? `${hits.length} added line(s): ${hits.slice(0, 5).map((h) => `${h.file}: ${h.text.trim().slice(0, 80)}`).join(' | ')}` : '');
  } else record(c.id, label, 'WARN', `unknown check type "${c.type}"`);
}

const failed = results.filter((r) => r.status === 'FAIL');
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, 'report.md'), [
  `# Gate ${mode}${opt('task') ? ` — ${opt('task')}` : ''}`, '', `Base \`${base.sha.slice(0, 12)}\` (${base.how}) · ${files.length} changed files · ${new Date().toISOString()}`, '',
  '| Check | Name | Status | Detail |', '| --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`), '',
  failed.length ? `**GATE FAILED** (${failed.map((f) => f.id).join(', ')})` : '**GATE PASSED**', ''].join('\n'));
console.log(`\n${failed.length ? `GATE FAILED (${failed.map((f) => f.id).join(', ')})` : 'GATE PASSED'} — ${results.length} checks, report: ${path.relative(ROOT, path.join(REPORT_DIR, 'report.md'))}`);
process.exit(failed.length ? 1 : 0);
