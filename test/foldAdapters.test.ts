import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ControlSnapshot, ControlAgentRow } from '../src/capabilities/agentEnableDisableControl.ts';
import { fleetStop } from '../src/capabilities/fleetStopLevers.ts';
import { previewDiscovery, type SeedInventory } from '../src/capabilities/discoveryPreview.ts';
import type { RegistrySnapshot } from '../src/capabilities/registryReadSurface.ts';
import { measure, reconcileAnswer } from '../src/capabilities/registryReconciliation.ts';
import { proposeRegistrations } from '../src/capabilities/registrationProposal.ts';
import { managerAccess, type AccessSnapshot } from '../src/capabilities/managerAccess.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { fleetStopOutput, discoveryOutput, proposalsOutput, managerAccessOutput } from '../src/output/foldAdapters.ts';
import { FILES } from './fixtures/registryCheckout.ts';

// Inputs are the repository's examples and fixtures: code-derived or invented, not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'));
const CAP = { captured_at: '2026-11-04T12:00:00Z', captured_by: 'test' };

function holds<D>(o: ToolOutput<D>, detail: D) {
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no evidence`);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned');
  assert.equal(o.detail, detail);
}

test('fleet stop: timers the stop cannot reach make a problem citing those timers; a fully reached fleet is ok citing its rows', () => {
  const inv = json<ControlSnapshot>('examples/timer-inventory.example.json');
  const a = fleetStop(inv);
  const o = fleetStopOutput(a, inv, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.evidence.filter((e) => e.table === 'timer_inventory').length, a.emergency_stop.timers_not_reached.length);
  const row = (n: string): ControlAgentRow => ({ id: `r-${n}`, agent_name: n, enabled: true, status: 'idle' });
  const small: ControlSnapshot = { ...CAP, timers: [{ timer: 'A', schedule: '* * * * *', label: 'A', ref: 'x.ts:1', gates: [{ gate: 'instrument_cron_job', flag: 'A' }] }], ai_agents: [row('A')], cron_schedule_configs: [], requests: [] };
  const ok = fleetStopOutput(fleetStop(small), small, EMPTY);
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual(ok.evidence.map((e) => e.id), ['r-A']);
});

test('fleet stop: a resume that would undo a person\'s pause is a problem citing that row', () => {
  const s: ControlSnapshot = { ...CAP, timers: [], ai_agents: [{ id: 'r-P', agent_name: 'P', enabled: true, status: 'paused' }], cron_schedule_configs: [], requests: [] };
  const o = fleetStopOutput(fleetStop(s), s, EMPTY);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['ai_agents', 'r-P']]);
});

test('discovery: a preview that would start dead timers, or leave timers undiscoverable, is a problem citing them', () => {
  const reg = json<RegistrySnapshot>('examples/registry-ask.example.json');
  const seed = json<SeedInventory>('examples/timer-inventory.example.json');
  const a = previewDiscovery(reg, seed);
  const o = discoveryOutput(a, reg, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.ok(o.evidence.some((e) => e.table === 'timer_inventory'));
  assert.deepEqual(o.blind_spots, a.cannot_see);
});

test('discovery: a registry that already holds every seed entry is ok, citing its rows', () => {
  const reg: RegistrySnapshot = { ...CAP, ai_agents: [{ id: 'r-A', agent_name: 'A', enabled: true, status: 'idle', schedule: null, run_count: 1, error_count: 0, last_run_at: null }], ai_agent_activity_logs: [], timers: [], timer_scope: [], cron_schedule_configs: [] };
  const a = previewDiscovery(reg, { ai_agents: [{ id: 'seed:A', agent_name: 'A', enabled: true, status: 'idle' }], timers: [] });
  const o = discoveryOutput(a, reg, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence.map((e) => e.id), ['r-A']);
});

test('proposals: untracked timers needing a row are a problem citing their call sites, stamped with the measurement', () => {
  const r = { read(p: string) { if (!(p in FILES)) throw new Error(p); return FILES[p]; }, list(d: string) { return Object.keys(FILES).filter((f) => f.startsWith(`${d}/`)).sort(); } };
  const m = measure(r, new Date('2026-10-27T23:00:00Z'), 'abc123def');
  const recon = reconcileAnswer(m);
  const p = proposeRegistrations(m, recon);
  const o = proposalsOutput(p, recon, EMPTY);
  holds(o, p);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.as_of.captured_at, '2026-10-27T23:00:00.000Z');
  assert.match(o.as_of.note ?? '', /abc123def/);
  const needed = new Set(p.proposals.filter((x) => x.proposed_row).flatMap((x) => x.call_sites));
  for (const e of o.evidence) assert.ok(needed.has(e.id), e.id);
  assert.deepEqual(o.blind_spots, recon.cannot_say);
  const none = { ...p, proposals: [], count: 0 };
  assert.equal(proposalsOutput(none, recon, EMPTY).verdict, 'ok');
});

test('manager access: a manager cut off from their agent is a problem; an unknown agent is unknown with no evidence', () => {
  const s = json<AccessSnapshot>('examples/manager-access.example.json');
  const a = managerAccess(s, 'PlatformAgent');
  const o = managerAccessOutput(a, s, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.blind_spots.length, a.cannot_see.length);
  const u = managerAccessOutput(managerAccess(s, 'Nobody'), s, EMPTY);
  assert.equal(u.verdict, 'unknown');
  assert.deepEqual(u.evidence, []);
  assert.match(u.blind_spots[0], /No ai_agents row is named Nobody/);
});

test('manager access: a manager who reaches their agent, with no directive missed by its own replies, is ok', () => {
  const s: AccessSnapshot = { ...CAP, ai_agents: [{ id: 'a', agent_name: 'A', reports_to_type: 'human', reports_to_id: 'm' }], org_members: [{ id: 'm', email: 'm@example.com' }], admin_users: [{ id: 'u', email: 'm@example.com', role: 'admin' }], management_grants: [], manager_directives: [] };
  assert.equal(managerAccessOutput(managerAccess(s, 'A'), s, EMPTY).verdict, 'ok');
});

test('manager access: each reason is enough on its own: a directive the agent\'s own replies miss, or a manager cut off', () => {
  const base: AccessSnapshot = { ...CAP, ai_agents: [{ id: 'a', agent_name: 'Maya', reports_to_type: 'human', reports_to_id: 'm' }], org_members: [{ id: 'm', email: 'm@example.com' }], admin_users: [{ id: 'u', email: 'm@example.com', role: 'admin' }], management_grants: [], manager_directives: [] };
  const withDirective = { ...base, manager_directives: [{ id: 'd', agent_id: 'a', status: 'active', created_by_email: 'm@example.com' }] };
  const d = managerAccessOutput(managerAccess(withDirective, 'Maya'), withDirective, EMPTY);
  assert.equal(d.verdict, 'problem');
  assert.equal(d.severity_rule.length > 0, true);
  // The same directive on an agent the manager conversation reaches, with no reply runtime of its own, is no problem.
  const other = { ...withDirective, ai_agents: [{ ...withDirective.ai_agents[0], agent_name: 'A' }] };
  assert.equal(managerAccessOutput(managerAccess(other, 'A'), other, EMPTY).verdict, 'ok');
  const cutOff = { ...base, admin_users: [] };
  assert.equal(managerAccessOutput(managerAccess(cutOff, 'Maya'), cutOff, EMPTY).verdict, 'problem');
});
