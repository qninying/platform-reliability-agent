import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendDisable, recommendAll, type ControlSnapshot, type TimerRow, type ControlAgentRow } from '../src/capabilities/agentEnableDisableControl.ts';

// Timers mirror the platform's scheduler wiring at a284987; rows are test inputs, not production data.
const EVIDENCE = [{ source: 'ai_agent_activity_logs', ref: 'log-1', summary: '12 failed runs in the last hour' }];
const timer = (t: string, gates: TimerRow['gates'], over: Partial<TimerRow> = {}): TimerRow => ({ timer: t, schedule: '0 6 * * *', label: `${t} timer`, ref: `aiOpsScheduler.ts:${t.length}`, gates, ...over });
const row = (name: string, over: Partial<ControlAgentRow> = {}): ControlAgentRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', ...over });

function snap(): ControlSnapshot {
  return {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test',
    timers: [
      timer('Dara', [{ gate: 'instrument_cron_job', flag: 'Dara' }, { gate: 'director_gate', flag: 'WorkforceCurriculumDirector' }], { label: 'Curriculum director', ref: 'aiOpsScheduler.ts:367' }),
      timer('Dara', [{ gate: 'instrument_cron_job', flag: 'Dara' }, { gate: 'director_gate', flag: 'WorkforceCertificationDirector' }], { label: 'Certification director', ref: 'aiOpsScheduler.ts:369' }),
      timer('Dara', [{ gate: 'instrument_cron_job', flag: 'Dara' }], { label: 'Targeted research sweep', ref: 'aiOpsScheduler.ts:375' }),
      timer('AdmissionsAssistant', [{ gate: 'run_agent', flag: 'AdmissionsAssistantAgent' }]),
      timer('AutonomousEngine', [{ gate: 'track_agent_run', flag: 'AutonomousEngine' }]),
      timer('WeeklyReport', [{ gate: 'run_agent', flag: 'WeeklyReport' }]),
      timer('BareJob', [{ gate: 'none', flag: null }]),
      timer('Mystery', [{ gate: 'unknown', flag: 'Mystery' }]),
    ],
    ai_agents: [row('Dara'), row('WorkforceCurriculumDirector'), row('WorkforceCertificationDirector'), row('AdmissionsAssistantAgent'), row('AutonomousEngine'), row('Mystery'), row('Orphan')],
    cron_schedule_configs: [{ agent_name: 'Dara', enabled: true, schedule: null }],
    requests: [],
  };
}
const rec = (name: string, s = snap(), evidence = EVIDENCE) => recommendDisable(s, { agent_name: name, evidence });

test('acceptance: a recommendation for a shared agent_name lists all timers that share it', () => {
  const r = rec('Dara');
  assert.equal(r.recommendation, 'disable');
  assert.deepEqual(r.would_stop.map((w) => w.ref), ['aiOpsScheduler.ts:367', 'aiOpsScheduler.ts:369', 'aiOpsScheduler.ts:375']);
  assert.match(r.statement, /affects 3 timer\(s\): Curriculum director; Certification director; Targeted research sweep/);
  assert.equal(r.action?.path, '/api/admin/ai-ops/registry/row-Dara/control');
  assert.equal(r.action?.performed_by, 'a person, never Ellis');
});

test('acceptance: a recommendation for an unregistered name states that no disable flag exists rather than proposing one', () => {
  const r = rec('WeeklyReport');
  assert.equal(r.recommendation, 'none');
  assert.deepEqual(r.flag, { exists: false });
  assert.equal(r.action, null);
  assert.match(r.statement, /No disable flag exists for WeeklyReport/);
  assert.match(r.statement, /does not propose creating one/);
  assert.deepEqual(r.would_stop, []);
  assert.match(r.would_not_stop[0].effect, /no WeeklyReport row to disable; finding none, the wrapper returns without running/);
  const s = snap();
  s.timers.push(timer('Untracked', [{ gate: 'instrument_cron_job', flag: 'Untracked' }]));
  assert.match(rec('Untracked', s).would_not_stop[0].effect, /runs it anyway, untracked/);
  const none = rec('NeverHeardOf');
  assert.equal(none.action, null);
  assert.match(none.statement, /No disable flag exists/);
});

