import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { trace, UNTRACKED, type TraceSnapshot, type Query } from '../src/capabilities/incidentTrace.ts';

// The example uses real agent and timer names with hand-written records; it is test input, not production data.
const EXAMPLE = new URL('../examples/incident-trace.example.json', import.meta.url);
const load = (): TraceSnapshot => JSON.parse(readFileSync(EXAMPLE, 'utf8'));

test('acceptance: where no trace exists for a failure, the answer is "not traceable: this job is untracked", never a narrative', () => {
  const s = load();
  s.timers.push({ timer: 'WorkforceCurriculumDirector', schedule: '0 7 * * 1', label: 'Director', ref: 'backend/src/services/aiOpsScheduler.ts:370', gates: [{ gate: 'director_gate', flag: 'WorkforceCurriculumDirector' }] });
  s.ai_agents.push({ id: 'a-dir', agent_name: 'WorkforceCurriculumDirector' });
  // A failed row exists for the director and for the trackAgentRun agent, and must not be used to build a story.
  s.ai_agent_activity_logs.push({ id: 'log-dir', agent_id: 'a-dir', action: 'director_failed', result: 'failed', reason: 'should not be cited', trace_id: null, created_at: '2026-10-28T02:40:00Z' });
  for (const job of ['PaySimplePaymentSync', 'MetaAgentLoop', 'WorkforceCurriculumDirector', 'NeverHeardOf']) {
    const a = trace(s, { job });
    assert.equal(a.verdict, 'not_traceable', job);
    assert.ok(a.statement.startsWith(`${UNTRACKED}. `), `${job}: ${a.statement}`);
    assert.equal(a.probable_cause, null, job);
    assert.deepEqual(a.steps, [], job);
    assert.deepEqual(a.failures, [], job);
    assert.deepEqual(a.row_ids, [], job);
  }
  assert.equal(trace(s, { job: 'PaySimplePaymentSync' }).reason, 'no_row');
  assert.match(trace(s, { job: 'PaySimplePaymentSync' }).statement, /schedulerService\.ts:2175/);
  assert.equal(trace(s, { job: 'MetaAgentLoop' }).reason, 'wrapper_records_no_run');
  assert.match(trace(s, { job: 'NeverHeardOf' }).statement, /No timer in .* records under this name either/);
});

test('acceptance: no not-traceable answer cites a row it was not asked about, even one that looks related', () => {
  const s = load();
  s.ai_agent_activity_logs.push({ id: 'log-fail-untraced', agent_id: 'a-admissions', action: 'agent_execution_failed', result: 'failed', reason: 'boom', trace_id: null, created_at: '2026-10-28T02:50:00Z' });
  const queries: Query[] = [{ error_id: 'err-stalled' }, { error_id: 'err-old' }, { activity_id: 'log-2' }, { activity_id: 'log-fail-untraced' }, { trace_id: 't-intel-untracked' }, { job: 'CampaignHealthScanner' }, { job: 'AdmissionsAssistantAgent' }];
  for (const q of queries) {
    const a = trace(s, q);
    assert.equal(a.verdict, 'not_traceable', JSON.stringify(q));
    assert.equal(a.probable_cause, null, JSON.stringify(q));
  }
  // log-5 is the stalled-campaign detection that sits beside err-stalled in time; it is not a trace.
  const e = trace(s, { error_id: 'err-stalled' });
  assert.equal(e.row_ids.includes('log-5'), false);
  assert.deepEqual(e.row_ids, ['err-stalled']);
  assert.equal(e.reason, 'error_links_to_no_run');
});

