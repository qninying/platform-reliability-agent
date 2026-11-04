import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, loadQueueFixture, SandboxQueue, planRecovery, applyRecovery, renewClaim, STALE_AFTER_MS, type QueueFixture, type SeededRow } from '../src/capabilities/staleRecoveryRehearsal.ts';
import { staleRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox queue shaped like scheduled_emails, with invented ids: not production data.
const FIXTURE = 'examples/stale-recovery.fixture.json';
const load = (): QueueFixture => loadQueueFixture(FIXTURE);
const NOW = '2026-11-04T15:00:00Z';
const ago = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
const seed = (id: string, role: SeededRow['role'], expect: SeededRow['expect'], over: Partial<SeededRow> = {}): SeededRow =>
  ({ id, role, expect, status: 'processing', attempts_made: 0, max_attempts: 3, processing_started_at: ago(30), processor_id: `p-${id}`, ...over });
const fx = (rows: SeededRow[]): QueueFixture => ({ fixture_id: 't', description: 't', now: NOW, rows });
const BASE = () => [seed('stuck', 'stuck', 'requeued'), seed('slow', 'slow', 'untouched'), seed('cap', 'cap_exceeded', 'parked', { attempts_made: 1, max_attempts: 2 })];

test('acceptance (R4): the slow action is untouched, the cap-exceeded action is parked not recycled, and two concurrent runs produce one recovery, not two', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  const row = (id: string) => r.rows.find((x) => x.id === id)!;
  assert.deepEqual([row('sb-slow-1').got, row('sb-slow-1').attempts.after], ['untouched', 0]);
  assert.deepEqual([row('sb-cap-1').got, row('sb-cap-1').status], ['parked', 'failed']);
  assert.deepEqual(row('sb-stuck-1').recovered_by, ['A'], 'run B read the same stuck row and recovered nothing');
  assert.deepEqual(r.runs.map((x) => x.requeued.length + x.exhausted.length), [2, 0]);
  assert.ok(r.runs[1].read.includes('sb-stuck-1'), 'run B did read the stuck row: the re-check, not luck, stopped a second recovery');
  assert.match(r.statement, /Sandbox only; nothing reached production/);
});

test('a recovered row spends an attempt; one with no attempt left is failed, never sent back to pending', () => {
  const r = rehearse(fx(BASE()));
  const row = (id: string) => r.rows.find((x) => x.id === id)!;
  assert.deepEqual([row('stuck').status, row('stuck').attempts.after], ['pending', 1]);
  assert.deepEqual([row('cap').status, row('cap').attempts.after], ['failed', 2]);
  const journal = r.journal.filter((e) => e.row_id === 'cap' && e.column === 'status');
  assert.deepEqual(journal.map((e) => e.after), ['failed'], 'the capped row was written once, straight to failed');
});

test('the threshold is the platform\'s 10 minutes: a row claimed 9 minutes ago is not stale, one claimed 11 minutes ago is', () => {
  const q = new SandboxQueue([seed('nine', 'fresh', 'untouched', { processing_started_at: ago(9) }), seed('eleven', 'stuck', 'requeued', { processing_started_at: ago(11) })]);
  assert.deepEqual(planRecovery(q, Date.parse(NOW)), ['eleven']);
  assert.equal(STALE_AFTER_MS, 10 * 60 * 1000);
});

test('a row with no start time is never selected, and a row that is not processing is left alone', () => {
  const q = new SandboxQueue([seed('nostart', 'stuck', 'untouched', { processing_started_at: null }), seed('pending', 'idle', 'untouched', { status: 'pending' })]);
  assert.deepEqual(planRecovery(q, Date.parse(NOW)), []);
});

test('the owner\'s renewal holds only for the processor that owns the row', () => {
  const q = new SandboxQueue([seed('r', 'slow', 'untouched')]);
  assert.equal(renewClaim(q, 'r', 'someone-else', Date.parse(NOW)), false);
  assert.equal(renewClaim(q, 'r', 'p-r', Date.parse(NOW)), true);
  assert.equal(q.get('r')!.processing_started_at, NOW.replace('Z', '.000Z'));
});

test('without the write-time re-check, the same race recovers a row twice and the slow row under its owner: the harness can fail', () => {
  const now = Date.parse(NOW);
  const q = new SandboxQueue(BASE());
  const a = planRecovery(q, now), b = planRecovery(q, now);
  renewClaim(q, 'slow', 'p-slow', now);
  const runs = [applyRecovery(q, 'A', a, now, false), applyRecovery(q, 'B', b, now, false)];
  const times = (id: string) => runs.filter((x) => x.requeued.includes(id) || x.exhausted.includes(id)).length;
  assert.equal(times('stuck'), 2);
  assert.ok(times('slow') >= 1, 'the slow row was recovered under its live owner');
  assert.equal(rehearse(fx(BASE())).checks.harness_catches_double_recovery, true);
});

test('a fixture with nothing for the harness to catch, or no slow or capped row, is not verified', () => {
  const onlyFresh = rehearse(fx([seed('f', 'fresh', 'untouched', { processing_started_at: ago(1) })]));
  assert.equal(onlyFresh.verified, false);
  assert.equal(onlyFresh.checks.harness_catches_double_recovery, false);
  assert.equal(onlyFresh.checks.slow_untouched, false, 'no slow row seeded means the slow check was not exercised');
  assert.equal(onlyFresh.checks.cap_parked_not_recycled, false);
});

test('a row whose seeded expectation does not match what recovery did is not verified', () => {
  const rows = BASE();
  rows[0] = { ...rows[0], expect: 'untouched' };
  const r = rehearse(fx(rows));
  assert.equal(r.verified, false);
  assert.equal(r.checks.one_recovery_each, false);
});

test('the same fixture always gives the same rehearsal, and the source fixture is not changed by it', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing every sandbox row and saying it is not production', () => {
  const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
  const r = rehearse(load());
  const o = staleRehearsalOutput(r, { captured_at: NOW, captured_by: 'test' }, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, r.rows.length);
  assert.match(o.as_of.note!, /sandbox fixture stale-recovery-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const bad = rehearse(fx([seed('f', 'fresh', 'untouched', { processing_started_at: ago(1) })]));
  assert.equal(staleRehearsalOutput(bad, { captured_at: NOW, captured_by: 'test' }, EMPTY).verdict, 'problem');
});

test('the command exits 0 when verified, and 1 for a missing or malformed fixture', () => {
  const ok = spawnSync(process.execPath, ['src/cli/staleRecoveryRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  assert.equal(spawnSync(process.execPath, ['src/cli/staleRecoveryRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/staleRecoveryRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