test('a timer named one thing but gated by another row is listed as not stopped, naming the row that would', () => {
  const r = rec('AdmissionsAssistant');
  assert.equal(r.action, null);
  assert.match(r.would_not_stop[0].effect, /checks row AdmissionsAssistantAgent/);
  const right = rec('AdmissionsAssistantAgent');
  assert.equal(right.recommendation, 'disable');
  assert.deepEqual(right.would_stop.map((w) => w.timer), ['AdmissionsAssistant']);
});

test("disabling an inner row stops the writes, not the run, and says so", () => {
  const r = rec('WorkforceCurriculumDirector');
  assert.equal(r.would_stop.length, 1);
  assert.match(r.would_stop[0].effect, /still fires and an earlier row counts the run, but its writes are blocked/);
  assert.match(rec('Dara').would_stop[0].effect, /^the run stops/);
});

test('pause is flagged where the wrapper ignores it, and the in-run reset is always noted', () => {
  const r = rec('AutonomousEngine');
  assert.ok(r.notes.some((n) => /pause would not stop AutonomousEngine/.test(n)));
  assert.ok(r.notes.some((n) => /undone when that run finishes/.test(n)));
  assert.ok(!rec('Dara').notes.some((n) => /pause would not stop/.test(n)));
});

test('a wrapper that never reads the row, or one that is not known, is never counted as stopped', () => {
  const s = snap();
  s.timers.push(timer('Orphan', [{ gate: 'none', flag: 'Orphan' }]));
  const r = rec('Orphan', s);
  assert.deepEqual(r.would_stop, []);
  assert.match(r.would_not_stop[0].effect, /never reads the row/);
  assert.match(r.statement, /stops nothing on a schedule/);
  assert.match(rec('Mystery').would_not_stop[0].effect, /cannot say/);
  assert.match(rec('BareJob').would_not_stop[0].effect, /checks no row at all/);
});

test('no evidence, or an agent already disabled, gives no recommendation', () => {
  const noEvidence = rec('Dara', snap(), []);
  assert.equal(noEvidence.recommendation, 'none');
  assert.equal(noEvidence.action, null);
  assert.match(noEvidence.statement, /No evidence was given/);
  const s = snap();
  s.ai_agents[0] = row('Dara', { enabled: false });
  const off = rec('Dara', s);
  assert.equal(off.recommendation, 'none');
  assert.match(off.statement, /already disabled/);
  assert.equal(off.would_stop.length, 3);
});

test('the governance switch is named as a separate way to stop the timer', () => {
  const r = rec('Dara');
  assert.deepEqual(r.governance.map((g) => g.timer), ['Dara']);
  assert.match(r.governance[0].note, /separate switch/);
  assert.deepEqual(rec('AutonomousEngine').governance, []);
  assert.deepEqual(rec('WorkforceCurriculumDirector').governance.map((g) => g.timer), ['Dara']);
});

test('a recommendation is always for a human to act on, and cites the row it reads', () => {
  for (const name of ['Dara', 'WeeklyReport', 'AutonomousEngine']) assert.equal(rec(name).decided_by, 'a named human');
  assert.deepEqual(rec('Dara').citations, [{ table: 'ai_agents', id: 'row-Dara', fields: ['agent_name', 'enabled', 'status'] }]);
  assert.deepEqual(rec('WeeklyReport').citations, []);
});

test('evidence is carried through with the recommendation', () => {
  const ev = [{ source: 'tickets', ref: 't-2', summary: 'b' }, { source: 'ai_agents', ref: 'a-1', summary: 'a' }];
  assert.deepEqual(rec('Dara', snap(), ev).evidence.map((e) => e.ref), ['a-1', 't-2']);
});

test('idempotent: the same rows and requests in any order give the same recommendations', () => {
  const s = snap();
  s.requests = [{ agent_name: 'Dara', evidence: EVIDENCE }, { agent_name: 'WeeklyReport', evidence: EVIDENCE }, { agent_name: 'AutonomousEngine', evidence: EVIDENCE }];
  const reversed: ControlSnapshot = { ...s, timers: [...s.timers].reverse(), ai_agents: [...s.ai_agents].reverse(), requests: [...s.requests].reverse() };
  assert.deepEqual(recommendAll(s), recommendAll(reversed));
  assert.deepEqual(recommendAll(s).map((r) => r.agent_name), ['AutonomousEngine', 'Dara', 'WeeklyReport']);
});
