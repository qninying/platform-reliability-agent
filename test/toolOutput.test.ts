import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActivityLogRow, AiAgentRow } from '../src/records.ts';
import { snapshotSource } from '../src/readSource.ts';
import { watchOrchestrationHealth } from '../src/capabilities/orchestrationHealthWatch.ts';
import { cronHealth, type HealthSnapshot } from '../src/capabilities/cronHealthAlerting.ts';
import { agentHealth, type ScoreRow } from '../src/capabilities/agentHealthScoring.ts';
import { trace, type TraceSnapshot } from '../src/capabilities/incidentTrace.ts';
import { envelope, applySeverity, loadSeverityTable, ContractViolation, type SeverityTable, type ToolOutput } from '../src/output/toolOutput.ts';
import { orchestrationOutput, cronHealthOutput, agentHealthOutput, incidentTraceOutput, resilienceOutput, healthProbeOutput } from '../src/output/monitorAdapters.ts';
import { resiliencePosture, type ResilienceSnapshot } from '../src/capabilities/systemResilienceSupervision.ts';
import { probeHealth, ALWAYS_REPORTED } from '../src/capabilities/platformHealthProbe.ts';

// Rows are test inputs shaped like the platform's, not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const CAPTURE = { captured_at: '2026-10-26T15:00:00Z', captured_by: 'test' };
const NOW = new Date(CAPTURE.captured_at);
const ev = [{ table: 'ai_agents', id: 'row-1', fields: ['id'] }];
const base = { tool: 't', as_of: { ...CAPTURE, note: null }, case: 'c', platform_signal: null, evidence: ev, blind_spots: [], detail: { raw: 1 } };

