// ABOUTME: End-to-end tests for the prd-builder scripts (prd.mjs, gate.mjs) against a throwaway git repository.
// ABOUTME: Run with: node --test <skill-dir>/scripts/test/*.test.mjs   (Node >= 18, git on PATH; no other dependencies).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-tools-'));
const REPO = path.join(tmp, 'repo');
const REMOTE = path.join(tmp, 'remote.git');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || REPO, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const git = (...a) => run('git', a);
const prd = (...a) => run('node', ['scripts/prd/prd.mjs', ...a]);
const gate = (...a) => run('node', ['scripts/prd/gate.mjs', ...a]);
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true }); fs.writeFileSync(path.join(REPO, rel), text); };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
const writeJson = (rel, v) => write(rel, JSON.stringify(v, null, 2) + '\n');

test.before(() => {
  fs.mkdirSync(REPO);
  git('init', '-q', '-b', 'main'); git('config', 'commit.gpgsign', 'false');
  write('package.json', '{"type":"module"}\n');
  write('src/math.js', 'export const add = (a, b) => a + b;\n');
  git('add', '.'); git('commit', '-qm', 'init');
  run('git', ['init', '-q', '--bare', REMOTE], { cwd: tmp });
  git('remote', 'add', 'origin', REMOTE); git('push', '-q', 'origin', 'main');
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('init scaffolds without overwriting', () => {
  const r = run('node', [path.join(SKILL, 'scripts/prd.mjs'), '--root', REPO, 'init', '--project', 'Demo', '--branch', 'main', '--date', '2026-01-01']);
  assert.equal(r.code, 0, r.out);
  for (const f of ['docs/prd/README.md', 'docs/prd/EXECUTION.md', 'docs/prd/tasks.json', 'docs/prd/prd.config.json', 'scripts/prd/prd.mjs', 'scripts/prd/gate.mjs', '.claude/workflows/prd-wave.js', '.claude/workflows/prd-scorecard.js'])
    assert.ok(fs.existsSync(path.join(REPO, f)), f);
  assert.match(fs.readFileSync(path.join(REPO, 'docs/prd/EXECUTION.md'), 'utf8'), /Integration branch: \*\*`main`\*\*/);
  const again = run('node', [path.join(SKILL, 'scripts/prd.mjs'), '--root', REPO, 'init', '--project', 'Other']);
  assert.match(again.out, /keep\s+docs[\\/]prd[\\/]README\.md/);
});

test('configure a small plan and gate', () => {
  const cfg = readJson('docs/prd/prd.config.json');
  // The counter is a Node script, not `grep -rn TODO src || true`: the gate runs its commands through a
  // shell, so the check must work in cmd.exe as well as sh.
  write('scripts/audit/todos.mjs', [
    "import fs from 'node:fs';",
    "const dir = 'src';",
    "for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {",
    "  const p = `${dir}/${f}`;",
    "  if (!fs.statSync(p).isFile()) continue;",
    "  fs.readFileSync(p, 'utf8').split(/\\r?\\n/).forEach((line, i) => {",
    "    if (line.includes('TODO')) console.log(`${p}:${i + 1}:${line}`);",
    "  });",
    "}",
    '',
  ].join('\n'));
  cfg.gate.checks = [
    { id: 'G1', name: 'TODO count does not increase', type: 'metric', key: 'todos', command: 'node scripts/audit/todos.mjs', count: 'TODO' },
    { id: 'G3', name: 'Related tests pass', type: 'command', scope: 'task', command: 'node --test {changedTests}', files: '\\.js$' },
    { id: 'G4', name: 'Source changes include tests (TDD)', type: 'tdd' },
    { id: 'G6', name: 'No forbidden patterns added', type: 'forbidden', files: '^src/', patterns: ['debugger;'] },
  ];
  writeJson('docs/prd/prd.config.json', cfg);
  write('docs/prd/README.md', ['# Demo', '| ID | Requirement | Priority | Phase | Spec | Acceptance |', '| --- | --- | --- | --- | --- | --- |',
    '| FR-01 | Adds numbers | Must | P0 | — | add test |', '| FR-02 | Multiplies numbers | Must | P0→P1 | — | mul test |',
    '| FR-03 | Exports CSV | Should | P1 | — | csv test |', '| NFR-01 | Fast | Could | P0 | <1ms | bench |', ''].join('\n'));
  const l = readJson('docs/prd/tasks.json');
  const base = l.tasks[0];
  l.phases[0].waves = { 'P0-W1': 'one', 'P0-W2': 'two' };
  l.phases.push({ id: 'P1', name: 'Second', depends_on: ['P0'], lanes: { A: 'a' }, waves: { 'P1-W1': 'x' }, exit_criteria: ['x'] });
  l.tasks = [
    { ...base, id: 'P0-A01', title: 'Add mul()', files: ['src/mul.js'], acceptance: ['mul(2,3)=6'], test: 'mul test', reqs: ['FR-02'] },
    { ...base, id: 'P0-A02', title: 'Overlapping owner', files: ['src/**'], acceptance: ['x'], test: 't', reqs: ['FR-01'] },
    { ...base, id: 'P1-A01', phase: 'P1', wave: 'P1-W1', title: 'CSV', files: ['src/csv.js'], acceptance: ['csv'], test: 't', reqs: ['FR-03'], depends_on: ['P0-A01'] },
  ];
  writeJson('docs/prd/tasks.json', l);
});

test('check reports file overlap within a wave, then passes', () => {
  const bad = prd('check');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /P0-A01 and P0-A02 both own/);
  const l = readJson('docs/prd/tasks.json');
  Object.assign(l.tasks[1], { wave: 'P0-W2', files: ['src/math.js'], depends_on: ['P0-A01'] });
  writeJson('docs/prd/tasks.json', l);
  const good = prd('check');
  assert.equal(good.code, 0, good.out);
  git('add', '-A'); git('commit', '-qm', 'plan');
});

test('baseline only tightens and is written once', () => {
  assert.equal(gate('baseline', '--update', '--full').code, 0);
  assert.equal(readJson('scripts/prd/gate-baseline.json').todos, 0);
  git('commit', '-qam', 'baseline');
});

test('phase dependencies gate runnability', () => {
  const s = prd('status').out;
  assert.match(s, /P1 Second\s+waiting/);
  assert.doesNotMatch(s, /P1 · A/);
});

test('gate: TDD failure, pass with a test, loud failure on an empty diff', () => {
  git('switch', '-q', '-c', 'prd/P0-A01');
  write('src/mul.js', 'export const mul = (a, b) => a * b;\n');
  const noTest = gate('task', '--task', 'P0-A01');
  assert.equal(noTest.code, 1); assert.match(noTest.out, /FAIL G4/);
  write('test/mul.test.js', "import test from 'node:test'; import assert from 'node:assert'; import { mul } from '../src/mul.js';\ntest('mul', () => assert.equal(mul(2, 3), 6));\n");
  const ok = gate('task', '--task', 'P0-A01');
  assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /PASS G3/);
  git('add', '-A'); git('commit', '-qm', 'wip(P0-A01)'); git('switch', '-q', 'main');
  const empty = gate('task', '--task', 'P0-A01');
  assert.equal(empty.code, 1); assert.match(empty.out, /FAIL G0 Diff is not empty/);
});

