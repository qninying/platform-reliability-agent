import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askRegistry, type RegistrySnapshot, type RegistryRow, type NotRegistered, type Registered } from '../src/capabilities/registryReadSurface.ts';
import type { TimerRow } from '../src/capabilities/agentEnableDisableControl.ts';

// Names, schedules and wiring mirror the platform at bb1d3c3; counts are test inputs, not production data.
const row = (name: string, over: Partial<RegistryRow> = {}): RegistryRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', schedule: null, run_count: 10, error_count: 0, last_run_at: '2026-10-27T11:00:00Z', ...over });
const timer = (t: string, schedule: string, ref: string, gates: TimerRow['gates']): TimerRow => ({ timer: t, schedule, label: t, ref, gates });

function snap(): RegistrySnapshot {
  return {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test',
    ai_agents: [
      row('PromptMonitorAgent', { schedule: '*/1 * * * *' }),
      row('Dara', { schedule: '10 6 * * *', run_count: 30 }),
      row('WorkforceCurriculumDirector', { run_count: 0 }),
      row('TicketManagementAgent', { schedule: '*/15 * * * *', run_count: 0 }),
      row('MarketingPublishingWorker', { enabled: false, run_count: 0 }),
      row('AdmissionsAssistantAgent'),
    ],
    ai_agent_activity_logs: [
      { id: 'a1', agent_id: 'row-PromptMonitorAgent', result: 'success', created_at: '2026-10-27T11:59:00Z' },
      { id: 'a2', agent_id: 'row-PromptMonitorAgent', result: 'success', created_at: '2026-10-27T11:58:00Z' },
    ],
    timers: [
      timer('PromptMonitorAgent', '*/1 * * * *', 'aiOpsScheduler.ts:203', [{ gate: 'run_agent', flag: 'PromptMonitorAgent' }]),
      timer('Dara', '10 6 * * *', 'aiOpsScheduler.ts:367', [{ gate: 'instrument_cron_job', flag: 'Dara' }, { gate: 'director_gate', flag: 'WorkforceCurriculumDirector' }]),
      timer('Dara', '30 6 * * *', 'aiOpsScheduler.ts:369', [{ gate: 'instrument_cron_job', flag: 'Dara' }]),
      timer('Dara', '15 6 * * *', 'aiOpsScheduler.ts:375', [{ gate: 'instrument_cron_job', flag: 'Dara' }]),
      timer('AliPersonalOutreach', '20 14-22 * * 1-5', 'schedulerService.ts:3234', [{ gate: 'instrument_cron_job', flag: 'AliPersonalOutreach' }]),
      timer('AdmissionsAssistant', '4,14,24,34,44,54 * * * *', 'aiOpsScheduler.ts:240', [{ gate: 'run_agent', flag: 'AdmissionsAssistantAgent' }]),
    ],
    timer_scope: ['aiOpsScheduler.ts', 'schedulerService.ts'],
    cron_schedule_configs: [],
  };
}

test("acceptance: a question about a name with no ai_agents row returns 'not registered', never 'disabled' and never 'zero runs'", () => {
  for (const name of ['AliPersonalOutreach', 'AdmissionsAssistant', 'NoSuchAgent']) {
    const a = askRegistry(snap(), name) as NotRegistered;
    assert.equal(a.registration, 'not_registered', name);
    assert.deepEqual(a.facts, ['not registered']);
    assert.equal(a.enabled, null, 'no enabled state without a row');
    assert.equal(a.runs, null, 'no run count without a row');
    assert.doesNotMatch(a.statement, /\bis disabled\b|has no recorded runs|0 recorded run/);
    assert.match(a.statement, /is not registered: there is no ai_agents row/);
  }
  const disabled = askRegistry(snap(), 'MarketingPublishingWorker') as Registered;
  assert.deepEqual([disabled.registration, disabled.enabled], ['registered', false]);
  assert.ok(disabled.facts.includes('disabled'));
  const never = askRegistry(snap(), 'TicketManagementAgent') as Registered;
  assert.deepEqual([never.registration, never.enabled], ['registered', true]);
  assert.ok(never.facts.includes('no recorded runs'));
  assert.ok(!never.facts.includes('disabled'));
});

test('a timer with no row is named, with what its wrapper does; one that checks another row points there', () => {
  const ali = askRegistry(snap(), 'AliPersonalOutreach') as NotRegistered;
  assert.match(ali.timers_with_this_name[0].note, /runs it anyway, untracked/);
  assert.match(ali.statement, /A timer by that name does exist: AliPersonalOutreach \(20 14-22 \* \* 1-5, schedulerService\.ts:3234\)/);
  const adm = askRegistry(snap(), 'AdmissionsAssistant') as NotRegistered;
  assert.match(adm.timers_with_this_name[0].note, /checks row AdmissionsAssistantAgent; ask about AdmissionsAssistantAgent/);
  assert.deepEqual(adm.similar_registered_names, ['AdmissionsAssistantAgent']);
  const none = askRegistry(snap(), 'NoSuchAgent') as NotRegistered;
  assert.match(none.statement, /No timer by that name was found in aiOpsScheduler\.ts, schedulerService\.ts/);
});

