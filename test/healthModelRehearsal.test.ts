import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, correctedScore, platformOutput, checkFixture, loadModelFixture, type ModelFixture, type Case } from '../src/capabilities/healthModelRehearsal.ts';
import { healthModelOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is agents written for this demonstration: no production rows.
const FIXTURE = 'examples/health-model.fixture.json';
const load = (): ModelFixture => loadModelFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const kase = (id: string, run_count: number, error_count: number, status: string, expect: Case['expect']): Case => ({ id, row: { run_count, error_count, status }, expect });
const by = (r: ReturnType<typeof rehearse>, id: string) => r.cases.find((c) => c.id === id)!;

test('acceptance (R4): a zero-run agent and a zero-error hundred-run agent receive different outputs, the positive control the current formula fails', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual([by(r, 'never-run').subject, by(r, 'clean-hundred').subject], [{ state: 'unscored', score: null }, { state: 'scored', score: 100 }]);
  assert.deepEqual([by(r, 'never-run').control, by(r, 'clean-hundred').control], [{ state: 'scored', score: 100 }, { state: 'scored', score: 100 }]);
  assert.deepEqual([r.checks.zero_run_and_clean_hundred_differ, r.checks.control_fails_acceptance], [true, true]);
  assert.match(r.statement, /never-run\) is unscored and the clean 100-run agent \(clean-hundred\) scores 100: different outputs/);
  assert.match(r.statement, /Sandbox only; nothing ran on the platform\. The platform model gives never-run 100 and clean-hundred 100\.$/);
  assert.equal(r.limits.length, 4);
});

test('the corrected model: unscored with no run, flagged when failures are on record, otherwise the share of runs that did not fail', () => {
  assert.deepEqual(correctedScore({ run_count: 0, error_count: 0, status: 'idle' }), { state: 'unscored', score: null });
  assert.deepEqual(correctedScore({ run_count: 0, error_count: 5, status: 'error' }), { state: 'unscored_with_failures', score: null });
  assert.deepEqual(correctedScore({ run_count: 40, error_count: 10, status: 'idle' }), { state: 'scored', score: 75 });
  assert.deepEqual(correctedScore({ run_count: 3, error_count: 1, status: 'idle' }), { state: 'scored', score: 67 });
  assert.deepEqual(correctedScore({ run_count: 4, error_count: 6, status: 'error' }), { state: 'scored', score: 0 }, 'errors above runs read as all failing, never below 0');
  assert.deepEqual(platformOutput({ run_count: 100, error_count: 2, status: 'error' }), { state: 'scored', score: 66 });
});

test('the platform\'s formula, graded on the same agents, misses all three corrections', () => {
  const r = rehearse(load());
  assert.deepEqual([by(r, 'half-failing').control.score, by(r, 'all-failing').control.score], [0, 0], 'half and all failing read the same');
  assert.deepEqual([by(r, 'two-percent-failing').control.score, by(r, 'two-percent-failing-error-status').control.score], [96, 66], 'the same counts, 30 points apart on status');
  assert.deepEqual([by(r, 'half-failing').subject.score, by(r, 'two-percent-failing-error-status').subject.score], [50, 98]);
  const swapped = rehearse(load(), { subject: 'platform', control: 'corrected' });
  assert.deepEqual([swapped.checks.zero_run_and_clean_hundred_differ, swapped.checks.more_failures_score_lower, swapped.checks.same_counts_same_score, swapped.checks.control_fails_acceptance], [false, false, false, false]);
  assert.deepEqual(swapped.cases.filter((c) => swapped.checks[c.id]).map((c) => c.id), ['clean-hundred', 'all-failing', 'errors-above-runs', 'one-clean-run']);
  assert.equal(swapped.verified, false);
});

test('equal failure shares may score the same, and the control check can fail', () => {
  const base = load().cases;
  // Corrected outputs are fixed, so these break the checks by the rows they compare.
  const r = rehearse({ ...load(), cases: [...base, kase('another-clean', 100, 0, 'idle', { state: 'scored', score: 100 })] });
  assert.equal(r.verified, true, 'equal shares may score the same');
  const tellsApart = rehearse({ ...load(), cases: base }, { subject: 'platform', control: 'platform' });
  assert.equal(tellsApart.checks.control_fails_acceptance, true, 'the platform as control does fail the acceptance');
  const corrected = rehearse(load(), { subject: 'corrected', control: 'corrected' });
  assert.equal(corrected.checks.control_fails_acceptance, false, 'the corrected model as control passes it, so the check can fail');
});