test('gate: forbidden pattern in an added line fails', () => {
  write('src/dbg.js', 'debugger;\n'); write('test/dbg.test.js', "import test from 'node:test'; test('x', () => {});\n");
  const r = gate('task', '--allow-empty');
  assert.equal(r.code, 1); assert.match(r.out, /FAIL G6/);
  fs.rmSync(path.join(REPO, 'src/dbg.js')); fs.rmSync(path.join(REPO, 'test/dbg.test.js'));
});

test('integrate: squash, gate, commit with verification, record, push; idempotent', () => {
  write('.prd-gate/v.json', JSON.stringify({ date: '2026-01-02', tasks: [{ id: 'P0-A01', verdict: 'approve', criteria: [{ criterion: 'mul(2,3)=6', status: 'met', evidence: 'test passes' }] }] }));
  const r = prd('integrate', 'P0-A01', 'prd/P0-A01', '--verification', '.prd-gate/v.json', '--date', '2026-01-02', '--push-to', 'prd/P0-W1');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /INTEGRATED [0-9a-f]+ \(done\)/);
  const log = git('log', '--format=%s', '-2').out;
  assert.match(log, /chore\(prd\): record P0-A01 commit \[P0-A01\]/);
  assert.match(log, /\[P0-A01\]/);
  const t = readJson('docs/prd/tasks.json').tasks.find((x) => x.id === 'P0-A01');
  assert.equal(t.status, 'done'); assert.ok(t.commit); assert.equal(t.verification.criteria[0].status, 'met');
  assert.match(git('ls-remote', 'origin').out, /refs\/heads\/prd\/P0-W1/);
  assert.match(prd('integrate', 'P0-A01', 'prd/P0-A01').out, /already integrated/);
});

