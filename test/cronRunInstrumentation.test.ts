import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { askRun, coverage, NOT_INSTRUMENTED, type RunSnapshot, type RunRow, type RunLog, type NotInstrumented, type Instrumented } from '../src/capabilities/cronRunInstrumentation.ts';
import type { TimerRow } from '../src/capabilities/agentEnableDisableControl.ts';

// Names, schedules and wiring mirror the platform at bb1d3c3; counts and times are test inputs, not production data.
const row = (name: string, over: Partial<RunRow> = {}): RunRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', run_count: 1, avg_duration_ms: 500, last_run_at: '2026-10-27T11:00:00.500Z', error_count: 0, last_error: null, last_error_at: null, ...over });
const log = (id: string, name: string, over: Partial<RunLog> = {}): RunLog => ({ id, agent_id: `row-${name}`, action: name, result: 'success', trace_id: `trace-${id}`, duration_ms: 500, reason: 'Completed in 500ms', created_at: '2026-10-27T11:00:00.500Z', ...over });
const timer = (t: string, schedule: string, ref: string, gates: TimerRow['gates']): TimerRow => ({ timer: t, schedule, label: t, ref, gates });
const ic = (flag: string): TimerRow['gates'] => [{ gate: 'instrument_cron_job', flag }];

function snap(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test',
    ai_agents: [row('ReesePresenceHeartbeat')],
    ai_agent_activity_logs: [log('r1', 'ReesePresenceHeartbeat')],
    timers: [
      timer('ReesePresenceHeartbeat', '*/1 * * * *', 'schedulerService.ts:1750', ic('ReesePresenceHeartbeat')),
      timer('ReliabilityAlerting', '*/15 * * * *', 'schedulerService.ts:1901', ic('ReliabilityAlerting')),
    ],
    timer_scope: ['schedulerService.ts'],
    ...over,
  };
}

const DID_NOT_RUN = /did not run|didn't run|never ran|not run\b|no runs?\b(?! is recorded)/i;

// The real inventory (capability 13), built from platform source: 69 timers, 259 rows created in code.
function realInventory(): RunSnapshot {
  const inv = JSON.parse(readFileSync(new URL('../examples/timer-inventory.example.json', import.meta.url), 'utf8'));
  return {
    captured_at: inv.captured_at, captured_by: inv.captured_by,
    ai_agents: inv.ai_agents.map((a: { id: string; agent_name: string; enabled: boolean; status: string }) => row(a.agent_name, { id: a.id, enabled: a.enabled, status: a.status, run_count: 0, last_run_at: null, avg_duration_ms: null })),
    ai_agent_activity_logs: [], timers: inv.timers, timer_scope: [inv.captured_by],
  };
}

test("acceptance: for an untracked timer the answer is 'not instrumented, no record exists', never 'did not run'", () => {
  const a = askRun(snap(), 'ReliabilityAlerting') as NotInstrumented;
  assert.equal(a.answer, 'not_instrumented');
  assert.equal(a.ran, null);
  assert.ok(a.statement.startsWith(`ReliabilityAlerting: ${NOT_INSTRUMENTED}.`), a.statement);
  assert.doesNotMatch(a.statement, DID_NOT_RUN);
  assert.deepEqual(a.citations, []);
  assert.equal(a.timers.length, 1);
  assert.match(a.timers[0].note, /runs it anyway, untracked/);
});

test('acceptance, positive control: a name known to have no ai_agents row returns the not-instrumented answer', () => {
  // ReliabilityAlerting is in the platform's own baseline of scheduled names with no seed row
  // (services/__tests__/fixtures/cronRegistryBaseline.ts, KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW).
  const inv = realInventory();
  assert.equal(inv.ai_agents.some((r) => r.agent_name === 'ReliabilityAlerting'), false, 'control is not a control: a row exists');
  const a = askRun(inv, 'ReliabilityAlerting');
  assert.equal(a.answer, 'not_instrumented');
  assert.ok(a.statement.includes(NOT_INSTRUMENTED));
  assert.doesNotMatch(a.statement, DID_NOT_RUN);
});

