import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, loadOverlapFixture, type OverlapFixture } from '../src/capabilities/cronOverlapRehearsal.ts';
import { overlapRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a simulated timeline with invented names: not production data.
const FIXTURE = 'examples/cron-overlap.fixture.json';
const load = (): OverlapFixture => loadOverlapFixture(FIXTURE);
const MIN = 60_000;
const fx = (over: Partial<OverlapFixture> = {}): OverlapFixture => ({
  fixture_id: 't', description: 't', job: 'J', interval_ms: 5 * MIN, run_ms: 12 * MIN, lease_ms: 15 * MIN, ticks: 12,
  processes: ['p1', 'p2', 'p3'], crash: { process: 'p1', at_tick: 6 }, ...over,
});
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };

test('acceptance (R4): the second tick does not start while the first is running, and the skip is recorded; a silent skip fails the criterion', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(r.overlaps, []);
  assert.deepEqual(r.silent_skips, []);
  const tick1 = r.rows.filter((x) => x.tick === 1);
  assert.deepEqual(tick1.map((x) => [x.process, x.result]), [['scheduler-1', 'skipped'], ['scheduler-2', 'skipped'], ['scheduler-3', 'skipped']]);
  assert.match(tick1[0].reason!, /held by scheduler-1, run scheduler-1#0/);
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
});

test('one claim covers every process: at tick 0 only the first process starts, and the other two record a skip', () => {
  const r = rehearse(load());
  assert.deepEqual(r.rows.filter((x) => x.tick === 0 && x.at_ms === 0).map((x) => [x.process, x.result]), [['scheduler-1', 'started'], ['scheduler-2', 'skipped'], ['scheduler-3', 'skipped']]);
});

test('a process that dies mid-run does not block the job for good: the next run starts once the lease runs out, and says why', () => {
  const r = rehearse(load());
  const died = r.rows.find((x) => x.result === 'died')!;
  assert.equal(died.run, 'scheduler-1#6');
  const next = r.rows.find((x) => x.result === 'started' && x.at_ms > died.at_ms)!;
  assert.ok(next.at_ms >= 6 * 5 * MIN + 15 * MIN, 'not before the lease ran out');
  assert.match(next.reason!, /previous claim, held by scheduler-1, expired/);
});

test('a run that ends normally releases its claim, so the next tick after it can start without waiting for the lease', () => {
  // A lease of 20 minutes outlasts tick 3 at 15, so only a release on finish lets tick 3 start.
  const r = rehearse(fx({ crash: null, lease_ms: 20 * MIN }));
  assert.deepEqual(r.runs.slice(0, 2).map((x) => x.start_ms), [0, 15 * MIN], 'tick 3 starts right after run 0 ends at 12 minutes');
});

test('the library\'s per-process guard, on the same timeline, lets processes overlap and skips with no record', () => {
  const r = rehearse(load());
  assert.ok(r.control.overlaps.some(([a, b]) => a === 'scheduler-1#0' && b === 'scheduler-2#0'));
  assert.ok(r.control.silent_skips.includes('scheduler-1@1'));
  assert.match(r.statement, /per-process guard on the same timeline let 16 pair\(s\) of runs overlap and skipped 23 tick\(s\) with no record/);
});

test('with one process the control cannot overlap but still skips silently, so the rehearsal can still tell the guards apart', () => {
  const r = rehearse(fx({ processes: ['solo'], crash: { process: 'solo', at_tick: 6 } }));
  assert.deepEqual(r.control.overlaps, []);
  assert.ok(r.control.silent_skips.length > 0);
  assert.equal(r.verified, true);
});

test('a run shorter than its interval forces no overrun, and a fixture with no crash does not show recovery: neither is verified', () => {
  assert.equal(rehearse(fx({ run_ms: 4 * MIN })).checks.overrun_forced, false);
  assert.equal(rehearse(fx({ crash: null })).checks.recovers_after_a_crash, false);
  assert.equal(rehearse(fx({ crash: null })).verified, false);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each run and says it is not production', () => {
  const r = rehearse(load());
  const o = overlapRehearsalOutput(r, { captured_at: '2026-11-04T15:00:00Z', captured_by: 'test' }, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, r.runs.length);
  assert.match(o.as_of.note!, /sandbox fixture cron-overlap-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
});

test('the command exits 0 when verified, and 1 for a missing fixture or a lease shorter than the run', () => {
  const ok = spawnSync(process.execPath, ['src/cli/cronOverlapRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  assert.equal(spawnSync(process.execPath, ['src/cli/cronOverlapRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/cronOverlapRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
  assert.throws(() => loadOverlapFixture('test/fixtures/cron-overlap-short-lease.json'), /lease_ms must outlast run_ms/);
});
