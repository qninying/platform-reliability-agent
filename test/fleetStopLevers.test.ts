import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { ControlSnapshot, TimerRow, ControlAgentRow } from '../src/capabilities/agentEnableDisableControl.ts';
import { fleetStop, leversForTimer, OUTBOUND_CATEGORIES } from '../src/capabilities/fleetStopLevers.ts';

// The inventory is the platform's timer wiring built from code (c699e58, rebuilt at 4443087), not production data.
const INVENTORY = 'examples/timer-inventory.example.json';
const inventory = (): ControlSnapshot => JSON.parse(readFileSync(INVENTORY, 'utf8'));
const timer = (name: string, gate: TimerRow['gates'][0]['gate'] = 'instrument_cron_job', flag: string | null = name, ref = 'backend/src/services/schedulerService.ts:1'): TimerRow => ({ timer: name, schedule: '*/5 * * * *', label: name, ref, gates: [{ gate, flag }] });
const row = (name: string, over: Partial<ControlAgentRow> = {}): ControlAgentRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', category: 'operations', ...over });
const snap = (timers: TimerRow[], rows: ControlAgentRow[], gov: ControlSnapshot['cron_schedule_configs'] = []): ControlSnapshot => ({ captured_at: '2026-11-04T12:00:00Z', captured_by: 'test', timers, ai_agents: rows, cron_schedule_configs: gov, requests: [] });
const reach = (s: ControlSnapshot, t: TimerRow, lever: string) => leversForTimer(s, t).levers.find((l) => l.lever === lever)?.reach;

test('acceptance: for a schedulerService job no row reaches, no per-agent stop is named, and the scheduler pause is named as blocking sends only', () => {
  const s = inventory();
  const t = s.timers.find((x) => x.timer === 'PaySimplePaymentSync')!;
  assert.match(t.ref, /schedulerService\.ts/);
  const l = leversForTimer(s, t);
  assert.equal(l.row, null);
  assert.ok(!l.stopped_by.includes('agent_disable') && !l.stopped_by.includes('emergency_stop'), 'a per-agent or fleet disable cannot reach a timer with no row');
  assert.equal(reach(s, t, 'scheduler_pause'), 'blocks_sends_only');
  assert.match(l.statement, /No lever stops PaySimplePaymentSync from running/);
});

test('acceptance, on the code as it is: the scheduler pause stops no timer at all, so it is never recommended as stopping a job', () => {
  const s = inventory();
  for (const t of s.timers) {
    assert.equal(reach(s, t, 'scheduler_pause'), 'blocks_sends_only', t.timer);
    assert.ok(!leversForTimer(s, t).stopped_by.includes('scheduler_pause'), t.timer);
  }
  assert.deepEqual(fleetStop(s).scheduler_pause.timers_stopped, []);
});

test('a schedulerService job with a row is stopped by its own disable and by the emergency stop', () => {
  const s = inventory();
  const t = s.timers.find((x) => x.timer === 'ReesePresenceHeartbeat')!;
  const l = leversForTimer(s, t);
  assert.deepEqual(l.stopped_by.filter((x) => x !== 'kill_switch' && x !== 'governance_row'), ['agent_disable', 'emergency_stop']);
});

test('on the real inventory, the emergency stop reaches only timers with a row; the 33 with none keep running', () => {
  const a = fleetStop(inventory());
  assert.equal(a.emergency_stop.timers_stopped.length + a.emergency_stop.already_off.length + a.emergency_stop.timers_not_reached.length, 69);
  // A timer whose row is already disabled is off, not running.
  for (const t of a.emergency_stop.already_off) assert.ok(!a.emergency_stop.timers_not_reached.some((x) => x.timer === t), t);
  assert.equal(a.emergency_stop.timers_not_reached.filter((x) => /there is no .* row/.test(x.why)).length, 33);
  assert.match(a.statement, /keep running/);
});

test('an already-disabled row is not reached again, and a wrapper that never reads a row is never reached', () => {
  const s = snap([timer('Off'), timer('Blind', 'none', null), timer('Mystery', 'unknown', 'Mystery'), timer('Ignores', 'none', 'Ignores')], [row('Off', { enabled: false }), row('Mystery'), row('Ignores')]);
  assert.equal(reach(s, s.timers[0], 'emergency_stop'), 'does_not_reach');
  assert.equal(reach(s, s.timers[1], 'emergency_stop'), 'does_not_reach');
  assert.equal(reach(s, s.timers[2], 'emergency_stop'), 'unknown');
  // A row exists, but the wrapper never reads it, so disabling it stops nothing.
  assert.equal(reach(s, s.timers[3], 'emergency_stop'), 'does_not_reach');
  assert.deepEqual(fleetStop(s).emergency_stop.timers_stopped, []);
  assert.deepEqual(fleetStop(s).emergency_stop.already_off, ['Off']);
});

test('the kill switch stops an outbound row\'s run, and only blocks the sends of every other job', () => {
  assert.ok(OUTBOUND_CATEGORIES.includes('sms'));
  const s = snap([timer('Texter'), timer('Ops')], [row('Texter', { category: 'sms' }), row('Ops')]);
  assert.equal(reach(s, s.timers[0], 'kill_switch'), 'stops_the_run');
  assert.equal(reach(s, s.timers[1], 'kill_switch'), 'blocks_sends_only');
  assert.equal(fleetStop(s).kill_switch.rows_disabled, 1);
  // A row with no category is not outbound.
  assert.equal(reach(snap([timer('X')], [row('X', { category: null })]), timer('X'), 'kill_switch'), 'blocks_sends_only');
});

test('a governance row is named as a separate lever that stops the timer itself', () => {
  const s = snap([timer('NoRow')], [], [{ agent_name: 'NoRow', enabled: true, schedule: '*/5 * * * *' }]);
  const l = leversForTimer(s, s.timers[0]);
  assert.deepEqual(l.stopped_by, ['governance_row']);
});

test('resume: a row a person disabled and paused, and a row a person paused, are both named as undone; a plain disable is not', () => {
  const s = snap([], [row('HumanOff', { enabled: false, status: 'idle' }), row('HumanOffPaused', { enabled: false, status: 'paused' }), row('HumanPaused', { status: 'paused' }), row('Running')]);
  const a = fleetStop(s);
  assert.deepEqual(a.resume_undoes.map((r) => r.agent_name), ['HumanOffPaused', 'HumanPaused']);
  assert.match(a.resume_undoes[0].after_resume, /re-enables it/);
  assert.match(a.resume_undoes[1].after_resume, /pause is lost/);
  assert.match(a.statement, /resume them by name/);
  assert.match(fleetStop(snap([], [row('A')])).statement, /would undo no earlier choice/);
});

test('every answer cites the rows it read, and the same input gives the same answer', () => {
  const s = inventory();
  const a = fleetStop(s);
  assert.equal(a.citations.length, s.ai_agents.length);
  assert.equal(a.decided_by, 'a named human');
  assert.deepEqual(fleetStop(inventory()), a);
});

test('the command prints the fleet view and exits 3 while any timer keeps running under an emergency stop', () => {
  const r = spawnSync(process.execPath, ['src/cli/disableRecommendation.ts', '--snapshot', INVENTORY, '--fleet-stop'], { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.fleet_stop.emergency_stop.timers_not_reached.length > 0, true);
  const both = spawnSync(process.execPath, ['src/cli/disableRecommendation.ts', '--snapshot', INVENTORY, '--fleet-stop', '--pause-gaps'], { encoding: 'utf8' });
  assert.equal(both.status, 1);
});
