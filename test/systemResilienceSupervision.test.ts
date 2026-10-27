import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resiliencePosture, SUBSYSTEMS, type ResilienceAgentRow, type DepartmentReportRow, type ResilienceSnapshot } from '../src/capabilities/systemResilienceSupervision.ts';

// Rows are shaped as the platform's ai_agents, department_reports and the circuit-status export;
// test inputs, not production data.
const NOW = '2026-10-27T12:00:00Z';
const ago = (min: number) => new Date(Date.parse(NOW) - min * 60000).toISOString();

const SUPERVISORS = SUBSYSTEMS.filter((s) => s.kind === 'supervisor').map((s) => s.name);
function report(agent: string, over: Partial<DepartmentReportRow> = {}, metrics: Record<string, unknown> = {}): DepartmentReportRow {
  return { id: `r-${agent}`, department: agent, source_agent: agent, created_at: ago(10), metrics: { health: 'healthy', collection_ok: true, total: 3, ...metrics }, ...over };
}
function agent(name: string, over: Partial<ResilienceAgentRow> = {}): ResilienceAgentRow {
  return { id: `a-${name}`, agent_name: name, enabled: true, status: 'idle', last_run_at: ago(1), run_count: 100, error_count: 0, ...over };
}
function healthy(): ResilienceSnapshot {
  return {
    captured_at: NOW, captured_by: 'test',
    ai_agents: [agent('PromptMonitorAgent'), agent('OrchestrationHealthAgent'), agent('OrchestrationAutoRepairAgent'), agent('Dara', { last_run_at: ago(60) })],
    department_reports: SUPERVISORS.map((s) => report(s)),
    circuit_status: { captured_at: ago(5), statuses: [{ platform: 'reddit', state: 'CLOSED', error_count: 0, total_count: 12 }] },
  };
}
const run = (s: ResilienceSnapshot) => resiliencePosture(s, { now: NOW });
const sub = (s: ResilienceSnapshot, name: string) => run(s).subsystems.find((x) => x.subsystem === name)!;

test('acceptance: a subsystem with no signal is reported as unknown and prevents a healthy overall verdict', () => {
  for (const spec of SUBSYSTEMS) {
    const s = healthy();
    s.department_reports = s.department_reports.filter((r) => r.source_agent !== spec.name);
    s.ai_agents = s.ai_agents.filter((a) => a.agent_name !== spec.name);
    if (spec.kind === 'circuit_breakers') s.circuit_status = null;
    const r = run(s);
    const x = r.subsystems.find((y) => y.subsystem === spec.name)!;
    assert.equal(x.state, 'unknown', spec.name);
    assert.equal(x.last_signal_at, null, spec.name);
    assert.notEqual(r.verdict, 'healthy', spec.name);
    assert.ok(r.unknown.includes(spec.name), spec.name);
  }
});

test('every subsystem healthy gives a healthy verdict, and each answer gives its signal age', () => {
  const s = healthy();
  const r = run(s);
  assert.equal(r.verdict, 'healthy');
  assert.deepEqual(r.counts, { healthy: SUBSYSTEMS.length, degraded: 0, unknown: 0 });
  assert.equal(sub(s, 'CampaignOpsSuperAgent').signal_age_minutes, 10);
  assert.equal(sub(s, 'PromptMonitorAgent').signal_age_minutes, 1);
});

test('staleness is measured against each signal\'s own schedule, not one hour for all', () => {
  const s = healthy();
  s.ai_agents = [agent('PromptMonitorAgent', { last_run_at: ago(3) }), agent('OrchestrationHealthAgent', { last_run_at: ago(9) }), agent('OrchestrationAutoRepairAgent', { last_run_at: ago(11) }), agent('Dara', { last_run_at: ago(2881) })];
  assert.equal(sub(s, 'PromptMonitorAgent').state, 'unknown');
  assert.match(sub(s, 'PromptMonitorAgent').reason, /3 minutes old; it is expected every 1 minutes/);
  assert.equal(sub(s, 'OrchestrationHealthAgent').state, 'healthy');
  assert.equal(sub(s, 'OrchestrationAutoRepairAgent').state, 'unknown');
  assert.equal(sub(s, 'Dara').state, 'unknown');
  s.department_reports[0].created_at = ago(61);
  assert.equal(sub(s, SUPERVISORS[0]).state, 'unknown');
});

test('a supervisor that could not read, supervises nothing, or gives no recognised health is unknown', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ collection_ok: false }, /could not read/],
    [{ collection_ok: undefined }, /did not say/],
    [{ total: 0 }, /0 agents/],
    [{ health: 'unknown' }, /health 'unknown'/],
    [{ health: undefined }, /health 'none'/],
    [{ health: 'fine' }, /health 'fine'/],
  ];
  for (const [metrics, reason] of cases) {
    const s = healthy();
    s.department_reports[0] = report(SUPERVISORS[0], {}, metrics);
    const x = sub(s, SUPERVISORS[0]);
    assert.equal(x.state, 'unknown', JSON.stringify(metrics));
    assert.match(x.reason, reason);
  }
});

