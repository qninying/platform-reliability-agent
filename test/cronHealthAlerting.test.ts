import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cronHealth, readLiveThresholds, PINNED_THRESHOLDS, type HealthSnapshot, type HealthRow } from '../src/capabilities/cronHealthAlerting.ts';
import { parseCron, nextFire, expectedIntervalMs, gapRange } from '../src/inventory/cronExpression.ts';
import type { TimerRow } from '../src/capabilities/agentEnableDisableControl.ts';
import type { RunLog } from '../src/capabilities/cronRunInstrumentation.ts';

// Names, schedules and wiring mirror the platform at 4443087; counts and times are test inputs, not production data.
const NOW = '2026-10-27T18:00:00Z'; // a Tuesday
const row = (name: string, over: Partial<HealthRow> = {}): HealthRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', trigger_type: 'cron', schedule: '*/15 * * * *', run_count: 10, avg_duration_ms: 500, last_run_at: '2026-10-27T17:50:00Z', error_count: 0, last_error: null, last_error_at: null, ...over });
let seq = 0;
const runs = (name: string, results: string[], over: Partial<RunLog> = {}): RunLog[] => results.map((result, i) => ({ id: `log-${name}-${seq++}`, agent_id: `row-${name}`, action: 'run', result, trace_id: 't', duration_ms: 400, reason: null, created_at: new Date(Date.parse(NOW) - (i + 1) * 15 * 60_000).toISOString(), ...over }));
const timer = (t: string, schedule: string, ref: string, gate: TimerRow['gates'][0]['gate'], flag: string | null = t): TimerRow => ({ timer: t, schedule, label: t, ref, gates: [{ gate, flag }] });

function snap(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    captured_at: NOW, captured_by: 'test',
    ai_agents: [row('ReesePresenceHeartbeat')],
    ai_agent_activity_logs: runs('ReesePresenceHeartbeat', Array(10).fill('success')),
    timers: [timer('ReesePresenceHeartbeat', '*/15 * * * *', 'schedulerService.ts:1750', 'instrument_cron_job')],
    timer_scope: ['schedulerService.ts'],
    ...over,
  };
}

const named = (list: Array<{ name: string }>) => list.map((x) => x.name);
const allListed = (a: ReturnType<typeof cronHealth>) => [...a.alerting, ...a.clear, ...a.partly_evaluated, ...a.not_evaluated];

test('acceptance: jobs excluded by the trigger_type and enabled filter are listed as not evaluated, with the reason, never omitted', () => {
  const s = snap({
    ai_agents: [row('ReesePresenceHeartbeat'), row('CompanyStrategicCycle', { enabled: false }), row('Dara', { trigger_type: 'event_driven', schedule: '' }), row('MarketingDomainAgent', { trigger_type: 'event_driven', schedule: null, enabled: false })],
    timers: [
      timer('ReesePresenceHeartbeat', '*/15 * * * *', 'schedulerService.ts:1750', 'instrument_cron_job'),
      timer('PaySimplePaymentSync', '*/30 * * * *', 'schedulerService.ts:2175', 'instrument_cron_job'),
      timer('WeeklyReport', '0 13 * * 0', 'aiOpsScheduler.ts:266', 'run_agent'),
      timer('Dara', '10 6 * * *', 'aiOpsScheduler.ts:367', 'instrument_cron_job'),
      timer('DeptCampaignPerformanceAgent', '25 */6 * * *', 'aiOpsScheduler.ts:189', 'unknown', null),
    ],
  });
  const a = cronHealth(s);
  const by = new Map(a.not_evaluated.map((n) => [n.name, n]));
  assert.deepEqual(by.get('PaySimplePaymentSync')?.reasons, ['no_row']);
  assert.match(by.get('PaySimplePaymentSync')!.statement, /runs it anyway, untracked/);
  assert.match(by.get('WeeklyReport')!.statement, /returns without running/);
  assert.deepEqual(by.get('CompanyStrategicCycle')?.reasons, ['disabled']);
  assert.deepEqual(by.get('Dara')?.reasons, ['not_cron_trigger']);
  assert.deepEqual(by.get('Dara')?.timers, ['aiOpsScheduler.ts:367']);
  assert.deepEqual(by.get('DeptCampaignPerformanceAgent')?.reasons, ['row_unknown']);
  for (const n of a.not_evaluated) assert.match(n.statement, /not evaluated/);
  // An unscheduled event-driven row is not a job: counted, not listed.
  assert.equal(by.has('MarketingDomainAgent'), false);
  assert.equal(a.unscheduled_rows_not_listed, 1);
  assert.equal(a.answer, 'clear_with_blind_spots');
  assert.match(a.statement, /No alert is not the same as healthy/);
});

