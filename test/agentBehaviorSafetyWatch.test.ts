import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiAgentRow, ActivityLogRow } from '../src/records.ts';
import { AGENT_GRANTS, DEFAULT_GRANT, grantFor } from '../src/grants/agentGrants.ts';
import { behaviorWatch, missingGrants, type BehaviorSnapshot, type WriteAuditRow, type AiEventRow } from '../src/capabilities/agentBehaviorSafetyWatch.ts';

// Test inputs shaped like the platform's tables; not production data.
const NOW = new Date('2026-10-26T18:00:00Z');

function agent(name: string): AiAgentRow {
  return { id: `id-${name}`, agent_name: name, status: 'idle', enabled: true, schedule: null, last_run_at: null, updated_at: null };
}

function audit(id: string, name: string, operation: string, table: string, hoursAgo = 1, wasAllowed = true): WriteAuditRow {
  return { id, agent_id: `id-${name}`, agent_name: name, operation, target_table: table, was_allowed: wasAllowed, blocked_reason: null, created_at: ago(hoursAgo) };
}

function change(id: string, name: string, action: string, hoursAgo = 1): ActivityLogRow {
  return { id, agent_id: `id-${name}`, action, result: 'success', created_at: ago(hoursAgo), before_state: { v: 1 }, after_state: { v: 2 } };
}

function authz(id: string, name: string, reason: string, extra: Record<string, unknown> = {}): AiEventRow {
  return { id, event_type: 'agent.authorization', agent_id: `id-${name}`, created_at: ago(1), metadata: { agent_name: name, action: 'ticket_dispatch', level: 'suggest', reason, enforced: false, ...extra } };
}