test('a registered agent answers with its state, live schedule and runs, citing the rows', () => {
  const a = askRegistry(snap(), 'PromptMonitorAgent') as Registered;
  assert.deepEqual([a.enabled, a.status, a.runs.run_count, a.runs.activity_rows, a.runs.last_activity_at], [true, 'idle', 10, 2, '2026-10-27T11:59:00Z']);
  assert.equal(a.runs.attribution, 'this_agent');
  assert.deepEqual(a.schedule.live.map((l) => [l.timer, l.schedule, l.role]), [['PromptMonitorAgent', '*/1 * * * *', 'decides_the_run']]);
  assert.deepEqual(a.schedule.notes, []);
  assert.deepEqual(a.citations.map((c) => c.id), ['row-PromptMonitorAgent', 'a1', 'a2']);
  assert.match(a.statement, /registered and enabled \(status idle\)\. It has 10 recorded run\(s\)/);
});

test("a shared row's runs are pooled and say which timers share them", () => {
  const d = askRegistry(snap(), 'Dara') as Registered;
  assert.equal(d.runs.attribution, 'pooled');
  assert.match(d.runs.notes[0], /3 timers count against this one row/);
  assert.match(d.statement, /pooled across several timers/);
});

test('an inner-gate row with zero runs does not read as never having run', () => {
  const w = askRegistry(snap(), 'WorkforceCurriculumDirector') as Registered;
  assert.equal(w.runs.attribution, 'counted_under_another_row');
  assert.ok(w.facts.includes('no runs recorded on this row'));
  assert.ok(!w.facts.includes('no recorded runs'));
  assert.match(w.statement, /counts runs under an earlier row/);
});

test('a row no timer reads, and a declared schedule that is not what fires, are said', () => {
  const t = askRegistry(snap(), 'TicketManagementAgent') as Registered;
  assert.equal(t.runs.attribution, 'not_from_a_scheduled_timer');
  assert.match(t.schedule.notes[0], /no timer in aiOpsScheduler\.ts, schedulerService\.ts reads this row, so its declared schedule \*\/15 \* \* \* \* may never fire/);
  const s = snap();
  s.ai_agents[0] = row('PromptMonitorAgent', { schedule: '*/5 * * * *' });
  assert.match((askRegistry(s, 'PromptMonitorAgent') as Registered).schedule.notes[0], /declared schedule \*\/5 \* \* \* \* is not what fires: PromptMonitorAgent \*\/1 \* \* \* \*/);
});

test('a governance row that overrides or turns off a timer is shown', () => {
  const s = snap();
  s.cron_schedule_configs = [{ agent_name: 'PromptMonitorAgent', enabled: true, schedule: '*/10 * * * *' }];
  const a = askRegistry(s, 'PromptMonitorAgent') as Registered;
  assert.equal(a.schedule.live[0].schedule, '*/10 * * * *');
  assert.ok(a.schedule.notes.some((n) => /governance row overrides it to \*\/10/.test(n)));
  s.cron_schedule_configs = [{ agent_name: 'PromptMonitorAgent', enabled: false, schedule: null }];
  assert.ok((askRegistry(s, 'PromptMonitorAgent') as Registered).schedule.notes.some((n) => /turned off by its governance row/.test(n)));
});

test('activity rows alone mean it has run, even when run_count is 0', () => {
  const s = snap();
  s.ai_agents[0] = row('PromptMonitorAgent', { schedule: '*/1 * * * *', run_count: 0 });
  const a = askRegistry(s, 'PromptMonitorAgent') as Registered;
  assert.ok(!a.facts.includes('no recorded runs'));
});

test('two rows with one name give no single answer', () => {
  const s = snap();
  s.ai_agents.push(row('Dara', { id: 'row-Dara-2' }));
  const a = askRegistry(s, 'Dara');
  assert.equal(a.registration, 'ambiguous');
  assert.match(a.statement, /2 ai_agents rows/);
});

test('idempotent: the same records in any order give the same answers', () => {
  const s = snap();
  const reversed: RegistrySnapshot = { ...s, ai_agents: [...s.ai_agents].reverse(), ai_agent_activity_logs: [...s.ai_agent_activity_logs].reverse(), timers: [...s.timers].reverse() };
  for (const n of ['Dara', 'PromptMonitorAgent', 'AliPersonalOutreach', 'AdmissionsAssistant', 'TicketManagementAgent']) assert.deepEqual(askRegistry(s, n), askRegistry(reversed, n), n);
});