test('acceptance on the real fleet: every timer and every scheduled row is accounted for, and the 41 timers with no row are named', () => {
  const s: HealthSnapshot = JSON.parse(readFileSync(new URL('../examples/cron-health.example.json', import.meta.url), 'utf8'));
  const a = cronHealth(s);
  const listed = allListed(a);
  const names = new Set(listed.map((x) => x.name));
  for (const t of s.timers) assert.ok(names.has(t.gates[0].flag ?? t.timer), `${t.timer} (${t.ref}) is missing from the answer`);
  const scheduled = s.ai_agents.filter((r) => r.trigger_type === 'cron' || r.schedule !== null || s.timers.some((t) => t.gates[0].flag === r.agent_name));
  assert.equal(listed.filter((x) => 'row_id' in x && x.row_id !== null).length, scheduled.length);
  assert.equal(listed.length, new Set(listed.map((x) => `${x.name}|${'row_id' in x ? x.row_id : ''}`)).size, 'no job is listed twice');
  const noRow = a.not_evaluated.filter((n) => n.reasons.includes('no_row')).map((n) => n.name);
  assert.equal(noRow.length, 41);
  for (const n of ['WeeklyReport', 'PaySimplePaymentSync', 'BillingWatch', 'RenewalReminders', 'SkoolSupervisor']) assert.ok(noRow.includes(n), n);
  assert.deepEqual(a.not_evaluated.find((n) => n.name === 'Dara')?.reasons, ['not_cron_trigger', 'disabled']);
  assert.equal(a.not_evaluated.filter((n) => n.reasons.includes('disabled') && !n.reasons.includes('not_cron_trigger')).length, 9);
  assert.notEqual(a.answer, 'clear');
});

test('the error rate mirrors the live check: 5 rows minimum, 50% warns, 80% is critical', () => {
  const at = (results: string[]) => cronHealth(snap({ ai_agent_activity_logs: runs('ReesePresenceHeartbeat', results) }));
  assert.equal(at(['failed', 'failed', 'failed', 'success', 'success', 'success']).alerting[0].alerts[0].type, 'warning');
  assert.equal(at(['failed', 'failed', 'failed', 'failed', 'success']).alerting[0].alerts[0].type, 'critical');
  assert.equal(at(['failed', 'failed', 'success', 'success', 'success']).alerting.length, 0);
  const four = at(['failed', 'failed', 'failed', 'failed']);
  assert.equal(four.alerting.length, 0);
  assert.equal(four.partly_evaluated[0].error_rate.evaluated, false);
  assert.match(four.partly_evaluated[0].error_rate.why_not!, /needs 5/);
});

test('the sample is the newest 10 rows of any kind, and rows that are not runs are counted and named', () => {
  const name = 'ReesePresenceHeartbeat';
  const newest = [...runs(name, ['failed', 'failed', 'failed', 'failed']), ...runs(name, ['skipped', 'skipped', 'skipped'], { trace_id: null, duration_ms: null }), ...runs(name, ['success', 'success', 'success'])];
  const older = runs(name, Array(10).fill('failed'), { created_at: '2026-10-20T00:00:00Z' });
  const a = cronHealth(snap({ ai_agent_activity_logs: [...older, ...newest] }));
  const e = a.clear[0];
  assert.equal(e.error_rate.sampled, 10);
  assert.equal(e.error_rate.rate, 40);
  assert.equal(e.error_rate.not_run_rows, 3);
  assert.ok(e.notes.some((n) => /3 of the 10 sampled rows are not run results/.test(n)));
});

