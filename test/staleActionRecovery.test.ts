import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiAgentRow, ActivityLogRow } from '../src/records.ts';
import { staleReport, RECOVERY_TIMER, type StaleSnapshot, type ScheduledActionRow } from '../src/capabilities/staleActionRecovery.ts';

// Rows are shaped as scheduled_emails and the recovery timer's cron run write them; test inputs, not production data.
const NOW = new Date('2026-10-27T15:00:00Z');

function minsAgo(m: number) {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

function row(id: string, over: Partial<ScheduledActionRow> = {}): ScheduledActionRow {
  return { id, channel: 'email', status: 'processing', attempts_made: 0, max_attempts: 2, processing_started_at: minsAgo(30), processor_id: `proc-${id}`, ...over };
}

const timer: AiAgentRow = { id: 'id-timer', agent_name: RECOVERY_TIMER, status: 'idle', enabled: true, schedule: '*/15 * * * *', last_run_at: minsAgo(4), updated_at: null };
const timerRun: ActivityLogRow = { id: 'run-1', agent_id: 'id-timer', action: 'cron_run', result: 'success', created_at: minsAgo(4) };

function snap(rows: ScheduledActionRow[], over: Partial<StaleSnapshot> = {}): StaleSnapshot {
  return { captured_at: NOW.toISOString(), captured_by: 'test', scheduled_emails: rows, ai_agents: [timer], ai_agent_activity_logs: [timerRun], ...over };
}

function action(r: ReturnType<typeof staleReport>, id: string) {
  return r.actions.find((a) => a.id === id)!;
}

test("acceptance: the answer separates 'past the threshold' from 'past the attempt cap', and the second is not recyclable", () => {
  const r = staleReport(snap([
    row('has-attempts-left', { attempts_made: 0, max_attempts: 2 }),
    row('last-attempt', { attempts_made: 1, max_attempts: 2 }),
  ]), { now: NOW });
  const left = action(r, 'has-attempts-left');
  const last = action(r, 'last-attempt');
  assert.equal(left.state, 'past_threshold');
  assert.equal(left.recyclable, true);
  assert.deepEqual(left.attempt, { this_run: 1, cap: 2 });
  assert.equal(last.state, 'past_attempt_cap');
  assert.equal(last.recyclable, false);
  assert.deepEqual(last.attempt, { this_run: 2, cap: 2 });
  assert.deepEqual(r.recyclable, ['has-attempts-left']);
  assert.deepEqual(r.must_not_recycle, ['last-attempt']);
  assert.equal(r.escalate, true);
});

test('acceptance: a single-attempt action (the platform default) stuck once is past its cap, even though the platform would rerun it', () => {
  const r = staleReport(snap([row('single', { attempts_made: 0, max_attempts: 1 })]), { now: NOW });
  const a = action(r, 'single');
  assert.equal(a.state, 'past_attempt_cap');
  assert.equal(a.recyclable, false);
  assert.equal(a.platform_outcome, 'recycled_and_rerun');
  assert.match(a.reason, /must not be recycled/);
});

test('a row already at its cap is reported as one the platform resets but never claims again', () => {
  const a = action(staleReport(snap([row('over', { attempts_made: 2, max_attempts: 2 })]), { now: NOW }), 'over');
  assert.equal(a.state, 'past_attempt_cap');
  assert.equal(a.platform_outcome, 'recycled_but_unclaimable');
});

test('the threshold boundary: exactly at the threshold is still in flight, one minute past is stuck', () => {
  const r = staleReport(snap([row('edge', { processing_started_at: minsAgo(10) }), row('past', { processing_started_at: minsAgo(11) })]), { now: NOW });
  assert.equal(action(r, 'edge').state, 'in_flight');
  assert.equal(action(r, 'edge').recyclable, false);
  assert.equal(action(r, 'past').state, 'past_threshold');
});

test('a given threshold is used and labelled; the default is labelled as the platform code value', () => {
  const rows = [row('a', { processing_started_at: minsAgo(8) })];
  assert.deepEqual(staleReport(snap(rows), { now: NOW }).threshold, { minutes: 10, source: 'platform_code' });
  const r = staleReport(snap(rows), { now: NOW, thresholdMinutes: 5 });
  assert.deepEqual(r.threshold, { minutes: 5, source: 'given' });
  assert.equal(action(r, 'a').state, 'past_threshold');
});

test('no start time, an unusable or future start time, or unusable attempt numbers are unknown and never recyclable', () => {
  const r = staleReport(snap([
    row('no-start', { processing_started_at: null }),
    row('bad-start', { processing_started_at: 'not-a-time' }),
    row('future', { processing_started_at: minsAgo(-5) }),
    row('bad-cap', { max_attempts: 0 }),
    row('bad-count', { attempts_made: Number.NaN }),
  ]), { now: NOW });
  for (const a of r.actions) {
    assert.equal(a.state, 'unknown', a.id);
    assert.equal(a.recyclable, false, a.id);
  }
  assert.equal(action(r, 'no-start').platform_outcome, 'never_recovered');
  assert.equal(r.escalate, true);
});

test('only rows in processing are reported', () => {
  const r = staleReport(snap([row('p'), row('sent', { status: 'sent' }), row('pending', { status: 'pending' }), row('failed', { status: 'failed' })]), { now: NOW });
  assert.deepEqual(r.actions.map((a) => a.id), ['p']);
});

test('a stuck row in a multi-row batch says it may be slow rather than stuck', () => {
  const r = staleReport(snap([row('a', { processor_id: 'proc-1' }), row('b', { processor_id: 'proc-1' }), row('c')]), { now: NOW });
  assert.equal(action(r, 'a').batch_size, 2);
  assert.match(action(r, 'a').reason, /waiting its turn/);
  assert.equal(action(r, 'c').batch_size, 1);
  assert.doesNotMatch(action(r, 'c').reason, /waiting its turn/);
  assert.match(r.slow_or_stuck, /slow rather than stuck/);
});

test('nothing stuck and nothing unknown does not escalate', () => {
  const r = staleReport(snap([row('fresh', { processing_started_at: minsAgo(2) })]), { now: NOW });
  assert.deepEqual(r.counts, { in_flight: 1, past_threshold: 0, past_attempt_cap: 0, unknown: 0 });
  assert.equal(r.escalate, false);
});

test('timer status: ran, overdue, failed, disabled and untracked', () => {
  const cases: Array<[Partial<StaleSnapshot>, string]> = [
    [{}, 'ran'],
    [{ ai_agent_activity_logs: [{ ...timerRun, created_at: minsAgo(45) }] }, 'overdue'],
    [{ ai_agent_activity_logs: [{ ...timerRun, result: 'failed' }] }, 'failed'],
    [{ ai_agents: [{ ...timer, enabled: false }] }, 'disabled'],
    [{ ai_agents: [] }, 'untracked'],
  ];
  for (const [over, status] of cases) assert.equal(staleReport(snap([], over), { now: NOW }).timer.status, status);
});

test('every answer cites its scheduled_emails row', () => {
  const r = staleReport(snap([row('a'), row('b', { processing_started_at: null })]), { now: NOW });
  for (const a of r.actions) assert.deepEqual(a.citation, { table: 'scheduled_emails', id: a.id, fields: ['status', 'processing_started_at', 'attempts_made', 'max_attempts', 'processor_id'] });
});

test('idempotent: the same rows in any order give the same report', () => {
  const rows = [row('c', { attempts_made: 1 }), row('a', { processor_id: 'proc-x' }), row('b', { processor_id: 'proc-x', processing_started_at: null })];
  const a = staleReport(snap(rows), { now: NOW });
  const b = staleReport(snap([...rows].reverse()), { now: NOW });
  assert.deepEqual(a, b);
});