test('every timer in the real inventory whose row is missing gets the not-instrumented answer (33, as the platform baseline says)', () => {
  const inv = realInventory();
  const names = new Set(inv.ai_agents.map((r) => r.agent_name));
  const missing = [...new Set(inv.timers.filter((t) => t.gates[0].flag !== null && !names.has(t.gates[0].flag)).map((t) => t.gates[0].flag as string))];
  assert.equal(coverage(inv).not_instrumented.length, 33);
  for (const n of missing) {
    const a = askRun(inv, n);
    assert.equal(a.answer, 'not_instrumented', n);
    assert.doesNotMatch(a.statement, DID_NOT_RUN, n);
  }
});

test('a name with no row and no timer is still not instrumented, said with the inventory scope', () => {
  const a = askRun(snap(), 'NoSuchJob') as NotInstrumented;
  assert.equal(a.answer, 'not_instrumented');
  assert.match(a.statement, /No timer by that name was found in schedulerService\.ts/);
});

test('a row with a similar name never answers for an untracked one', () => {
  const s = snap({ ai_agents: [row('ReliabilityAlertingAgent', { run_count: 50 })], ai_agent_activity_logs: [log('x', 'ReliabilityAlertingAgent')] });
  assert.equal(askRun(s, 'ReliabilityAlerting').answer, 'not_instrumented');
});

test('a timer that records under another row points there instead of answering', () => {
  const s = snap({ timers: [timer('AdmissionsAssistant', '4,14,24,34,44,54 * * * *', 'aiOpsScheduler.ts:240', [{ gate: 'run_agent', flag: 'AdmissionsAssistantAgent' }])] });
  const a = askRun(s, 'AdmissionsAssistant') as NotInstrumented;
  assert.equal(a.answer, 'not_instrumented');
  assert.match(a.timers[0].note, /records under row AdmissionsAssistantAgent/);
});

test('a recorded run answers when, how long, and whether it failed, with its trace', () => {
  const a = askRun(snap(), 'ReesePresenceHeartbeat') as Instrumented;
  assert.equal(a.answer, 'run_recorded');
  assert.equal(a.recording, 'per_run');
  assert.deepEqual(a.last_run, { finished_at: '2026-10-27T11:00:00.500Z', started_at: '2026-10-27T11:00:00.000Z', duration_ms: 500, result: 'success', error: null, error_class: null, trace_id: 'trace-r1', source: 'activity_log' });
  assert.equal(a.failed, false);
  assert.match(a.statement, /took 500 ms, and succeeded/);
  assert.match(a.cannot_say[0], /error class.*cronInstrumentation\.ts:62-65/);
  assert.deepEqual(a.citations.map((c) => c.id), ['row-ReesePresenceHeartbeat', 'r1']);
});

test('the latest run row decides, and a failure carries its message and the did-it-start caveat', () => {
  const s = snap({
    ai_agents: [row('ReesePresenceHeartbeat', { run_count: 2, error_count: 1 })],
    ai_agent_activity_logs: [log('old', 'ReesePresenceHeartbeat', { created_at: '2026-10-27T10:00:00.500Z' }), log('new', 'ReesePresenceHeartbeat', { result: 'failed', reason: 'connect ETIMEDOUT' })],
  });
  const a = askRun(s, 'ReesePresenceHeartbeat') as Instrumented;
  assert.equal(a.failed, true);
  assert.equal(a.last_run?.error, 'connect ETIMEDOUT');
  assert.equal(a.last_run?.trace_id, 'trace-new');
  assert.ok(a.cannot_say.some((c) => /failed run started its job.*:59-66/.test(c)));
});