test('a thrown failure is traced with its own words as the probable cause, and the AI calls the platform view leaves out', () => {
  const r = trace(load(), { trace_id: 't-reese-1' });
  assert.equal(r.verdict, 'traced');
  assert.deepEqual(r.steps.map((x) => `${x.table}:${x.id}`), ['ai_events:ev-1', 'ai_agent_activity_logs:log-3']);
  assert.deepEqual(r.probable_cause, { statement: 'the run failed: "Skool session expired" (row log-3)', supporting_rows: ['log-3'] });
  assert.ok(r.notes.some((n) => /1 AI call\(s\) share this trace; the platform's trace view leaves them out/.test(n)));
  assert.ok(r.notes.some((n) => /no error class is recorded/.test(n)));
  const j = trace(load(), { job: 'AdmissionsAssistantAgent' });
  assert.equal(j.verdict, 'traced');
  const newer = load();
  newer.ai_agent_activity_logs.push({ id: 'log-old', agent_id: 'a-admissions', action: 'agent_execution_failed', result: 'failed', reason: 'older', trace_id: 't-older', created_at: '2026-10-27T01:00:00Z' });
  assert.equal(trace(newer, { job: 'AdmissionsAssistantAgent' }).trace_id, 't-admissions-1', 'the newest failure is followed');
  assert.equal(j.failures[0].kind, 'thrown');
  assert.equal(j.row_ids.includes('log-2'), false, "the agent's own row without a trace is not in the trace");
});

test('a reported error is named as reported, and every failure in a trace is listed', () => {
  const s = load();
  s.ai_agent_activity_logs.push({ id: 'log-4b', agent_id: 'a-repair', action: 'agent_execution_failed', result: 'failed', reason: 'second failure', trace_id: 't-repair-1', created_at: '2026-10-28T02:20:05Z' });
  const r = trace(s, { job: 'CampaignRepairAgent' });
  assert.equal(r.verdict, 'traced');
  assert.equal(r.trace_id, 't-repair-1', 'the latest failure, log-4b, leads to its run');
  const t = trace(s, { trace_id: 't-repair-1' });
  assert.deepEqual(t.failures.map((f) => [f.row_id, f.kind]), [['log-4', 'reported'], ['log-4b', 'thrown']]);
  assert.match(t.probable_cause!.statement, /reported an error: "Failed to retry action 9a1: SMTP 421 rate limited" \(row log-4\); the run threw: "second failure" \(row log-4b\)/);
});

test('a trace with no failure says so; a job with a recording wrapper and no failure is not called untracked', () => {
  const s = load();
  s.ai_agent_activity_logs.push({ id: 'log-ok', agent_id: 'a-reese', action: 'ReesePresenceHeartbeat', result: 'success', reason: 'Completed in 900ms', trace_id: 't-ok', created_at: '2026-10-28T02:45:00Z' });
  const t = trace(s, { trace_id: 't-ok' });
  assert.equal(t.verdict, 'traced');
  assert.equal(t.probable_cause, null);
  assert.match(t.statement, /This trace records no failure/);
  s.ai_agent_activity_logs = s.ai_agent_activity_logs.filter((r) => r.agent_id !== 'a-reese');
  const j = trace(s, { job: 'ReesePresenceHeartbeat' });
  assert.equal(j.verdict, 'no_failure_recorded');
  assert.doesNotMatch(j.statement, /untracked/);
});

test('error records: how each was resolved is stated as a claim, and a linked run is followed when one exists', () => {
  const s = load();
  assert.match(trace(s, { error_id: 'err-old' }).error_record!.resolved, /marked resolved by CampaignRepairAgent because it was over 7 days old, not because the cause was fixed/);
  assert.equal(trace(s, { error_id: 'err-stalled' }).error_record!.resolved, 'unresolved');
  s.campaign_errors.push({ id: 'err-admin', campaign_id: 'c', component: 'email', severity: 'error', error_message: 'x', resolved: true, resolved_by: 'admin', repair_attempt_id: 'log-3', created_at: '2026-10-28T02:15:01Z' });
  const a = trace(s, { error_id: 'err-admin' });
  assert.equal(a.verdict, 'traced');
  assert.match(a.error_record!.resolved, /a claim, not evidence/);
  assert.ok(a.row_ids.includes('err-admin') && a.row_ids.includes('log-3'));
  // A link to a row with no trace id is not a trace: it must not pull in every untraced row.
  s.campaign_errors.push({ id: 'err-link-untraced', campaign_id: 'c', component: 'email', severity: 'error', error_message: 'y', resolved: false, resolved_by: null, repair_attempt_id: 'log-2', created_at: '2026-10-28T02:10:03Z' });
  const u = trace(s, { error_id: 'err-link-untraced' });
  assert.equal(u.verdict, 'not_traceable');
  assert.match(u.statement, /set to a row with no trace id/);
  assert.deepEqual(u.row_ids, ['err-link-untraced']);
});

test('an activity row with no trace id, AI calls with no run, and ids that match nothing are each answered for what they are', () => {
  const s = load();
  const row = trace(s, { activity_id: 'log-2' });
  assert.equal(row.reason, 'row_has_no_trace');
  assert.match(row.statement, /An agent's own rows get none/);
  const ev = trace(s, { trace_id: 't-intel-untracked' });
  assert.equal(ev.reason, 'events_without_run');
  assert.match(ev.statement, /Either a job with no ai_agents row made them .* or a web request did/);
  for (const q of [{ trace_id: 'nope' }, { activity_id: 'nope' }, { error_id: 'nope' }] as Query[]) assert.equal(trace(s, q).verdict, 'not_found');
  const scanner = trace(s, { job: 'CampaignHealthScanner' });
  assert.match(scanner.statement, /^Not traceable: CampaignHealthScanner's failures leave no activity row\./);
  assert.match(scanner.statement, /aiOrchestrator\.ts:168-172/);
});

test('the same export gives the same answer twice, whatever order the rows are in, and is not changed by reading it', () => {
  const s = load();
  const before = JSON.stringify(s);
  const q: Query = { job: 'CampaignRepairAgent' };
  assert.deepEqual(trace(s, q), trace(s, q));
  assert.deepEqual(trace({ ...s, ai_agent_activity_logs: [...s.ai_agent_activity_logs].reverse(), ai_events: [...s.ai_events].reverse() }, { trace_id: 't-reese-1' }), trace(s, { trace_id: 't-reese-1' }));
  assert.equal(JSON.stringify(s), before);
});

test('CLI: exit 0 traced, 3 not traceable, 4 nothing found, 1 for a missing table or an ambiguous question', () => {
  const run = (args: string[], file = EXAMPLE.pathname) => spawnSync(process.execPath, ['src/cli/incidentTrace.ts', '--snapshot', file, ...args], { encoding: 'utf8' });
  assert.equal(run(['--trace', 't-reese-1']).status, 0);
  const u = run(['--job', 'PaySimplePaymentSync']);
  assert.equal(u.status, 3);
  assert.match(JSON.parse(u.stdout).statement, /^Not traceable: this job is untracked\./);
  assert.equal(run(['--error', 'nope']).status, 4);
  assert.equal(run(['--trace', 'a', '--job', 'b']).status, 1);
  const dir = mkdtempSync(join(tmpdir(), 'ellis-trace-'));
  const bad = join(dir, 'bad.json');
  const s = load() as Partial<TraceSnapshot>;
  delete s.ai_events;
  writeFileSync(bad, JSON.stringify(s));
  const r = run(['--trace', 'x'], bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a missing table is not an empty one/);
});
