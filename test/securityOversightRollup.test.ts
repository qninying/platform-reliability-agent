import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityLogRow, AiAgentRow, DepartmentEventRow } from '../src/records.ts';
import { snapshotSource, type Snapshot } from '../src/readSource.ts';
import { CONTRIBUTORS, securityRollup } from '../src/capabilities/securityOversightRollup.ts';

// Rows are shaped as the platform's security timers and runAgent write them; test inputs, not production data.
const NOW = new Date('2026-10-26T12:00:00Z');
const SCAN_AFTER: Record<string, [string, Record<string, unknown>]> = {
  SecretDetectionAgent: ['secret_scan', { files_scanned: 120, findings_count: 0 }],
  CodeSecurityAuditAgent: ['code_security_audit', { files_scanned: 300, findings_count: 0 }],
  DependencySecurityAgent: ['dependency_audit', { projects_audited: 2, total_vulns: 0 }],
};

function iso(minutesAgo: number) {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

function agent(name: string, over: Partial<AiAgentRow> = {}): AiAgentRow {
  return { id: `id-${name}`, agent_name: name, status: 'idle', enabled: true, schedule: null, last_run_at: iso(1), updated_at: null, ...over };
}

function run(name: string, id: string, over: Partial<ActivityLogRow> = {}): ActivityLogRow {
  const scan = SCAN_AFTER[name];
  const actions = scan ? [{ action: scan[0], after_state: scan[1] }] : [];
  return { id, agent_id: `id-${name}`, action: 'run', result: 'success', created_at: iso(1), details: { actions }, ...over };
}

function event(name: string, id: string, over: Partial<DepartmentEventRow> = {}): DepartmentEventRow {
  return { id, department_id: 'dept', event_type: 'security_scan', title: 't', severity: 'normal', created_at: iso(1), metadata: { agent: name }, ...over };
}

// Every contributor ran a minute ago and reported clean.
function allClean(): Snapshot {
  const names = CONTRIBUTORS.map((c) => c.agentName);
  return {
    captured_at: NOW.toISOString(),
    captured_by: 'test',
    ai_agents: names.map((n) => agent(n)),
    ai_agent_activity_logs: names.map((n) => run(n, `run-${n}`)),
    department_events: [],
  };
}

function rollup(s: Snapshot) {
  return securityRollup(snapshotSource(s), { now: NOW });
}

function byName(r: ReturnType<typeof rollup>, name: string) {
  return r.contributions.find((c) => c.agent_name === name)!;
}

test('acceptance: a scanner with no last_run_at renders as unknown, and the rollup is not green', () => {
  const s = allClean();
  s.ai_agents = s.ai_agents.map((a) => (a.agent_name === 'RuntimeThreatMonitorAgent' ? { ...a, last_run_at: null } : a));
  const r = rollup(s);
  assert.equal(byName(r, 'RuntimeThreatMonitorAgent').contribution, 'unknown');
  assert.match(byName(r, 'RuntimeThreatMonitorAgent').reason, /no last_run_at/);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.escalate, true);
});

test('acceptance: the rollup is never green while any contribution is unknown, for each contributor in turn', () => {
  for (const { agentName } of CONTRIBUTORS) {
    const s = allClean();
    s.ai_agents = s.ai_agents.map((a) => (a.agent_name === agentName ? { ...a, last_run_at: null } : a));
    const r = rollup(s);
    assert.notEqual(r.verdict, 'green', `${agentName} silent must not leave the rollup green`);
    assert.equal(r.counts.unknown, 1);
  }
});

test('green only when every one of the seven contributors ran in its interval and is clean', () => {
  const r = rollup(allClean());
  assert.equal(r.contributions.length, 7);
  assert.deepEqual(r.counts, { clean: 7, dirty: 0, unknown: 0 });
  assert.equal(r.verdict, 'green');
  assert.equal(r.escalate, false);
});

test('a timer with no ai_agents row contributes unknown, structurally', () => {
  const s = allClean();
  s.ai_agents = s.ai_agents.filter((a) => a.agent_name !== 'AISafetyMonitorAgent');
  const c = byName(rollup(s), 'AISafetyMonitorAgent');
  assert.equal(c.contribution, 'unknown');
  assert.match(c.reason, /no ai_agents row/);
});

test('disabled, paused, errored and overdue scanners are unknown, not clean', () => {
  const cases: Array<[Partial<AiAgentRow>, RegExp]> = [
    [{ enabled: false }, /disabled/],
    [{ status: 'paused' }, /paused/],
    [{ status: 'error' }, /error/],
    [{ last_run_at: iso(25) }, /missed its interval/],
  ];
  for (const [over, why] of cases) {
    const s = allClean();
    s.ai_agents = s.ai_agents.map((a) => (a.agent_name === 'AgentBehaviorMonitorAgent' ? { ...a, ...over } : a));
    const c = byName(rollup(s), 'AgentBehaviorMonitorAgent');
    assert.equal(c.contribution, 'unknown', JSON.stringify(over));
    assert.match(c.reason, why);
  }
});