test('the did-it-start caveat is only for the instrumentCronJob wrapper', () => {
  const s = snap({
    ai_agents: [row('PromptMonitorAgent')],
    ai_agent_activity_logs: [log('f', 'PromptMonitorAgent', { action: 'agent_execution_failed', result: 'failed' })],
    timers: [timer('PromptMonitorAgent', '*/1 * * * *', 'aiOpsScheduler.ts:203', [{ gate: 'run_agent', flag: 'PromptMonitorAgent' }])],
  });
  const a = askRun(s, 'PromptMonitorAgent') as Instrumented;
  assert.equal(a.failed, true);
  assert.equal(a.cannot_say.some((c) => /started its job/.test(c)), false);
  assert.match(a.cannot_say[0], /aiOrchestrator\.ts:298/);
});

test('activity rows that are not runs (no trace or no duration, or a pending result) are not read as runs', () => {
  const s = snap({
    ai_agents: [row('ReesePresenceHeartbeat', { run_count: 0, last_run_at: null })],
    ai_agent_activity_logs: [log('a', 'ReesePresenceHeartbeat', { trace_id: null }), log('b', 'ReesePresenceHeartbeat', { duration_ms: null }), log('c', 'ReesePresenceHeartbeat', { result: 'pending' })],
  });
  const a = askRun(s, 'ReesePresenceHeartbeat') as Instrumented;
  assert.equal(a.answer, 'no_run_recorded');
  assert.equal(a.totals.activity_runs, 0);
  assert.equal(a.last_run, null);
});

test('counters-only wrapper: a failure is read from last_error_at, and 0 errors is not taken as no failures', () => {
  const t = [timer('AutonomousEngine', '5,15,25,35,45,55 * * * *', 'aiOpsScheduler.ts:214', [{ gate: 'track_agent_run', flag: 'AutonomousEngine' }])];
  const failed = askRun(snap({ timers: t, ai_agent_activity_logs: [], ai_agents: [row('AutonomousEngine', { run_count: 40, last_run_at: '2026-10-27T11:55:09.300Z', last_error: '429', last_error_at: '2026-10-27T11:55:09.301Z' })] }), 'AutonomousEngine') as Instrumented;
  assert.equal(failed.recording, 'counters_only');
  assert.equal(failed.failed, true);
  assert.equal(failed.last_run?.source, 'counters');
  assert.equal(failed.last_run?.started_at, null);
  assert.ok(failed.cannot_say.some((c) => /never increments error_count/.test(c)));
  assert.match(failed.cannot_say[0], /agentRunTracker\.ts:61/);

  const older = askRun(snap({ timers: t, ai_agent_activity_logs: [], ai_agents: [row('AutonomousEngine', { last_run_at: '2026-10-27T11:55:09.300Z', last_error: '429', last_error_at: '2026-10-27T09:00:00.000Z' })] }), 'AutonomousEngine') as Instrumented;
  assert.equal(older.failed, null);
  assert.match(older.statement, /outcome not recorded/);
  assert.ok(older.cannot_say.some((c) => /whether the last run succeeded/.test(c)));
});

test('a disabled row with nothing recorded says no run is recorded and that skips leave no record, never that it did not run', () => {
  const a = askRun(snap({ ai_agents: [row('ReesePresenceHeartbeat', { enabled: false, run_count: 0, last_run_at: null, avg_duration_ms: null })], ai_agent_activity_logs: [] }), 'ReesePresenceHeartbeat') as Instrumented;
  assert.equal(a.answer, 'no_run_recorded');
  assert.equal(a.failed, null);
  assert.ok(a.cannot_say.some((c) => /disabled job is skipped with no activity row/.test(c)));
  assert.doesNotMatch(a.statement, /did not run|never ran/i);
});