test('every zero-run agent and every clean hundred-run agent is compared, not just the first of each', () => {
  const extra = kase('never-run-disabled', 0, 0, 'paused', { state: 'unscored', score: null });
  const r = rehearse({ ...load(), cases: [...load().cases, extra, kase('clean-two-hundred', 200, 0, 'idle', { state: 'scored', score: 100 })] }, { subject: 'platform', control: 'corrected' });
  assert.equal(r.checks.zero_run_and_clean_hundred_differ, false);
  const lone = rehearse({ fixture_id: 'x', description: '', cases: [kase('z', 0, 0, 'idle', { state: 'unscored', score: null }), kase('h', 100, 0, 'idle', { state: 'scored', score: 100 })] });
  assert.equal(lone.verified, true, lone.statement);
});

test('every pair is compared: one zero-run agent told apart from one clean agent does not pass if another pair matches', () => {
  // Under the platform's formula status costs 30 points, so a clean agent in status error differs from a never-run
  // idle one while a clean idle agent does not.
  const errClean = kase('clean-hundred-error-status', 100, 0, 'error', { state: 'scored', score: 100 });
  const r = rehearse({ ...load(), cases: [errClean, ...load().cases] }, { subject: 'platform', control: 'corrected' });
  assert.equal(r.cases[0].subject.score, 70);
  assert.equal(r.checks.zero_run_and_clean_hundred_differ, false);
});

test('an expectation with the right score but the wrong state fails, and is the one cited', () => {
  const fx = load();
  const wrong = { ...fx, cases: fx.cases.map((c) => (c.id === 'always-throws' ? { ...c, expect: { state: 'unscored' as const, score: null } } : c)) };
  const r = rehearse(wrong);
  assert.deepEqual([r.checks['always-throws'], r.verified], [false, false]);
  const o = healthModelOutput(r, { captured_at: '2026-11-05T17:00:00Z', captured_by: 'test' }, EMPTY);
  assert.deepEqual(o.evidence.map((x) => x.id), ['always-throws']);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified run is ok citing each agent with both outputs; a failed run cites the agents that went wrong', () => {
  const c = { captured_at: '2026-11-05T17:00:00Z', captured_by: 'test' };
  const o = healthModelOutput(rehearse(load()), c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 10);
  assert.deepEqual(o.evidence[0], { table: 'sandbox_agents', id: 'never-run', fields: ['corrected: unscored', 'platform: scored 100'] });
  assert.match(o.as_of.note!, /sandbox fixture health-model-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 4);
  const f = healthModelOutput(rehearse(loadModelFixture('test/fixtures/health-model-wrong-expect.json')), c, EMPTY);
  assert.deepEqual([f.verdict, f.evidence.map((x) => x.id)], ['problem', ['half-failing']]);
  const prop = healthModelOutput(rehearse(load(), { subject: 'corrected', control: 'corrected' }), c, EMPTY);
  assert.deepEqual([prop.verdict, prop.evidence.length], ['problem', 10], 'a failed property with every agent as expected cites all of them');
});

test('a fixture is refused without its parts, with a missing counter or a bad expectation, or without the acceptance agents; the command exits 0, 3 and 1', () => {
  const base = load();
  const c0 = base.cases[1];
  const bad: ModelFixture[] = [
    { ...base, cases: [] }, { ...base, fixture_id: 1 as never },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', row: { ...c0.row, run_count: undefined as never } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', row: { ...c0.row, error_count: -1 } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', row: { ...c0.row, run_count: 1.5 } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', row: { ...c0.row, status: undefined as never } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', expect: { state: 'unscored', score: 100 } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', expect: { state: 'scored', score: null } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 'x', expect: { state: 'fine' as never, score: 1 } }] },
    { ...base, cases: [...base.cases, { ...c0, id: 1 as never }] },
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture({ ...base, cases: [...base.cases, c0] }, 'inline'), /listed once/);
  assert.throws(() => checkFixture({ ...base, cases: base.cases.filter((c) => c.id !== 'never-run') }, 'inline'), /zero-run agent/);
  assert.throws(() => checkFixture({ ...base, cases: base.cases.filter((c) => c.id !== 'clean-hundred') }, 'inline'), /at least 100 runs/);
  assert.equal(checkFixture({ ...base, cases: [...base.cases, { ...c0, id: 'u', expect: { state: 'unscored_with_failures', score: null } }] }, 'inline').cases.length, 11);
  const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli/healthModelRehearsal.ts', ...a], { encoding: 'utf8' });
  const ok = cli('--fixture', FIXTURE);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(cli('--fixture', 'test/fixtures/health-model-wrong-expect.json').status, 3);
  assert.equal(cli().status, 1);
  const missing = cli('--fixture', 'examples/nope.json');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
