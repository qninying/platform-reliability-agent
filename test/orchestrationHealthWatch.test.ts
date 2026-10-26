import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityLogRow, AiAgentRow } from '../src/records.ts';
import { snapshotSource, type Snapshot } from '../src/readSource.ts';
import { watchOrchestrationHealth, type HealthAnswer } from '../src/capabilities/orchestrationHealthWatch.ts';

// Rows are shaped as the platform writes them for OrchestrationHealthAgent (schedule from
// aiOpsScheduler.ts:192, action and result text from aiOrchestrator.ts:231-238). These are test
// inputs, not production data.
const NOW = new Date('2026-10-26T15:00:00Z');
const AGENT_ID = 'agent-orch';

function agent(over: Partial<AiAgentRow> = {}): AiAgentRow {
  return { id: AGENT_ID, agent_name: 'OrchestrationHealthAgent', status: 'idle', enabled: true, schedule: '*/5 * * * *', last_run_at: '2026-10-26T14:55:00Z', updated_at: '2026-10-26T14:55:00Z', ...over };
}

function run(id: string, minutesAgo: number, action: string, result: ActivityLogRow['result'] = 'success', agentId = AGENT_ID): ActivityLogRow {
  return { id, agent_id: agentId, action, result, created_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() };
}

function watch(agents: AiAgentRow[], logs: ActivityLogRow[], agentName?: string) {
  const snap: Snapshot = { captured_at: NOW.toISOString(), captured_by: 'test', ai_agents: agents, ai_agent_activity_logs: logs };
  return watchOrchestrationHealth(snapshotSource(snap), { now: NOW, agentName });
}

function asAnswer(r: ReturnType<typeof watch>): HealthAnswer {
  assert.equal(r.kind, 'answer', `expected an answer, got: ${JSON.stringify(r)}`);
  return r as HealthAnswer;
}

function citedIds(a: HealthAnswer, table: string) {
  return a.citations.filter((c) => c.table === table).map((c) => c.id);
}

test('healthy run: answer cites the ai_agents row and the activity row it came from', () => {
  const a = asAnswer(watch([agent()], [run('log-1', 5, 'scan_completed_no_issues'), run('log-0', 10, '1 action(s): finding_info')]));
  assert.equal(a.verdict, 'healthy');
  assert.deepEqual(citedIds(a, 'ai_agents'), [AGENT_ID]);
  assert.ok(citedIds(a, 'ai_agent_activity_logs').includes('log-1'));
});

test('every answer cites the ai_agents row and only activity rows that belong to it', () => {
  const logs = [run('mine', 4, '2 action(s): finding_warning, finding_info'), run('other', 1, 'agent_execution_failed', 'failed', 'agent-someone-else')];
  const a = asAnswer(watch([agent()], logs));
  assert.equal(a.verdict, 'degraded');
  assert.deepEqual(citedIds(a, 'ai_agents'), [AGENT_ID]);
  assert.deepEqual(citedIds(a, 'ai_agent_activity_logs'), ['mine']);
});

test('no ai_agents row: refusal, no verdict, nothing cited', () => {
  const r = watch([], [run('orphan', 5, 'scan_completed_no_issues', 'success', 'unknown-id')]);
  assert.equal(r.kind, 'refusal');
  assert.equal('verdict' in r, false);
  assert.deepEqual(r.citations, []);
});

test('a name with no row is refused even when other agents have rows', () => {
  const r = watch([agent()], [run('log-1', 5, 'scan_completed_no_issues')], 'WorkforceIntelligence');
  assert.equal(r.kind, 'refusal');
});

test('two rows with the same agent_name: refusal, because the records contradict the unique key', () => {
  const r = watch([agent(), agent({ id: 'agent-dup' })], []);
  assert.equal(r.kind, 'refusal');
  assert.match(r.reason, /unique/);
});

test("failure path: result 'failed' with action 'scan_completed_no_issues' is run_failed, not healthy", () => {
  // aiOrchestrator.ts:233 writes this action text whenever no actions were taken, even when the
  // agent's own catch put an error in errors[] (orchestrationHealthAgent.ts:114).
  const a = asAnswer(watch([agent({ status: 'idle' })], [run('log-f', 5, 'scan_completed_no_issues', 'failed')]));
  assert.equal(a.verdict, 'run_failed');
  assert.ok(citedIds(a, 'ai_agent_activity_logs').includes('log-f'));
});

test('critical finding wins over warning, as in healthReportService.ts:155-157', () => {
  const a = asAnswer(watch([agent()], [run('log-c', 5, '3 action(s): finding_warning, finding_critical, finding_info')]));
  assert.equal(a.verdict, 'critical');
});

test('stalled: newest row older than three intervals of the schedule', () => {
  const a = asAnswer(watch([agent()], [run('log-old', 40, 'scan_completed_no_issues')]));
  assert.equal(a.verdict, 'stalled');
  assert.ok(citedIds(a, 'ai_agent_activity_logs').includes('log-old'));
});

test('disabled row: not_running, and the answer says skips write no activity row', () => {
  const a = asAnswer(watch([agent({ enabled: false })], [run('log-1', 300, 'scan_completed_no_issues')]));
  assert.equal(a.verdict, 'not_running');
  assert.match(a.reason, /write no activity row/);
});

test('paused row: not_running', () => {
  assert.equal(asAnswer(watch([agent({ status: 'paused' })], [])).verdict, 'not_running');
});

test('row exists but no activity: unknown, never healthy', () => {
  const a = asAnswer(watch([agent()], []));
  assert.equal(a.verdict, 'unknown');
  assert.deepEqual(citedIds(a, 'ai_agents'), [AGENT_ID]);
});

test('last change: reports when the verdict changed and cites the rows on both sides', () => {
  const logs = [
    run('log-3', 5, '1 action(s): finding_warning'),
    run('log-2', 10, '1 action(s): finding_warning'),
    run('log-1', 15, 'scan_completed_no_issues'),
  ];
  const a = asAnswer(watch([agent()], logs));
  assert.equal(a.verdict, 'degraded');
  assert.equal(a.last_change.from, 'healthy');
  assert.equal(a.last_change.at, logs[1].created_at);
  assert.deepEqual(citedIds(a, 'ai_agent_activity_logs'), ['log-3', 'log-2', 'log-1']);
});

test('no change within the rows read: says so instead of claiming a date', () => {
  const a = asAnswer(watch([agent()], [run('log-2', 5, 'scan_completed_no_issues'), run('log-1', 10, 'scan_completed_no_issues')]));
  assert.equal(a.last_change.at, null);
  assert.match(a.last_change.note, /outside the rows read/);
});

test('idempotent: the same input gives the same answer, whatever order the rows arrive in', () => {
  const logs = [run('b', 5, 'scan_completed_no_issues'), run('a', 5, '1 action(s): finding_warning'), run('c', 10, 'scan_completed_no_issues')];
  const first = watch([agent()], logs);
  const second = watch([agent()], [...logs].reverse());
  assert.deepEqual(first, second);
});
