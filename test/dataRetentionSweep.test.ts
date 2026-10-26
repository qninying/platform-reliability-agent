import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityLogRow, AiAgentRow } from '../src/records.ts';
import { retentionReport, type RetentionSnapshot, type SystemEventRow } from '../src/capabilities/dataRetentionSweep.ts';
import { SWEEPS } from '../src/retention/sweepCatalogue.ts';

// Rows are shaped as instrumentCronJob and the retention jobs write them; test inputs, not production data.
const NOW = new Date('2026-10-27T12:00:00Z');

function hoursAgo(h: number) {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function agent(name: string, over: Partial<AiAgentRow> = {}): AiAgentRow {
  return { id: `id-${name}`, agent_name: name, status: 'idle', enabled: true, schedule: '0 3 * * *', last_run_at: hoursAgo(9), updated_at: null, description: null, ...over };
}

function run(name: string, id: string, h = 9, result: ActivityLogRow['result'] = 'success'): ActivityLogRow {
  return { id, agent_id: `id-${name}`, action: 'cron_run', result, created_at: hoursAgo(h) };
}

function cycle(id: string, details: Record<string, unknown>, h = 9, type = 'RETENTION_CYCLE'): SystemEventRow {
  return { id, source: 'IntelligenceRetention', event_type: type, details, created_at: hoursAgo(h) };
}

function snap(over: Partial<RetentionSnapshot> = {}): RetentionSnapshot {
  return { captured_at: NOW.toISOString(), captured_by: 'test', ai_agents: [], ai_agent_activity_logs: [], ai_system_events: [], ...over };
}

function table(r: ReturnType<typeof retentionReport>, name: string) {
  return r.find((t) => t.table === name)!;
}

test("acceptance: a table whose window is not recorded anywhere returns 'unknown', never a guessed number of days", () => {
  // The code deletes chat_messages after 180 days, but nothing a person can read states it.
  const r = retentionReport(snap({ ai_agents: [agent('ChatMessageCleanup')], ai_agent_activity_logs: [run('ChatMessageCleanup', 'r1')] }), { now: NOW });
  const t = table(r, 'chat_messages');
  assert.equal(t.window.status, 'unknown');
  assert.equal(t.window.days, null);
  assert.equal(t.code_check.follows_stated_window, null);
  assert.doesNotMatch(JSON.stringify(t.window), /180/);
});

test('acceptance: with no records at all, every table in the catalogue is unknown, with no days', () => {
  const r = retentionReport(snap(), { now: NOW });
  assert.equal(r.length, SWEEPS.length);
  for (const t of r) {
    assert.equal(t.window.status, 'unknown', t.table);
    assert.equal(t.window.days, null, t.table);
  }
});

test('a window stated in the registry description is reported, with its citation', () => {
  const r = retentionReport(snap({ ai_agents: [agent('PageEventCleanup', { description: 'Data retention: deletes PageEvent records older than 90 days to manage database size.' })] }), { now: NOW });
  const t = table(r, 'page_events');
  assert.equal(t.window.status, 'stated');
  assert.equal(t.window.days, 90);
  assert.deepEqual(t.window.stated[0].citation, { table: 'ai_agents', id: 'id-PageEventCleanup', fields: ['description'] });
  assert.equal(t.code_check.follows_stated_window, true);
});

test('a stated window the code does not follow is flagged', () => {
  // AiNewsRefresh's description says 30 days; the code archives after an environment setting.
  const desc = 'prunes generated cards older than 30 days';
  const r = retentionReport(snap({ ai_agents: [agent('AiNewsRefresh', { description: desc })] }), { now: NOW });
  const t = table(r, 'timeline_cards');
  assert.equal(t.window.days, 30);
  assert.equal(t.code_check.follows_stated_window, null);
  const custom = retentionReport(snap({ ai_agents: [agent('PageEventCleanup', { description: 'older than 60 days' })] }), { now: NOW });
  assert.equal(table(custom, 'page_events').code_check.follows_stated_window, false);
});

test('the window in a run record counts as stated, and the deleted count comes from the same record', () => {
  const r = retentionReport(snap({
    ai_agents: [agent('IntelligenceRetentionCycle')],
    ai_agent_activity_logs: [run('IntelligenceRetentionCycle', 'r1')],
    ai_system_events: [cycle('ev1', { archived: 120, deleted: 118, retention_days: 30 })],
  }), { now: NOW });
  const t = table(r, 'intelligence_decisions');
  assert.equal(t.window.status, 'stated');
  assert.equal(t.window.days, 30);
  assert.equal(t.window.stated[0].source, 'run_record');
  assert.equal(t.rows_removed.count, 118);
});

test('stated windows that disagree are conflicting, with no days chosen', () => {
  const r = retentionReport(snap({
    ai_agents: [agent('PageEventCleanup', { description: 'older than 90 days' })],
    retention_policy: [{ id: 'p1', table: 'page_events', days: 60, approved_by: 'K.D.', approved_at: '2026-10-27' }],
  }), { now: NOW });
  const t = table(r, 'page_events');
  assert.equal(t.window.status, 'conflicting');
  assert.equal(t.window.days, null);
  assert.equal(t.window.stated.length, 2);
});

test('an approved policy entry states the window', () => {
  const r = retentionReport(snap({ retention_policy: [{ id: 'p1', table: 'chat_messages', days: 180, approved_by: 'K.D.', approved_at: '2026-10-27' }] }), { now: NOW });
  const t = table(r, 'chat_messages');
  assert.equal(t.window.days, 180);
  assert.equal(t.window.stated[0].source, 'approved_policy');
});

test('malformed stated values are ignored, not used as a window', () => {
  const r = retentionReport(snap({
    ai_agents: [agent('IntelligenceRetentionCycle', { description: 'older than 0 days' })],
    ai_system_events: [cycle('ev1', { retention_days: '30' })],
    retention_policy: [{ id: 'p1', table: 'intelligence_decisions', days: -5, approved_by: 'x', approved_at: 'x' }],
  }), { now: NOW });
  assert.equal(table(r, 'intelligence_decisions').window.status, 'unknown');
});

test('last sweep: untracked, disabled, never run, failed, overdue and swept', () => {
  const cases: Array<[Partial<RetentionSnapshot>, string]> = [
    [{}, 'untracked'],
    [{ ai_agents: [agent('PageEventCleanup', { enabled: false })] }, 'disabled'],
    [{ ai_agents: [agent('PageEventCleanup', { last_run_at: null })] }, 'never_run'],
    [{ ai_agents: [agent('PageEventCleanup')], ai_agent_activity_logs: [run('PageEventCleanup', 'r1', 9, 'failed')] }, 'failed'],
    [{ ai_agents: [agent('PageEventCleanup')], ai_agent_activity_logs: [run('PageEventCleanup', 'r1', 60)] }, 'overdue'],
    [{ ai_agents: [agent('PageEventCleanup')], ai_agent_activity_logs: [run('PageEventCleanup', 'r1', 9)] }, 'swept'],
  ];
  for (const [over, status] of cases) {
    assert.equal(table(retentionReport(snap(over), { now: NOW }), 'page_events').last_sweep.status, status);
  }
});

test('a retention cycle that failed inside the job is failed, though its run was recorded as a success', () => {
  const r = retentionReport(snap({
    ai_agents: [agent('IntelligenceRetentionCycle')],
    ai_agent_activity_logs: [run('IntelligenceRetentionCycle', 'r1', 9)],
    ai_system_events: [cycle('ev-ok', { deleted: 5, retention_days: 30 }, 33), cycle('ev-err', { error: 'boom' }, 9, 'RETENTION_ERROR')],
  }), { now: NOW });
  const t = table(r, 'intelligence_decisions');
  assert.equal(t.last_sweep.status, 'failed');
  assert.ok(t.citations.some((c) => c.id === 'ev-err'));
});

test("a job that keeps no count says so, rather than reporting 0 rows removed", () => {
  const t = table(retentionReport(snap({ ai_agents: [agent('PageEventCleanup')] }), { now: NOW }), 'page_events');
  assert.equal(t.rows_removed.count, null);
  assert.match(t.rows_removed.reason, /not recorded/);
});

test('the catalogue matches the platform: five sweeps, two unbounded deletes', () => {
  assert.deepEqual(SWEEPS.map((s) => [s.table, s.job, s.action]), [
    ['page_events', 'PageEventCleanup', 'delete'],
    ['chat_messages', 'ChatMessageCleanup', 'delete'],
    ['intelligence_decisions', 'IntelligenceRetentionCycle', 'archive_then_delete'],
    ['timeline_cards', 'AiNewsRefresh', 'archive'],
    ['proposed_agent_actions', 'ProposalCleanupService', 'expire'],
  ]);
  assert.deepEqual(SWEEPS.filter((s) => s.action === 'delete' && !s.batched).map((s) => s.table), ['page_events', 'chat_messages']);
});

test('idempotent: the same rows in any order give the same report', () => {
  const a = snap({
    ai_agents: [agent('IntelligenceRetentionCycle'), agent('PageEventCleanup')],
    ai_agent_activity_logs: [run('IntelligenceRetentionCycle', 'r1', 9), run('IntelligenceRetentionCycle', 'r2', 33), run('PageEventCleanup', 'r3', 9)],
    ai_system_events: [cycle('ev1', { deleted: 1, retention_days: 30 }, 9), cycle('ev2', { deleted: 2, retention_days: 30 }, 33)],
  });
  const b = { ...a, ai_agents: [...a.ai_agents].reverse(), ai_agent_activity_logs: [...a.ai_agent_activity_logs].reverse(), ai_system_events: [...a.ai_system_events].reverse() };
  assert.deepEqual(retentionReport(a, { now: NOW }), retentionReport(b, { now: NOW }));
});