test('a run that logged success but carried errors is unknown, not clean', () => {
  const s = allClean();
  s.ai_agent_activity_logs = s.ai_agent_activity_logs.map((r) => (r.agent_id === 'id-AccessControlGuardianAgent' ? { ...r, details: { actions: [], errors: ['Security department not found'] } } : r));
  const c = byName(rollup(s), 'AccessControlGuardianAgent');
  assert.equal(c.contribution, 'unknown');
  assert.match(c.reason, /reported errors/);
});

test('a threat event since the last expected run makes that scanner dirty and the rollup red, with a citation', () => {
  const s = allClean();
  s.department_events = [event('RuntimeThreatMonitorAgent', 'ev-1', { event_type: 'threat_detected', severity: 'high' })];
  const r = rollup(s);
  const c = byName(r, 'RuntimeThreatMonitorAgent');
  assert.equal(c.contribution, 'dirty');
  assert.ok(c.citations.some((x) => x.id === 'ev-1'));
  assert.equal(r.verdict, 'red');
});

test('red with unknowns still says how many could not be checked', () => {
  const s = allClean();
  s.department_events = [event('AgentBehaviorMonitorAgent', 'ev-1', { event_type: 'security_alert', severity: 'critical' })];
  s.ai_agents = s.ai_agents.map((a) => (a.agent_name === 'SecretDetectionAgent' ? { ...a, last_run_at: null } : a));
  const r = rollup(s);
  assert.equal(r.verdict, 'red');
  assert.match(r.reason, /1 more could not be checked/);
  assert.equal(r.escalate, true);
});

test('an old threat outside the interval does not make a scanner dirty', () => {
  const s = allClean();
  s.department_events = [event('RuntimeThreatMonitorAgent', 'ev-old', { event_type: 'threat_detected', severity: 'critical', created_at: iso(60) })];
  assert.equal(byName(rollup(s), 'RuntimeThreatMonitorAgent').contribution, 'clean');
});

test('a scan of 0 files is unknown through security_posture_scan, so the rollup is not green', () => {
  const s = allClean();
  s.ai_agent_activity_logs = s.ai_agent_activity_logs.map((r) => (r.agent_id === 'id-SecretDetectionAgent' ? { ...r, details: { actions: [{ action: 'secret_scan', after_state: { files_scanned: 0, findings_count: 0 } }] } } : r));
  const r = rollup(s);
  assert.equal(byName(r, 'SecretDetectionAgent').contribution, 'unknown');
  assert.equal(r.verdict, 'unknown');
});

test('a rollup over no scanners is unknown, never green', () => {
  const r = securityRollup(snapshotSource(allClean()), { now: NOW, contributors: [] });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.escalate, true);
});

test("the platform director's 'normal' is flagged when Ellis cannot vouch for the platform", () => {
  const s = allClean();
  s.ai_agents = s.ai_agents.map((a) => (a.agent_name === 'CodeSecurityAuditAgent' ? { ...a, last_run_at: null } : a));
  s.department_events = [event('SecurityDirectorAgent', 'dir-1', { severity: 'normal' })];
  const r = rollup(s);
  assert.deepEqual(r.platform_director, { verdict: 'normal', at: iso(1), disagrees: true, citation: { table: 'department_events', id: 'dir-1', fields: ['event_type', 'severity', 'created_at'] } });
});

test('the contributors are the director\'s seven subordinates in scheduler order (aiOpsScheduler.ts:329-335)', () => {
  assert.deepEqual(CONTRIBUTORS.map((c) => [c.agentName, c.intervalMinutes]), [
    ['SecretDetectionAgent', 240], ['CodeSecurityAuditAgent', 1440], ['DependencySecurityAgent', 1440],
    ['RuntimeThreatMonitorAgent', 5], ['AccessControlGuardianAgent', 1440], ['AISafetyMonitorAgent', 5], ['AgentBehaviorMonitorAgent', 10],
  ]);
});

test('idempotent: the same rows in any order give the same rollup', () => {
  const a = allClean();
  a.department_events = [event('RuntimeThreatMonitorAgent', 'ev-1', { event_type: 'threat_detected' }), event('RuntimeThreatMonitorAgent', 'ev-2', { event_type: 'threat_detected' })];
  const b: Snapshot = { ...a, ai_agents: [...a.ai_agents].reverse(), ai_agent_activity_logs: [...a.ai_agent_activity_logs].reverse(), department_events: [...a.department_events!].reverse() };
  assert.deepEqual(rollup(a), rollup(b));
});