function ago(hours: number) {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function snap(over: Partial<BehaviorSnapshot>): BehaviorSnapshot {
  return { captured_at: NOW.toISOString(), captured_by: 'test', ai_agents: [], agent_write_audits: [], ai_agent_activity_logs: [], ai_events: [], ...over };
}

test('acceptance: every finding names the specific grant that was missing', () => {
  const r = behaviorWatch(snap({
    ai_agents: ['CurriculumArchitectAgent', 'OrchestrationHealthAgent', 'ContentOptimizationAgent'].map(agent),
    agent_write_audits: [audit('w1', 'CurriculumArchitectAgent', 'close_ticket', 'tickets'), audit('w2', 'ContentOptimizationAgent', 'propose_content_rewrite', 'campaigns')],
    ai_agent_activity_logs: [change('a1', 'OrchestrationHealthAgent', 'store_health_snapshot')],
    ai_events: [authz('e1', 'CurriculumArchitectAgent', 'level_forbids:write')],
  }), { now: NOW });
  assert.equal(r.findings.length, 4);
  for (const f of r.findings) {
    assert.ok(f.missing_grant.name.length > 0, `finding on ${f.citation.id} names a grant`);
    assert.ok(['tier', 'table', 'operation', 'autonomy_level'].includes(f.missing_grant.kind));
  }
  const byRow = Object.fromEntries(r.findings.map((f) => [f.citation.id, f.missing_grant]));
  assert.deepEqual(byRow.w1, { kind: 'operation', name: 'close_ticket', held: 'ticket_dispatch' });
  assert.deepEqual(byRow.w2, { kind: 'table', name: 'campaigns', held: 'proposed_agent_actions' });
  assert.equal(byRow.a1.kind, 'tier');
  assert.match(byRow.e1.name, /permitting 'write'/);
});

test('acceptance: a verdict that names no missing grant is not emitted as a finding, and the report says why', () => {
  const r = behaviorWatch(snap({
    ai_agents: [agent('CurriculumArchitectAgent')],
    ai_events: [authz('e1', 'CurriculumArchitectAgent', 'requires_approval:external_send'), authz('e2', 'CurriculumArchitectAgent', 'kill_switch_active'), authz('e3', 'CurriculumArchitectAgent', 'ok')],
  }), { now: NOW });
  assert.equal(r.findings.length, 0);
  assert.deepEqual(r.not_emitted.map((n) => n.row_id), ['e1', 'e2', 'e3']);
});

test('an action inside the grant produces no finding', () => {
  const r = behaviorWatch(snap({
    ai_agents: ['OrchestrationAutoRepairAgent', 'WorkforceOperationsDirector'].map(agent),
    agent_write_audits: [audit('w1', 'WorkforceOperationsDirector', 'flag_operations', 'workforce_tasks')],
    ai_agent_activity_logs: [change('a1', 'OrchestrationAutoRepairAgent', 'reactivate_prompt')],
  }), { now: NOW });
  assert.deepEqual(r.findings, []);
});

test('the operation allowlist is checked even where the platform allowed the write (it checks tier and table only)', () => {
  const r = behaviorWatch(snap({ ai_agents: [agent('CurriculumArchitectAgent')], agent_write_audits: [audit('w1', 'CurriculumArchitectAgent', 'delete_ticket', 'tickets', 1, true)] }), { now: NOW });
  assert.equal(r.findings[0].platform_verdict, 'allowed');
  assert.equal(r.findings[0].missing_grant.name, 'delete_ticket');
});

test('an agent name with no ai_agents row is reported as unattributable, not dropped and not a finding', () => {
  const r = behaviorWatch(snap({ agent_write_audits: [audit('w1', 'GhostAgent', 'update', 'tickets')] }), { now: NOW });
  assert.equal(r.findings.length, 0);
  assert.deepEqual(r.unattributable.map((u) => [u.row_id, u.agent_ref]), [['w1', 'GhostAgent']]);
});

test("the watchers' own actions are excluded, so they never police themselves", () => {
  const r = behaviorWatch(snap({
    ai_agents: [agent('AgentBehaviorMonitorAgent')],
    agent_write_audits: [audit('w1', 'AgentBehaviorMonitorAgent', 'create_ticket', 'tickets')],
  }), { now: NOW });
  assert.equal(r.findings.length, 0);
  assert.equal(r.excluded_self, 1);
});

test('an agent with no grant entry is judged against the platform default, and the finding says so', () => {
  const r = behaviorWatch(snap({ ai_agents: [agent('BrandNewAgent')], agent_write_audits: [audit('w1', 'BrandNewAgent', 'update', 'leads')] }), { now: NOW });
  assert.ok(r.findings.every((f) => f.grant_source === 'platform_default'));
  assert.ok(r.findings.some((f) => f.missing_grant.kind === 'table' && f.missing_grant.name === 'leads'));
});

test('activity rows that record no state change are not treated as writes', () => {
  const summary: ActivityLogRow = { id: 'a1', agent_id: 'id-OrchestrationHealthAgent', action: '1 action(s): finding_info', result: 'success', created_at: ago(1) };
  const r = behaviorWatch(snap({ ai_agents: [agent('OrchestrationHealthAgent')], ai_agent_activity_logs: [summary] }), { now: NOW });
  assert.equal(r.rows_examined.state_changes, 0);
  assert.equal(r.findings.length, 0);
});

test('rows outside the window are not read', () => {
  const r = behaviorWatch(snap({ ai_agents: [agent('CurriculumArchitectAgent')], agent_write_audits: [audit('w1', 'CurriculumArchitectAgent', 'delete_ticket', 'tickets', 30)] }), { now: NOW, windowHours: 24 });
  assert.equal(r.rows_examined.write_audits, 0);
});

test('a reference by name, as one platform caller passes, still attributes', () => {
  const ev: AiEventRow = { ...authz('e1', 'Reese', 'level_forbids:communicate'), agent_id: 'Reese' };
  const r = behaviorWatch(snap({ ai_agents: [agent('Reese')], ai_events: [ev] }), { now: NOW });
  assert.equal(r.findings[0].agent_id, 'id-Reese');
});

test('the pinned grants match the platform source: 36 agents, read-only health agent, default is suggest-only', () => {
  assert.equal(Object.keys(AGENT_GRANTS).length, 36);
  assert.equal(AGENT_GRANTS.OrchestrationHealthAgent.tier, 'read_only');
  assert.deepEqual(AGENT_GRANTS.OrchestrationAutoRepairAgent.operations, ['reactivate_prompt', 'null_broken_fk', 'null_broken_artifact_fk']);
  assert.deepEqual(grantFor('NotListed'), { grant: DEFAULT_GRANT, explicit: false });
  assert.deepEqual(missingGrants(DEFAULT_GRANT, 'propose_x', 'proposed_agent_actions'), [{ kind: 'operation', name: 'propose_x', held: 'none' }]);
});

test('idempotent: the same rows in any order give the same report', () => {
  const rows = [audit('w1', 'CurriculumArchitectAgent', 'delete_ticket', 'tickets', 2), audit('w2', 'CurriculumArchitectAgent', 'close_ticket', 'tickets', 1)];
  const a = behaviorWatch(snap({ ai_agents: [agent('CurriculumArchitectAgent')], agent_write_audits: rows }), { now: NOW });
  const b = behaviorWatch(snap({ ai_agents: [agent('CurriculumArchitectAgent')], agent_write_audits: [...rows].reverse() }), { now: NOW });
  assert.deepEqual(a, b);
});