test('a missed run mirrors the live check: 2x warns, 4x is critical, and a job that never ran cannot be overdue', () => {
  const at = (last: string | null) => cronHealth(snap({ ai_agents: [row('ReesePresenceHeartbeat', { last_run_at: last })] }));
  assert.equal(at('2026-10-27T17:29:00Z').alerting[0].alerts[0].type, 'warning');
  assert.equal(at('2026-10-27T16:59:00Z').alerting[0].alerts[0].type, 'critical');
  assert.equal(at('2026-10-27T17:35:00Z').alerting.length, 0);
  const never = at(null);
  assert.equal(never.partly_evaluated[0].missed_run.evaluated, false);
  assert.match(never.partly_evaluated[0].missed_run.why_not!, /never recorded a run/);
});

test('an uneven schedule is judged on its next gap only, and an alert inside its longest normal gap carries a caution', () => {
  // Weekdays at 09:00 and 15:00. Saturday 15:00, a day after Friday's last run, is 4x the 6h gap ahead.
  const a = cronHealth(snap({
    captured_at: '2026-10-31T15:00:00Z',
    ai_agents: [row('OpenclawLinkedInFlowAgent', { schedule: '0 9,15 * * 1-5', last_run_at: '2026-10-30T15:00:00Z' })],
    ai_agent_activity_logs: [], timers: [timer('OpenclawLinkedInFlowAgent', '0 9,15 * * 1-5', 'test', 'run_agent')],
  }));
  const alert = a.alerting[0].alerts[0];
  assert.equal(alert.type, 'critical');
  assert.match(alert.caution!, /possibly not a miss/);
});

test('a row whose firing schedule gives a different interval is flagged: normal gaps alert, or a stop is seen late', () => {
  const a = cronHealth(snap({
    ai_agents: [row('AutonomousRampEvaluator', { schedule: '0 */2 * * *' }), row('ApolloWeeklyEnrollmentAgent', { schedule: '0 14 * * 1' })],
    ai_agent_activity_logs: [],
    timers: [
      timer('AutonomousRampEvaluator', '0 13 * * 1-5', 'schedulerService.ts:3258', 'instrument_cron_job'),
      timer('ApolloWeeklyEnrollmentAgent', '0 14 * * 1-5', 'aiOpsScheduler.ts:226', 'run_agent'),
    ],
  }));
  const by = new Map(allListed(a).map((x) => [x.name, x]));
  assert.equal((by.get('AutonomousRampEvaluator') as { schedule_mismatch: string }).schedule_mismatch, 'false_alarms');
  assert.equal((by.get('ApolloWeeklyEnrollmentAgent') as { schedule_mismatch: string }).schedule_mismatch, 'late_detection');
  // Same interval at a different minute is not a mismatch.
  const offset = cronHealth(snap({ ai_agents: [row('NoShowDetector')], ai_agent_activity_logs: [], timers: [timer('NoShowDetector', '2,17,32,47 * * * *', 't', 'run_agent')] }));
  assert.equal(allListed(offset).every((x) => !('schedule_mismatch' in x) || x.schedule_mismatch === null), true);
});

test('a director whose gate records no run, and a counters-only timer, carry a note on what the check cannot see', () => {
  const a = cronHealth(snap({
    ai_agents: [row('WorkforceTechnologyDirector', { schedule: '7,22,37,52 * * * *', last_run_at: null }), row('AutonomousEngine', { schedule: '5,15,25,35,45,55 * * * *' })],
    ai_agent_activity_logs: [],
    timers: [timer('WorkforceTechnologyDirector', '7,22,37,52 * * * *', 'aiOpsScheduler.ts:379', 'director_gate'), timer('AutonomousEngine', '5,15,25,35,45,55 * * * *', 'aiOpsScheduler.ts:174', 'track_agent_run')],
  }));
  const by = new Map(a.partly_evaluated.map((e) => [e.name, e]));
  assert.ok(by.get('WorkforceTechnologyDirector')!.notes.some((n) => /records no run/.test(n)));
  assert.ok(by.get('AutonomousEngine')!.notes.some((n) => /no activity row per run/.test(n)));
});

test('clear only when every scheduled job was evaluated on both checks', () => {
  const a = cronHealth(snap());
  assert.equal(a.answer, 'clear');
  assert.equal(a.clear.length, 1);
  assert.equal(a.not_evaluated.length + a.partly_evaluated.length, 0);
});