// Every output, from every adapter, keeps the contract the envelope promises.
function holdsContract<D>(o: ToolOutput<D>, detail: D) {
  assert.ok(['problem', 'ok', 'unknown', 'partly_unknown'].includes(o.verdict));
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no row`);
  if (o.verdict === 'partly_unknown') assert.ok(o.blind_spots.length > 0);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned', 'no rules yet, so nothing may set a severity');
  assert.ok(o.severity_rule.length > 0);
  assert.equal(o.detail, detail, 'the tool answer travels unchanged');
}

test('the committed severity table is K.D.\'s, has no rules yet, and loads', () => {
  const t = loadSeverityTable();
  assert.equal(t.owner, 'K.D.');
  assert.deepEqual(t.rules, []);
  assert.match(applySeverity(t, 'x', 'problem', 'y').severity_rule, /no rules yet .*ISS-032/);
});

test('a problem or an ok with no row id is refused before it leaves the tool', () => {
  for (const verdict of ['problem', 'ok'] as const) {
    assert.throws(() => envelope({ ...base, verdict, evidence: [] }, EMPTY), ContractViolation);
  }
  // Unknown is allowed to cite nothing: that is what unknown means.
  assert.equal(envelope({ ...base, verdict: 'unknown', evidence: [] }, EMPTY).verdict, 'unknown');
});

test('partly_unknown must name what could not be seen, or it would read as ok', () => {
  assert.throws(() => envelope({ ...base, verdict: 'partly_unknown' }, EMPTY), ContractViolation);
  assert.equal(envelope({ ...base, verdict: 'partly_unknown', blind_spots: ['x not read'] }, EMPTY).verdict, 'partly_unknown');
});

test('severity comes only from a matching rule, and only for a problem', () => {
  const t: SeverityTable = { ...EMPTY, rules: [{ tool: 't', case: 'c', severity: 'High', why: 'test rule' }] };
  const hit = envelope({ ...base, verdict: 'problem' }, t);
  assert.equal(hit.severity, 'High');
  assert.match(hit.severity_rule, /t \/ c: test rule/);
  const miss = envelope({ ...base, verdict: 'problem', case: 'other' }, t);
  assert.equal(miss.severity, 'unassigned');
  assert.match(miss.severity_rule, /no rule for t \/ other/);
  // A rule can never put a severity on an ok.
  assert.equal(envelope({ ...base, verdict: 'ok' }, t).severity, 'unassigned');
});

test('a malformed severity table is refused, not half-read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sev-'));
  const bad = join(dir, 't.json');
  writeFileSync(bad, JSON.stringify({ owner: 'K.D.', status: 's', rules: [{ tool: 't', case: 'c', severity: 'Urgent', why: '' }] }));
  assert.throws(() => loadSeverityTable(bad), ContractViolation);
  writeFileSync(bad, JSON.stringify({ owner: 'K.D.' }));
  assert.throws(() => loadSeverityTable(bad), ContractViolation);
});

// Orchestration health watch.
const agent = (over: Partial<AiAgentRow> = {}): AiAgentRow => ({ id: 'agent-orch', agent_name: 'OrchestrationHealthAgent', status: 'idle', enabled: true, schedule: '*/5 * * * *', last_run_at: '2026-10-26T14:55:00Z', updated_at: '2026-10-26T14:55:00Z', ...over });
const run = (id: string, minutesAgo: number, action: string, result: ActivityLogRow['result'] = 'success'): ActivityLogRow => ({ id, agent_id: 'agent-orch', action, result, created_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() });
const watch = (agents: AiAgentRow[], logs: ActivityLogRow[]) => watchOrchestrationHealth(snapshotSource({ ...CAPTURE, ai_agents: agents, ai_agent_activity_logs: logs }), { now: NOW });

test('orchestration: healthy is ok, a failed run is a problem, a refusal is unknown, each with its rows', () => {
  const healthy = watch([agent()], [run('log-1', 5, 'scan_completed_no_issues')]);
  const ok = orchestrationOutput(healthy, CAPTURE, EMPTY);
  holdsContract(ok, healthy);
  assert.equal(ok.verdict, 'ok');
  assert.ok(ok.evidence.some((e) => e.id === 'log-1'));

  const failed = watch([agent()], [run('log-2', 5, 'scan_failed', 'failed')]);
  const p = orchestrationOutput(failed, CAPTURE, EMPTY);
  holdsContract(p, failed);
  assert.equal(p.verdict, 'problem');
  assert.ok(p.evidence.some((e) => e.id === 'log-2'));

  const refused = watch([], []);
  const u = orchestrationOutput(refused, CAPTURE, EMPTY);
  holdsContract(u, refused);
  assert.equal(u.verdict, 'unknown');
  assert.deepEqual(u.evidence, []);
  assert.ok(u.blind_spots.length > 0);
});

// Cron health alerting.
test('cron health: the example sweep has blind spots, so it is partly unknown and never ok', () => {
  const snap: HealthSnapshot = JSON.parse(readFileSync(new URL('../examples/cron-health.example.json', import.meta.url), 'utf8'));
  const a = cronHealth(snap);
  const o = cronHealthOutput(a, snap, EMPTY);
  holdsContract(o, a);
  assert.equal(a.answer, 'clear_with_blind_spots');
  assert.equal(o.verdict, 'partly_unknown');
  assert.equal(o.blind_spots.length, a.cannot_say.length + a.not_evaluated.length + a.partly_evaluated.length);
});

// Agent health scoring.
const score = (name: string, over: Partial<ScoreRow> = {}): ScoreRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', run_count: 10, error_count: 0, category: 'operations', ...over });
const scores = (rows: ScoreRow[]) => agentHealth({ ...CAPTURE, ai_agents: rows, timers: [], timer_scope: ['aiOpsScheduler.ts'] });

test('agent health: a red-band agent is a problem citing that agent, with the band as the platform signal', () => {
  const a = scores([score('Fine'), score('Failing', { error_count: 5 })]);
  const o = agentHealthOutput(a, CAPTURE, EMPTY);
  holdsContract(o, a);
  assert.equal(o.verdict, 'problem');
  assert.ok(o.evidence.some((e) => e.id === 'row-Failing'));
  assert.ok(!o.evidence.some((e) => e.id === 'row-Fine'), 'a problem cites the rows behind it, not the whole fleet');
  assert.match(o.platform_signal ?? '', /red band/);
});

test('agent health: a fleet that never ran is not ok, because a score of 100 on zero runs says nothing', () => {
  const a = scores([score('NeverFired', { run_count: 0 }), score('Fine')]);
  const o = agentHealthOutput(a, CAPTURE, EMPTY);
  holdsContract(o, a);
  assert.notEqual(o.verdict, 'ok');
  assert.ok(o.blind_spots.some((b) => b.startsWith('NeverFired')));
});

test('agent health: every agent scored and in the clear is ok, citing the scored rows', () => {
  const a = scores([score('A'), score('B')]);
  const o = agentHealthOutput(a, CAPTURE, EMPTY);
  holdsContract(o, a);
  assert.equal(o.verdict, a.cannot_say.length > 0 ? 'partly_unknown' : 'ok');
  assert.deepEqual(o.evidence.map((e) => e.id).filter((id) => id.startsWith('row-')).sort(), ['row-A', 'row-B']);
});

// Incident trace and error triage.
const traces = (): TraceSnapshot => JSON.parse(readFileSync(new URL('../examples/incident-trace.example.json', import.meta.url), 'utf8'));

test('incident trace: a traced failure is a problem citing its steps; an untracked job is unknown with no rows', () => {
  const s = traces();
  const a = trace(s, { trace_id: 't-admissions-1' });
  const o = incidentTraceOutput(a, s, EMPTY);
  holdsContract(o, a);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), a.steps.map((x) => x.id));

  const u = trace(s, { job: 'NeverHeardOf' });
  const uo = incidentTraceOutput(u, s, EMPTY);
  holdsContract(uo, u);
  assert.equal(uo.verdict, 'unknown');
  assert.deepEqual(uo.evidence, []);
  assert.equal(uo.blind_spots[0], u.statement);
});

test('incident trace: "no failure recorded" with no row to cite is unknown, not ok', () => {
  const s = traces();
  const a = { ...trace(s, { trace_id: 't-reese-1' }), verdict: 'no_failure_recorded' as const, steps: [], failures: [], error_record: null, row_ids: [] };
  const o = incidentTraceOutput(a, s, EMPTY);
  holdsContract(o, a);
  assert.equal(o.verdict, 'unknown');
});

test('the same answer always gives the same output', () => {
  const s = traces();
  const a = trace(s, { trace_id: 't-reese-1' });
  assert.deepEqual(incidentTraceOutput(a, s, EMPTY), incidentTraceOutput(a, s, EMPTY));
});

// System resilience supervision, and the health probes folded into it.
const RESILIENCE = (): ResilienceSnapshot => JSON.parse(readFileSync(new URL('../examples/resilience-posture.example.json', import.meta.url), 'utf8'));

test('resilience: the example has a degraded supervisor, so it is a problem citing only the degraded rows, with the unknown parts as blind spots', () => {
  const snap = RESILIENCE();
  const a = resiliencePosture(snap, { now: snap.captured_at });
  const o = resilienceOutput(a, snap, EMPTY);
  holdsContract(o, a);
  assert.ok(a.degraded.length > 0 && a.unknown.length > 0);
  assert.equal(o.verdict, 'problem');
  const degradedIds = new Set(a.subsystems.filter((x) => x.state === 'degraded').flatMap((x) => x.citations.map((c) => c.id)));
  for (const e of o.evidence) assert.ok(degradedIds.has(e.id), e.id);
  assert.equal(o.blind_spots.length, a.unknown.length);
});

test('resilience: with nothing degraded, some unknown parts make it partly unknown, and all unknown makes it unknown', () => {
  const snap = RESILIENCE();
  const a = resiliencePosture(snap, { now: snap.captured_at });
  const noProblem = { ...a, subsystems: a.subsystems.map((x) => (x.state === 'degraded' ? { ...x, state: 'healthy' as const } : x)) };
  assert.equal(resilienceOutput(noProblem, snap, EMPTY).verdict, 'partly_unknown');
  const allUnknown = { ...a, subsystems: a.subsystems.map((x) => ({ ...x, state: 'unknown' as const })) };
  const o = resilienceOutput(allUnknown, snap, EMPTY);
  holdsContract(o, allUnknown);
  assert.equal(o.verdict, 'unknown');
});

test('health probes: the export is the evidence, an ok report with dropped checks is partly unknown, and no export is unknown', () => {
  const at = '2026-10-27T15:05:00Z';
  const all = ALWAYS_REPORTED.map((name) => ({ name, severity: 'ok' as const, detail: 'fine', metric: 1 }));
  const full = probeHealth({ captured_at: at, captured_by: 't', report: { timestamp: at, overall_status: 'ok', duration_ms: 1, checks: all } }, '2026-10-27T15:10:00Z');
  const ok = healthProbeOutput(full, CAPTURE, EMPTY);
  holdsContract(ok, full);
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual(ok.evidence.map((e) => [e.table, e.id]), [['health_full_export', at]]);
  assert.ok(ok.blind_spots.some((b) => /never registered/.test(b)), 'what the probes cannot see travels with every answer');
  const dropped = probeHealth({ captured_at: at, captured_by: 't', report: { timestamp: at, overall_status: 'ok', duration_ms: 1, checks: all.slice(1) } }, '2026-10-27T15:10:00Z');
  assert.equal(healthProbeOutput(dropped, CAPTURE, EMPTY).verdict, 'partly_unknown');
  const none = probeHealth(null, '2026-10-27T15:10:00Z');
  const u = healthProbeOutput(none, CAPTURE, EMPTY);
  holdsContract(u, none);
  assert.equal(u.verdict, 'unknown');
  assert.deepEqual(u.evidence, []);
});