test('a paused row and a running row each name what they hide', () => {
  const paused = askRun(snap({ ai_agents: [row('ReesePresenceHeartbeat', { status: 'paused' })] }), 'ReesePresenceHeartbeat') as Instrumented;
  assert.ok(paused.cannot_say.some((c) => /paused job is skipped/.test(c)));
  const running = askRun(snap({ ai_agents: [row('ReesePresenceHeartbeat', { status: 'running' })] }), 'ReesePresenceHeartbeat') as Instrumented;
  assert.ok(running.cannot_say.some((c) => /status is running.*previous run's finish/.test(c)));
});

test('pooled timers, missing run rows and an unread row are each named', () => {
  const dara = (ref: string, s: string) => timer('Dara', s, ref, ic('Dara'));
  const pooled = askRun(snap({ ai_agents: [row('Dara', { run_count: 3 })], ai_agent_activity_logs: [log('d', 'Dara')], timers: [dara('aiOpsScheduler.ts:367', '10 6 * * *'), dara('aiOpsScheduler.ts:369', '30 6 * * *')] }), 'Dara') as Instrumented;
  assert.ok(pooled.cannot_say.some((c) => /2 timers record under this one row/.test(c)));
  assert.ok(pooled.cannot_say.some((c) => /2 of 3 counted runs/.test(c)));
  const unread = askRun(snap({ ai_agents: [row('Orphan')], ai_agent_activity_logs: [] }), 'Orphan') as Instrumented;
  assert.equal(unread.recording, 'unknown');
  assert.ok(unread.cannot_say.some((c) => /none in schedulerService\.ts does/.test(c)));
});

test('two rows with one name give no single answer', () => {
  const a = askRun(snap({ ai_agents: [row('Dup', { id: 'b' }), row('Dup', { id: 'a' })] }), 'Dup');
  assert.equal(a.answer, 'ambiguous');
  assert.deepEqual(a.answer === 'ambiguous' && a.row_ids, ['a', 'b']);
});

test('coverage groups every timer by what can be answered for it', () => {
  const s = JSON.parse(readFileSync(new URL('../examples/cron-runs.example.json', import.meta.url), 'utf8')) as RunSnapshot;
  const c = coverage(s);
  assert.deepEqual(c.not_instrumented.map((t) => t.timer).sort(), ['BlogRefresh', 'ReliabilityAlerting']);
  assert.deepEqual(c.counters_only.map((t) => t.timer), ['AutonomousEngine']);
  assert.equal(c.per_run.length, 6);
  assert.equal(c.unknown.length, 0);
  assert.equal(c.per_run.length + c.counters_only.length + c.not_instrumented.length + c.unknown.length, s.timers.length);
});

test('idempotent: the same snapshot in any order gives the same answer, and the input is not changed', () => {
  const s = snap({ ai_agent_activity_logs: [log('a', 'ReesePresenceHeartbeat', { created_at: '2026-10-27T10:00:00.500Z' }), log('b', 'ReesePresenceHeartbeat')] });
  const before = JSON.stringify(s);
  const one = askRun(s, 'ReesePresenceHeartbeat');
  const flipped = { ...s, ai_agent_activity_logs: [...s.ai_agent_activity_logs].reverse(), timers: [...s.timers].reverse() };
  assert.deepEqual(askRun(flipped, 'ReesePresenceHeartbeat'), one);
  assert.equal(JSON.stringify(s), before);
});

test('CLI: example exits 3 (not every name has a run), bad input exits 1 with an error class', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, ['src/cli/cronRuns.ts', ...args], { encoding: 'utf8' });
  const ok = cli(['--snapshot', 'examples/cron-runs.example.json', '--name', 'ReliabilityAlerting', '--name', 'ReesePresenceHeartbeat']);
  assert.equal(ok.status, 3);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.answers.find((a: { name: string }) => a.name === 'ReliabilityAlerting').answer, 'not_instrumented');
  assert.equal(cli(['--snapshot', 'examples/cron-runs.example.json', '--name', 'ReesePresenceHeartbeat']).status, 0);
  assert.equal(cli(['--snapshot', 'examples/cron-runs.example.json', '--coverage']).status, 3);
  const bad = cli(['--snapshot', 'no-such-file.json', '--name', 'X']);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).error_class, 'SourceUnavailable');
  assert.equal(cli(['--snapshot', 'examples/cron-runs.example.json']).status, 1);
});