test('a known problem is degraded; with a blind spot as well, the verdict is unknown and both are listed', () => {
  const s = healthy();
  s.department_reports[0] = report(SUPERVISORS[0], {}, { health: 'degraded' });
  const r = run(s);
  assert.equal(r.verdict, 'degraded');
  assert.deepEqual(r.degraded, [SUPERVISORS[0]]);
  s.circuit_status = null;
  const both = run(s);
  assert.equal(both.verdict, 'unknown');
  assert.deepEqual(both.degraded, [SUPERVISORS[0]]);
  assert.deepEqual(both.unknown, ['openclaw_circuit_breakers']);
  assert.match(both.reason, /1 also report a problem/);
});

test('timer rows: off, error, paused and every-run-failed are degraded; unknown status and never-ran are unknown', () => {
  const cases: Array<[Partial<ResilienceAgentRow>, string]> = [
    [{ enabled: false }, 'degraded'], [{ status: 'error', last_error: 'boom' }, 'degraded'], [{ status: 'paused' }, 'degraded'],
    [{ error_count: 100 }, 'degraded'], [{ status: 'crashed' }, 'unknown'], [{ run_count: 0 }, 'unknown'], [{ last_run_at: null }, 'unknown'],
  ];
  for (const [over, state] of cases) {
    const s = healthy();
    s.ai_agents[1] = agent('OrchestrationHealthAgent', over);
    assert.equal(sub(s, 'OrchestrationHealthAgent').state, state, JSON.stringify(over));
  }
});

test('three timers on one row: attribution is unavailable, and a recent run claims only that one of them ran', () => {
  const s = healthy();
  const d = sub(s, 'Dara');
  assert.equal(d.state, 'healthy');
  assert.equal(d.attribution, 'unavailable');
  assert.match(d.reason, /at least one of the 3 timers/);
  assert.match(d.notes[0], /3 timers write to this one row/);
  s.ai_agents[3] = agent('Dara', { status: 'error' });
  assert.equal(sub(s, 'Dara').state, 'degraded');
  assert.equal(sub(s, 'Dara').attribution, 'unavailable');
  assert.equal(sub(s, 'PromptMonitorAgent').attribution, 'available');
});

test('circuit breakers: no export, a stale export or only thin CLOSED breakers are unknown; OPEN is degraded', () => {
  const s = healthy();
  s.circuit_status = { captured_at: ago(5), statuses: [{ platform: 'devto', state: 'CLOSED', error_count: 0, total_count: 2 }] };
  assert.equal(sub(s, 'openclaw_circuit_breakers').state, 'unknown');
  s.circuit_status.statuses.push({ platform: 'reddit', state: 'CLOSED', error_count: 1, total_count: 9 });
  const ok = sub(s, 'openclaw_circuit_breakers');
  assert.equal(ok.state, 'healthy');
  assert.match(ok.notes[0], /not evidence: devto/);
  s.circuit_status.statuses.push({ platform: 'quora', state: 'HALF_OPEN', error_count: 3, total_count: 5 });
  assert.equal(sub(s, 'openclaw_circuit_breakers').state, 'degraded');
  s.circuit_status.statuses.push({ platform: 'x', state: 'BROKEN', error_count: 0, total_count: 9 });
  assert.equal(sub(s, 'openclaw_circuit_breakers').state, 'unknown');
  s.circuit_status = { captured_at: ago(90), statuses: [{ platform: 'reddit', state: 'CLOSED', error_count: 0, total_count: 9 }] };
  assert.equal(sub(s, 'openclaw_circuit_breakers').state, 'unknown');
});

test('a signal time that is unreadable or in the future is no signal', () => {
  const s = healthy();
  s.department_reports[0].created_at = 'yesterday';
  s.department_reports[1].created_at = new Date(Date.parse(NOW) + 60 * 60000).toISOString();
  assert.match(sub(s, SUPERVISORS[0]).reason, /not readable/);
  assert.equal(sub(s, SUPERVISORS[0]).signal_age_minutes, null);
  assert.match(sub(s, SUPERVISORS[1]).reason, /in the future/);
  assert.throws(() => resiliencePosture(s, { now: 'soon' }), RangeError);
});

test("the platform supervisor's own verdict is shown, and flagged when it says healthy and Ellis does not", () => {
  const s = healthy();
  s.circuit_status = null;
  const r = run(s);
  assert.equal(r.platform_supervisor.health, 'healthy');
  assert.equal(r.platform_supervisor.disagrees, true);
  assert.equal(run(healthy()).platform_supervisor.disagrees, false);
});

test('the latest report wins and every answer cites the row it came from', () => {
  const s = healthy();
  s.department_reports.push(report(SUPERVISORS[0], { id: 'r-old', created_at: ago(40) }, { health: 'degraded' }));
  const x = sub(s, SUPERVISORS[0]);
  assert.equal(x.state, 'healthy');
  assert.deepEqual(x.citations.map((c) => `${c.table}:${c.id}`), [`department_reports:r-${SUPERVISORS[0]}`]);
  assert.deepEqual(sub(s, 'PromptMonitorAgent').citations.map((c) => c.table), ['ai_agents']);
});

test('idempotent: the same rows in any order give the same report', () => {
  const s = healthy();
  s.department_reports.push(report(SUPERVISORS[2], { id: 'r-z', created_at: ago(10) }, { health: 'degraded' }));
  s.ai_agents[3] = agent('Dara', { status: 'error' });
  const reversed = { ...s, ai_agents: [...s.ai_agents].reverse(), department_reports: [...s.department_reports].reverse() };
  assert.deepEqual(run(s), run(reversed));
});
