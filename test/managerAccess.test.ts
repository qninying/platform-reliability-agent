import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { managerAccess, downstream, MAX_DOWNWARD_DEPTH, type AccessSnapshot, type AgentRow } from '../src/capabilities/managerAccess.ts';

// The example has the platform's record shapes with invented ids and example.com addresses: not production data.
const EXAMPLE = 'examples/manager-access.example.json';
const load = (): AccessSnapshot => JSON.parse(readFileSync(EXAMPLE, 'utf8'));
const agent = (id: string, to: AgentRow['reports_to_type'], toId: string | null, name = id): AgentRow => ({ id, agent_name: name, reports_to_type: to, reports_to_id: toId });
const snap = (over: Partial<AccessSnapshot> = {}): AccessSnapshot => ({ captured_at: '2026-11-04T18:00:00Z', captured_by: 'test', ai_agents: [], org_members: [], admin_users: [], management_grants: [], manager_directives: [], ...over });

test('acceptance (reachable surface): the org_members row and the missing login are two separate facts, and the surface is not claimed reachable', () => {
  const a = managerAccess(load(), 'PlatformAgent');
  assert.equal(a.accountable!.org_member_id, 'om-manager');
  assert.deepEqual(a.accountable!.logins_under_this_email, []);
  assert.equal(a.accountable!.passes_the_gate, false);
  assert.match(a.accountable!.statement, /has org_members row om-manager\. Separately, no admin_users row and no management role carries/);
  assert.match(a.statement, /Its accountable manager is not\./);
});

test('acceptance (scoped authorization): who may act and by which route, and a manager with no route is reported, not papered over', () => {
  const a = managerAccess(load(), 'PlatformAgent');
  assert.deepEqual(a.may_act.map((x) => [x.email, x.route, x.because]), [['owner@example.com', 'admin_login', 'super_admin']]);
  // The manager's work login exists, but the gate joins on email and the org record carries another address.
  assert.ok(a.refused.some((r) => r.email === 'manager@work.example.com' && /no org_members row carries this email/.test(r.why)));
  // The builder has a login and an org record, and is refused because the agent reports to someone else.
  assert.ok(a.refused.some((r) => r.email === 'builder@example.com' && /does not have this agent in their downstream/.test(r.why)));
});

test('acceptance (directives): a directive with no runtime enforcement path is recorded-but-unenforced, not in force', () => {
  const a = managerAccess(load(), 'PlatformAgent');
  assert.deepEqual(a.directives.map((d) => [d.id, d.effect]), [['md-1', 'recorded_but_unenforced']]);
  const dara = managerAccess(load(), 'Dara');
  assert.equal(dara.directives[0].effect, 'injected_into_prompt');
  assert.match(dara.directives[0].why, /limits nothing mechanically/);
  const revoked = managerAccess(snap({ ai_agents: [agent('a', null, null, 'Dara')], manager_directives: [{ id: 'd', agent_id: 'a', status: 'revoked', created_by_email: 'x' }] }), 'Dara');
  assert.equal(revoked.directives[0].effect, 'revoked');
});

test('a manager with a login under the recorded email, whose agent reports to them, passes through the chain', () => {
  const s = snap({ ai_agents: [agent('a', 'human', 'm')], org_members: [{ id: 'm', email: 'm@example.com' }], management_grants: [{ enrollment_id: 'e', email: 'm@example.com', mgmt_role: 'admin' }] });
  const a = managerAccess(s, 'a');
  assert.equal(a.accountable!.passes_the_gate, true);
  assert.deepEqual(a.may_act.map((x) => x.because), ['agent_in_their_downstream']);
});

test('the chain walks agents downward only: staff under a lead pass, a person above the manager does not', () => {
  const s = snap({ ai_agents: [agent('lead', 'human', 'm'), agent('staff', 'agent', 'lead')], org_members: [{ id: 'm', email: 'm@example.com' }, { id: 'boss', email: 'boss@example.com' }], admin_users: [{ id: 'u1', email: 'm@example.com', role: 'admin' }, { id: 'u2', email: 'boss@example.com', role: 'admin' }] });
  assert.equal(managerAccess(s, 'staff').may_act[0].email, 'm@example.com');
  assert.ok(managerAccess(s, 'staff').refused.some((r) => r.email === 'boss@example.com'));
});

test('only agent-to-agent links are walked below the first level, even when a person link carries the same id', () => {
  const d = downstream(snap({ ai_agents: [agent('lead', 'human', 'm'), agent('stray', 'human', 'lead')] }), 'm');
  assert.deepEqual([...d], ['lead']);
});

test('the walk stops at the platform\'s depth limit', () => {
  const chain = [agent('a0', 'human', 'm'), ...Array.from({ length: MAX_DOWNWARD_DEPTH + 1 }, (_, i) => agent(`a${i + 1}`, 'agent', `a${i}`))];
  const d = downstream(snap({ ai_agents: chain }), 'm');
  assert.ok(d.has(`a${MAX_DOWNWARD_DEPTH}`));
  assert.ok(!d.has(`a${MAX_DOWNWARD_DEPTH + 1}`));
});

test('an owner management role mints a super admin token; a legacy admin with no org record is refused', () => {
  const s = snap({ ai_agents: [agent('a', null, null)], management_grants: [{ enrollment_id: 'e', email: 'o@example.com', mgmt_role: 'owner' }], admin_users: [{ id: 'u', email: 'legacy@example.com', role: 'admin' }] });
  const a = managerAccess(s, 'a');
  assert.deepEqual(a.may_act.map((x) => [x.email, x.route, x.because]), [['o@example.com', 'management_role', 'super_admin']]);
  assert.equal(a.refused[0].email, 'legacy@example.com');
  assert.equal(a.accountable, null);
  assert.match(a.statement, /reports to no person/);
});

test('an unknown or duplicated agent name is answered as such, never guessed', () => {
  assert.match(managerAccess(load(), 'Nobody').statement, /No ai_agents row is named Nobody/);
  const dup = managerAccess(snap({ ai_agents: [agent('x', null, null, 'Same'), agent('y', null, null, 'Same')] }), 'Same');
  assert.equal(dup.agent, null);
  assert.equal(dup.citations.length, 2);
});

test('every answer cites the rows it read and names what it cannot see; the same input gives the same answer', () => {
  const a = managerAccess(load(), 'PlatformAgent');
  for (const t of ['ai_agents', 'org_members', 'admin_users', 'community_members', 'manager_directives']) assert.ok(a.citations.some((c) => c.table === t), t);
  assert.ok(a.cannot_see.some((c) => /joins on email/.test(c)));
  assert.deepEqual(managerAccess(load(), 'PlatformAgent'), a);
});

test('the command exits 3 when the accountable manager cannot reach the agent, and 1 for bad input', () => {
  const r = spawnSync(process.execPath, ['src/cli/managerAccess.ts', '--snapshot', EXAMPLE, '--agent', 'PlatformAgent'], { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(JSON.parse(r.stdout).access.agent.agent_name, 'PlatformAgent');
  assert.equal(spawnSync(process.execPath, ['src/cli/managerAccess.ts', '--snapshot', EXAMPLE], { encoding: 'utf8' }).status, 1);
});