const LIVE = `const RECENT_RUN_SAMPLE_SIZE = 10;
const MIN_SAMPLE_SIZE = 5;
const ERROR_RATE_WARNING_PERCENT = 50;
const ERROR_RATE_CRITICAL_PERCENT = 80;
const MISSED_RUN_WARNING_MULTIPLIER = 2;
const MISSED_RUN_CRITICAL_MULTIPLIER = 4;
  const agents = await AiAgent.findAll({
    where: { trigger_type: 'cron', enabled: true },
  });`;

test('live thresholds are read from source, and a changed selection or a missing constant is an error, not a fallback', () => {
  assert.deepEqual(readLiveThresholds(LIVE), PINNED_THRESHOLDS);
  assert.equal(readLiveThresholds(LIVE.replace('MIN_SAMPLE_SIZE = 5', 'MIN_SAMPLE_SIZE = 3')).MIN_SAMPLE_SIZE, 3);
  assert.throws(() => readLiveThresholds(LIVE.replace("trigger_type: 'cron', enabled: true", "enabled: true")), /no longer selects/);
  assert.throws(() => readLiveThresholds(LIVE.replace('const MIN_SAMPLE_SIZE = 5;', '')), /MIN_SAMPLE_SIZE/);
  const three = cronHealth(snap({ ai_agent_activity_logs: runs('ReesePresenceHeartbeat', ['failed', 'failed', 'failed']) }), readLiveThresholds(LIVE.replace('MIN_SAMPLE_SIZE = 5', 'MIN_SAMPLE_SIZE = 3')));
  assert.equal(three.alerting[0].alerts[0].type, 'critical');
});

test('the cron reader matches cron-parser 5.5.0 on lists, ranges, steps, names and the either-day rule', () => {
  const at = (expr: string, after: string) => nextFire(parseCron(expr)!, new Date(after))!.toISOString();
  assert.equal(at('7,22,37,52 * * * *', '2026-10-27T18:00:00Z'), '2026-10-27T18:07:00.000Z');
  assert.equal(at('0 9,15 * * 1-5', '2026-10-30T15:00:00Z'), '2026-11-02T09:00:00.000Z');
  assert.equal(at('0 9 * * MON-FRI', '2026-10-31T00:00:00Z'), '2026-11-02T09:00:00.000Z');
  assert.equal(at('0 0 13 * 5', '2026-10-27T00:00:00Z'), '2026-10-30T00:00:00.000Z'); // the 13th or a Friday: Friday comes first
  assert.equal(at('*/15 * * * *', '2026-10-27T18:00:00Z'), '2026-10-27T18:15:00.000Z');
  assert.equal(expectedIntervalMs(parseCron('0 13 * * 0')!, new Date(NOW)), 7 * 24 * 3_600_000);
  assert.deepEqual(gapRange(parseCron('0 9,15 * * 1-5')!, new Date(NOW)), { shortest: 6 * 3_600_000, longest: 66 * 3_600_000 });
  for (const bad of ['not-a-cron-expr', '* * * *', '60 * * * *', '0 0 * * 8', '*/0 * * * *', '0 0 0 0 0 0']) assert.equal(parseCron(bad), null, bad);
});

test('the command exits 4 when any job alerts, 3 with blind spots, 0 when all clear, 1 for bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cron-health-'));
  const run = (s: unknown) => {
    const p = join(dir, `${seq++}.json`);
    writeFileSync(p, JSON.stringify(s));
    return spawnSync(process.execPath, ['src/cli/cronHealth.ts', '--snapshot', p], { encoding: 'utf8' });
  };
  assert.equal(run(snap()).status, 0);
  assert.equal(run(snap({ ai_agents: [row('ReesePresenceHeartbeat', { last_run_at: '2026-10-27T10:00:00Z' })] })).status, 4);
  assert.equal(spawnSync(process.execPath, ['src/cli/cronHealth.ts', '--snapshot', 'examples/cron-health.example.json'], { encoding: 'utf8' }).status, 3);
  const bad = run({ captured_at: NOW, ai_agents: [{ agent_name: 'x', enabled: true }], ai_agent_activity_logs: [], timers: [], timer_scope: [] });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ContractViolation/);
});
