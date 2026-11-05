import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehearse, judgePost, scopeOf, checkFixture, loadFixFixture, type FixFixture, type Attempt } from '../src/capabilities/fixVerification.ts';
import { applyFix, copyTree, treeDiff } from '../src/sandbox/fixRunner.ts';
import { BaselineInputError } from '../src/sandbox/baselineRunner.ts';
import type { RunResult, TestOutcome } from '../src/capabilities/bugBaseline.ts';
import { fixRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The ticket and fixes are written for this demonstration; the router lines are the platform's
// (backend/src/services/workGraph/capabilityRouter.ts:26-36 at a29dfb245), placed at the same line numbers.
const FIXTURE = 'examples/bug-fix/risk-tier.fix.fixture.json';
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const ROUTER = `const RISK_TIER_ORDER = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;

function riskTierIndex(tier: string): number {
  const idx = RISK_TIER_ORDER.indexOf(tier as any);
  return idx === -1 ? 0 : idx;
}

function riskTierAllowed(ticketRiskTier: string | null | undefined, maxRiskTier: string): boolean {
  if (!ticketRiskTier) return true; // no risk tier set on the ticket = unrestricted
  return riskTierIndex(ticketRiskTier) <= riskTierIndex(maxRiskTier);
}`;
const FILE = 'backend/src/services/workGraph/capabilityRouter.ts';
const FIXED = ROUTER.replace('return idx === -1 ? 0 : idx;', 'return idx === -1 ? Number.POSITIVE_INFINITY : idx;');

function world(router = ROUTER) {
  const base = mkdtempSync(join(tmpdir(), 'ellis-fix-'));
  const source = join(base, 'platform');
  mkdirSync(join(source, 'backend/src/services/workGraph'), { recursive: true });
  writeFileSync(join(source, FILE), `${'// header\n'.repeat(25)}${router}\n// rest of the file\n`);
  const sandbox = join(base, 'sandboxes');
  mkdirSync(sandbox);
  return { source, sandbox };
}
const load = (): FixFixture => loadFixFixture(FIXTURE);
const only = (fx: FixFixture, ...ids: string[]): FixFixture => ({ ...fx, attempts: fx.attempts.filter((a) => ids.includes(a.id)) });
const out = (name: string, kind: TestOutcome['kind'], error_name: string | null = null): TestOutcome => ({ name, kind, error_name, message: null });
const run = (...outcomes: TestOutcome[]): RunResult => ({ exit_code: 1, timed_out: false, outcomes });
const REPRO = 'repro';

test('acceptance (R4): the reproduction test fails on the pre-fix tree and passes on the post-fix tree, and the diff touches only the files the record names', () => {
  const w = world();
  const r = rehearse(load(), w.source, w.sandbox);
  assert.equal(r.verified, true, r.statement);
  assert.equal(r.baseline.verdict, 'baseline_confirmed');
  assert.deepEqual(r.reproduction, ['an unrecognised ticket risk tier does not clear a read-only ceiling']);
  for (const x of r.baseline.runs) assert.deepEqual([x.failures.map((f) => f.error_name), x.passes], [['AssertionError'], 4], 'fails for the reported reason, with the control and suite passing');
  const fix = r.attempts.find((a) => a.id === 'fail-closed')!;
  assert.deepEqual([fix.verdict, fix.accepted, fix.diff], ['fix_verified', true, [{ file: 'capabilityRouter.excerpt.ts', change: 'modified' }]]);
  assert.deepEqual(fix.post_runs.map((x) => [x.failures.length, x.passes]), [[0, 5], [0, 5]], 'every test passes on both runs');
  assert.match(r.statement, /Merging and deploying are for a person\. Sandbox only; the platform's lines were copied, never changed, and nothing ran on the platform\./);
  assert.equal(r.limits.length, 4);
  assert.equal(r.decided_by, 'a named human');
  assert.equal(readFileSync(join(w.source, FILE), 'utf8').includes(ROUTER), true, 'the checkout is only read');
  const pre = readdirSync(w.sandbox).find((d) => d.startsWith('baseline-'))!;
  assert.match(readFileSync(join(w.sandbox, pre, 'capabilityRouter.excerpt.ts'), 'utf8'), /return riskTierIndex\(ticketRiskTier\) <= riskTierIndex\(maxRiskTier\);/, 'the pre-fix tree is never edited');
});

test('each wrong fix is refused for its own reason', () => {
  const r = rehearse(load(), world().source, world().sandbox);
  assert.deepEqual(Object.fromEntries(r.attempts.map((a) => [a.id, a.verdict])), {
    'fail-closed': 'fix_verified', 'wrong-side': 'still_fails', 'refuse-everything': 'suite_not_green',
    'edit-the-test': 'edits_the_test', 'unnamed-file': 'touches_unnamed_files', 'stale-patch': 'fix_does_not_apply',
  });
  const by = (id: string) => r.attempts.find((a) => a.id === id)!;
  assert.match(by('refuse-everything').reason, /a recognised tier at or below the ceiling is allowed now fails/);
  assert.match(by('unnamed-file').reason, /riskTierVocabulary\.ts \(added\), not named/);
  assert.match(by('edit-the-test').reason, /changes a test \(risk-tier\.baseline\.test\.mjs \(modified\)\); a test changed to pass proves nothing/);
  assert.deepEqual([by('edit-the-test').post_runs, by('unnamed-file').post_runs], [[], []], 'a fix out of scope is refused before it runs');
  assert.ok(r.attempts.filter((a) => a.id !== 'fail-closed').every((a) => !a.accepted));
});

test('with no confirmed baseline, no fix is judged: a tree that already passes, or a suite red before the fix', () => {
  const r = rehearse(load(), world(FIXED).source, world().sandbox);
  assert.equal(r.baseline.verdict, 'passes_before_fix');
  assert.ok(r.attempts.every((a) => a.verdict === 'no_baseline'));
  assert.deepEqual([r.checks.a_fix_was_verified, r.checks.a_wrong_fix_was_refused, r.verified], [false, false, false]);
  const red = { ...load(), suite: [{ file: 'red.test.mjs', path: 'x', content: "import { test } from 'node:test'; test('red', () => { throw new TypeError('no'); });" }] };
  assert.equal(rehearse(only(red, 'fail-closed'), world().source, world().sandbox).baseline.verdict, 'fails_for_another_reason');
});

test('a fix that stops the code loading did not run; it is not a pass', () => {
  const broken: Attempt = { id: 'broken', author: 'test', files: ['capabilityRouter.excerpt.ts'], edits: [{ file: 'capabilityRouter.excerpt.ts', find: '  return riskTierIndex(ticketRiskTier) <= riskTierIndex(maxRiskTier);', replace: '  return (;' }], expect: 'did_not_run' };
  const r = rehearse({ ...load(), attempts: [broken] }, world().source, world().sandbox);
  assert.equal(r.attempts[0].verdict, 'did_not_run');
});

test('the post-fix verdict reads every run: anything that did not run or reached outside decides, and runs that disagree are inconsistent', () => {
  const pass = (n: string) => out(n, 'pass');
  assert.equal(judgePost([run(pass(REPRO), pass('s')), run(pass(REPRO), pass('s'))], [REPRO]), 'fix_verified');
  assert.equal(judgePost([run(out(REPRO, 'assertion', 'AssertionError'), out('s', 'thrown', 'TypeError')), run(out(REPRO, 'assertion', 'AssertionError'), out('s', 'thrown', 'TypeError'))], [REPRO]), 'still_fails', 'the reproduction failing decides before the suite');
  assert.equal(judgePost([run(pass(REPRO), out('s', 'thrown', 'TypeError')), run(pass(REPRO), out('s', 'thrown', 'TypeError'))], [REPRO]), 'suite_not_green');
  assert.equal(judgePost([run(pass(REPRO)), run(out(REPRO, 'assertion', 'AssertionError'))], [REPRO]), 'inconsistent', 'a fix that holds on one run of two is not verified');
  assert.equal(judgePost([run(pass(REPRO)), run(out(REPRO, 'access_denied'))], [REPRO]), 'sandbox_violation');
  assert.equal(judgePost([run(out(REPRO, 'access_denied')), run(out(REPRO, 'timeout'))], [REPRO]), 'did_not_run');
  assert.equal(judgePost([run(pass(REPRO)), run(out(REPRO, 'load_error'))], [REPRO]), 'did_not_run');
  assert.equal(judgePost([run(pass(REPRO)), run()], [REPRO]), 'did_not_run', 'a run with no tests is not green');
  assert.equal(judgePost([run(pass(REPRO)), { exit_code: null, timed_out: true, outcomes: [pass(REPRO)] }], [REPRO]), 'did_not_run');
});

test('the scope of a diff: a test may never change, even when named; any other file must be named', () => {
  const tests = ['t.test.mjs', 's.test.mjs'];
  assert.equal(scopeOf([{ file: 's.test.mjs', change: 'modified' }], ['s.test.mjs'], tests), 'edits_the_test');
  assert.equal(scopeOf([{ file: 'a.ts', change: 'modified' }, { file: 't.test.mjs', change: 'modified' }], ['a.ts'], tests), 'edits_the_test', 'a changed test decides before an unnamed file');
  assert.equal(scopeOf([{ file: 'a.ts', change: 'modified' }, { file: 'b.ts', change: 'added' }], ['a.ts'], tests), 'touches_unnamed_files');
  assert.equal(scopeOf([{ file: 'a.ts', change: 'modified' }], ['a.ts', 'b.ts'], tests), null);
});

test('a fix applies only exact passages that appear once, to plain file names in a copy, and the diff is read from the trees', () => {
  const pre = mkdtempSync(join(tmpdir(), 'ellis-tree-'));
  writeFileSync(join(pre, 'a.ts'), 'x = 1;\nx = 1;\ny = 2;\n');
  writeFileSync(join(pre, 'b.ts'), 'z\n');
  const post = copyTree(pre);
  assert.deepEqual(applyFix(post, [{ file: 'a.ts', find: 'x = 1;', replace: 'x = 3;' }]), { edit: 0, why: 'the passage to replace appears more than once in a.ts' });
  assert.deepEqual(applyFix(post, [{ file: 'a.ts', find: 'y = 2;', replace: 'y = 3;' }, { file: 'nope.ts', find: 'q', replace: 'r' }]), { edit: 1, why: 'nope.ts is not in the sandbox' });
  assert.throws(() => applyFix(post, [{ file: '../a.ts', content: 'x' }]), BaselineInputError);
  assert.equal(applyFix(post, [{ file: 'c.ts', content: 'new\n' }, { file: 'b.ts', find: 'z', replace: 'z' }]), null);
  assert.deepEqual(treeDiff(pre, post), [{ file: 'a.ts', change: 'modified' }, { file: 'c.ts', change: 'added' }], 'b.ts was rewritten to the same text, so it is not in the diff');
  assert.equal(readFileSync(join(pre, 'a.ts'), 'utf8'), 'x = 1;\nx = 1;\ny = 2;\n', 'the pre-fix tree is untouched');
});

test('a run with no verified fix, or with nothing refused, is not verified', () => {
  const none = rehearse(only(load(), 'wrong-side', 'stale-patch'), world().source, world().sandbox);
  assert.deepEqual([none.checks.a_fix_was_verified, none.verified], [false, false]);
  const all = rehearse(only(load(), 'fail-closed'), world().source, world().sandbox);
  assert.deepEqual([all.checks.a_wrong_fix_was_refused, all.verified], [false, false]);
  assert.match(all.statement, /not verified: a_wrong_fix_was_refused/);
  const wrong = rehearse({ ...only(load(), 'fail-closed', 'wrong-side'), attempts: [{ ...load().attempts[0], expect: 'still_fails' }, load().attempts[1]] }, world().source, world().sandbox);
  assert.deepEqual([wrong.checks['fail-closed'], wrong.verified], [false, false]);
});

test('in the shared output, a verified run is ok citing every attempt and the hashed lines and tests; a failed run cites the attempts that went wrong', () => {
  const c = { captured_at: '2026-11-05T15:00:00Z', captured_by: 'test' };
  const o = fixRehearsalOutput(rehearse(load(), world().source, world().sandbox), c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence.map((x) => x.table), [...Array(6).fill('sandbox_fix_attempts'), 'platform_source', 'baseline_test', 'suite_test']);
  assert.match(o.evidence[6].fields[0], /^sha256:[0-9a-f]{64}$/);
  assert.match(o.as_of.note!, /sandbox fixture bug-fix-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 4);
  const fx = load();
  const f = fixRehearsalOutput(rehearse({ ...fx, attempts: [...fx.attempts.slice(0, 5), { ...fx.attempts[5], expect: 'fix_verified' }] }, world().source, world().sandbox), c, EMPTY);
  assert.deepEqual([f.verdict, f.evidence.filter((x) => x.table === 'sandbox_fix_attempts').map((x) => x.id)], ['problem', ['stale-patch']]);
});

test('a fixture is refused without its parts, with a malformed attempt or a repeated id; the command exits 0, 3 and 1', () => {
  const base = load();
  const a0 = base.attempts[0];
  const bad: FixFixture[] = [
    { ...base, attempts: [] }, { ...base, fixture_id: 1 as never }, { ...base, excerpts: [] }, { ...base, ticket: undefined as never },
    { ...base, test: { file: '../x.mjs', path: 'x' } }, { ...base, suite: [{ file: 's.mjs' } as never] },
    { ...base, attempts: [{ ...a0, edits: [] }] }, { ...base, attempts: [{ ...a0, edits: [{ file: 'a.ts', find: 'x' } as never] }] },
    { ...base, attempts: [{ ...a0, files: [1 as never] }] }, { ...base, attempts: [{ ...a0, expect: 'fine' as never }] },
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture({ ...base, attempts: [a0, a0] }, 'inline'), /listed once/);
  const w = world();
  const cli = (fixture: string, ...more: string[]) => spawnSync(process.execPath, ['src/cli/fixVerification.ts', '--fixture', fixture, '--source', w.source, '--sandbox', w.sandbox, ...more], { encoding: 'utf8' });
  const ok = cli(FIXTURE);
  assert.equal(ok.status, 0, ok.stderr);
  const notFx = join(mkdtempSync(join(tmpdir(), 'ellis-fx-')), 'f.json');
  writeFileSync(notFx, JSON.stringify({ ...JSON.parse(readFileSync(FIXTURE, 'utf8')), test: { file: 'risk-tier.baseline.test.mjs', path: join(process.cwd(), 'examples/bug-baseline/risk-tier.baseline.test.mjs') }, suite: [], attempts: [{ ...a0, expect: 'still_fails' }] }));
  assert.equal(cli(notFx).status, 3);
  assert.equal(spawnSync(process.execPath, ['src/cli/fixVerification.ts'], { encoding: 'utf8' }).status, 1);
  const missing = cli('examples/nope.json');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
