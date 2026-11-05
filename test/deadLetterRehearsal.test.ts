import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, capture, classOf, checkFixture, loadDeadLetterFixture, THRESHOLD, type DeadLetterFixture } from '../src/capabilities/deadLetterRehearsal.ts';
import { deadLetterRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox job with an invented name: not production data.
const FIXTURE = 'examples/dead-letter.fixture.json';
const load = (): DeadLetterFixture => loadDeadLetterFixture(FIXTURE);
const fx = (over: Partial<DeadLetterFixture> = {}): DeadLetterFixture => ({ fixture_id: 't', description: 't', job_name: 'J', label: 'L', error: { class: 'RateLimitError', message: 'm' }, ...over });
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const byId = (r: ReturnType<typeof rehearse>, id: string) => r.cases.find((c) => c.id === id)!;

test('acceptance (R4): three consecutive failures write exactly one row; a restart between failures two and three writes none', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(byId(r, 'three_consecutive').rows, [{ seq: 1, job_name: 'SandboxReportJob', label: 'Sandbox report job', consecutive_failures: 3, error_class: 'TimeoutError', error_message: 'upstream did not answer within 30s' }]);
  assert.deepEqual(byId(r, 'restart_between_two_and_three').rows, []);
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
});

test('a counter that survives the restart writes the row the platform\'s in-memory counter loses', () => {
  const steps = ['fail', 'fail', 'restart', 'fail'] as const;
  assert.equal(capture(load(), [...steps], 'durable').rows.length, 1);
  assert.equal(capture(load(), [...steps], 'in_memory').rows.length, 0);
  assert.equal(byId(rehearse(load()), 'restart_between_two_and_three').contrast_rows, 1);
});

test('the threshold is the platform\'s three: two failures write nothing, and a restart after a row changes nothing already written', () => {
  assert.equal(THRESHOLD, 3);
  assert.deepEqual(capture(fx(), ['fail', 'fail'], 'in_memory').rows, []);
  assert.equal(capture(fx(), ['fail', 'fail', 'fail', 'restart'], 'in_memory').rows.length, 1);
  assert.equal(capture(fx(), ['fail', 'restart', 'fail', 'fail', 'fail'], 'in_memory').rows[0].consecutive_failures, 3);
});

test('a success resets the count, and the count clears after each row, so six failures write two rows of three', () => {
  const r = rehearse(load());
  assert.deepEqual(byId(r, 'success_between').rows, []);
  assert.deepEqual(byId(r, 'six_consecutive').rows.map((x) => [x.seq, x.consecutive_failures]), [[1, 3], [2, 3]]);
  assert.equal(capture(fx(), ['fail', 'ok', 'fail', 'fail', 'fail'], 'in_memory').rows.length, 1);
});

test('a failed table write leaves no row and no error, and clears the count: three more failures are needed', () => {
  const w = byId(rehearse(load()), 'write_fails_on_third');
  assert.equal(w.swallowed, 1);
  assert.equal(w.rows.length, 1);
  assert.deepEqual(capture(fx(), ['fail', 'fail', 'fail_write', 'fail', 'fail'], 'in_memory'), { rows: [], swallowed: 1 });
  assert.deepEqual(capture(fx(), ['fail_write'], 'in_memory'), { rows: [], swallowed: 0 }, 'a write failure only matters when a row is due');
});

test('the row records the class of the error thrown, as the platform reads it: the class name first, then the error name', () => {
  assert.equal(capture(fx(), ['fail', 'fail', 'fail'], 'in_memory').rows[0].error_class, 'RateLimitError');
  class TimeoutError extends Error {}
  assert.equal(classOf(new TimeoutError('t')), 'TimeoutError');
  assert.equal(classOf(Object.assign(new Error('e'), { name: 'Custom' })), 'Error', 'a renamed Error is still recorded as Error');
  assert.equal(classOf(Object.assign(Object.create(null), { name: 'Bare' })), 'Bare', 'no class name: the error name');
  assert.equal(classOf('just a string'), 'String');
  assert.equal(classOf(null), 'Error');
});

test('with the counters swapped, the restart and contrast checks fail, so the rehearsal can tell them apart', () => {
  const r = rehearse(load(), { subject: 'durable', contrast: 'in_memory' });
  assert.deepEqual(r.checks, {
    three_consecutive: true, restart_between_two_and_three: false, success_between: true, six_consecutive: true,
    write_fails_on_third: true, contrast_writes_after_restart: false, error_class_recorded: true,
  });
  assert.match(r.statement, /not verified: restart_between_two_and_three, contrast_writes_after_restart/);
});

test('a fixture whose error class is not what gets recorded fails the error-class check', () => {
  const r = rehearse({ ...load(), error: { class: '', message: 'm' } });
  assert.equal(r.checks.error_class_recorded, false, 'an empty class is read as Error');
  assert.equal(byId(r, 'three_consecutive').rows[0].error_class, 'Error');
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each case and says it is not production; the wrong cases are the evidence when it fails', () => {
  const c = { captured_at: '2026-11-05T00:00:00Z', captured_by: 'test' };
  const r = rehearse(load());
  const o = deadLetterRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 5);
  assert.match(o.as_of.note!, /sandbox fixture dead-letter-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const f = deadLetterRehearsalOutput(rehearse(load(), { subject: 'durable', contrast: 'in_memory' }), c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((e) => e.id), ['restart_between_two_and_three']);
});

test('a fixture is refused without a job name, a label or an error class; the command exits 0 when verified and 1 for bad input', () => {
  for (const bad of [fx({ job_name: '' }), fx({ label: undefined as never }), fx({ error: { class: '', message: 'm' } }), fx({ error: { class: 'E' } as never }), fx({ fixture_id: 1 as never })]) {
    assert.throws(() => checkFixture(bad, 'inline'), /needs fixture_id, job_name, label and error/);
  }
  assert.equal(checkFixture(fx(), 'inline').job_name, 'J');
  const ok = spawnSync(process.execPath, ['src/cli/deadLetterRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  assert.equal(spawnSync(process.execPath, ['src/cli/deadLetterRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/deadLetterRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