test('scorecard: ranged requirement is partial; unverified work is half credit; audits override', () => {
  let sc = JSON.parse(prd('scorecard', '--json').out);
  const fr2 = sc.requirements.find((r) => r.id === 'FR-02');
  assert.equal(fr2.status, 'partial'); assert.equal(fr2.credit, 0.5);
  assert.equal(sc.requirements.find((r) => r.id === 'NFR-01').status, 'unmapped');
  assert.equal(sc.requirements.find((r) => r.id === 'FR-03').status, 'not_started');
  git('switch', '-q', '-c', 'prd/P0-A02');
  write('src/math.js', 'export const add = (a, b) => a + b; // checked\n');
  write('test/add.test.js', "import test from 'node:test'; import assert from 'node:assert'; import { add } from '../src/math.js';\ntest('add', () => assert.equal(add(1, 2), 3));\n");
  git('add', '-A'); git('commit', '-qm', 'wip(P0-A02)'); git('switch', '-q', 'main');
  const r = prd('integrate', 'P0-A02', 'prd/P0-A02', '--unreviewed');
  assert.match(r.out, /\(review\)/, r.out);
  sc = JSON.parse(prd('scorecard', '--json').out);
  const fr1 = sc.requirements.find((x) => x.id === 'FR-01');
  assert.equal(fr1.status, 'partial'); assert.equal(fr1.credit, 0.5);
  assert.ok(sc.gaps.some((g) => g.kind === 'Unverified work' && g.id === 'P0-A02'));
  write('.prd-gate/v2.json', JSON.stringify({ date: '2026-01-03', tasks: [{ id: 'P0-A02', verdict: 'approve', criteria: [{ criterion: 'x', status: 'met', evidence: 'add test' }] }], requirements: [{ id: 'FR-01', status: 'done', evidence: 'audited' }] }));
  assert.equal(prd('verify-import', '.prd-gate/v2.json', '--promote').code, 0);
  sc = JSON.parse(prd('scorecard', '--json').out);
  assert.equal(sc.requirements.find((x) => x.id === 'FR-01').status, 'done');
  assert.equal(readJson('docs/prd/tasks.json').tasks.find((x) => x.id === 'P0-A02').status, 'done');
});

test('scorecard and progress files are written', () => {
  assert.equal(prd('scorecard', '--write').code, 0);
  assert.equal(prd('progress').code, 0);
  const md = fs.readFileSync(path.join(REPO, 'docs/prd/SCORECARD.md'), 'utf8');
  assert.match(md, /## Requirements vs implementation/);
  assert.match(md, /\*\*Must coverage\*\*/);
  assert.match(fs.readFileSync(path.join(REPO, 'docs/prd/workflow-log/PROGRESS.md'), 'utf8'), /\*\*Scorecard:\*\* Must coverage/);
});

test('markdown parsers read requirement and finding tables', () => {
  write('docs/audit/a.md', '## 3. Findings\n### 3.1 P0 — Blockers\n#### SO-01 · Data lost\n### 3.2 P1 — Major\n#### SO-02 · Slow\n');
  const cfg = readJson('docs/prd/prd.config.json'); cfg.findingsSource = 'docs/audit/a.md'; writeJson('docs/prd/prd.config.json', cfg);
  const sc = JSON.parse(prd('scorecard', '--json').out);
  assert.deepEqual(sc.findings.map((f) => `${f.id}:${f.severity}:${f.status}`), ['SO-01:P0:unmapped', 'SO-02:P1:unmapped']);
  assert.match(prd('check').out, /finding SO-01 \(P0\) has no task/);
});
