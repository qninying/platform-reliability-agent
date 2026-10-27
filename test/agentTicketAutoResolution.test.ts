import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyResolution, resolveOnce, coverageGaps } from '../src/capabilities/agentTicketAutoResolution.ts';
import { SandboxError } from '../src/sandbox/sandboxStore.ts';
import { TicketSandbox, loadTicketFixture, type TicketFixture, type Sources } from '../src/sandbox/ticketSandbox.ts';
import { RESOLVERS, coryEngineRule, workforceRule } from '../src/tickets/resolverRules.ts';

// The example fixture is a sandbox queue, not production data.
const EXAMPLE = 'examples/ticket-resolution.fixture.json';
const fresh = () => new TicketSandbox(loadTicketFixture(EXAMPLE));

const SOURCES: Sources = { ai_agents: [], capabilities: [], strategic_initiatives: [], ops_bc_todos: [], leads: { available: true, recent_48h: 10, last_7d: 35 } };
const wfTicket = (id: string, agent: string) => ({ id, type: 'workforce_decision', entity_type: 'agent', entity_id: `${agent}:high_error_rate`, created_by_id: 'workforce_intelligence_engine', status: 'backlog', metadata: { agent_name: agent } });
const ceTicket = (id: string, description: string) => ({ id, type: 'agent_action', entity_type: null, entity_id: null, created_by_id: 'cory-engine', source: 'cory_autonomous_cycle', status: 'backlog', description });
const agentFailure = (name: string) => `**Problem:** Agent "${name}" is in error state: timeout`;
const agent = (agent_name: string, over: Partial<Sources['ai_agents'][number]> = {}) => ({ agent_name, status: 'idle', enabled: true, run_count: 100, error_count: 5, ...over });

test('acceptance: every must-not ticket is still open, and a second run closes zero additional tickets and adds zero duplicate comments', () => {
  const v = verifyResolution(fresh());
  assert.deepEqual(v.coverage_gaps, []);
  assert.equal(v.must_not_still_open, true);
  assert.deepEqual(v.closed_must_not, []);
  assert.deepEqual(v.left_open_should_close, []);
  assert.ok(v.first_run.reduce((n, r) => n + r.closed, 0) > 0, 'the first run must close something, or the test proves nothing');
  assert.equal(v.second_run_closed, 0);
  assert.equal(v.second_run_comments, 0);
  assert.equal(v.verified, true);
});

test('acceptance, per resolver: each resolver run alone keeps its must-not tickets open and is a no-op the second time', () => {
  for (const r of RESOLVERS) {
    const v = verifyResolution(fresh(), [r]);
    assert.deepEqual(v.coverage_gaps, [], r);
    assert.ok(v.first_run[0].closed > 0, `${r} closes at least one ticket in the example`);
    assert.equal(v.second_run_closed, 0, r);
    assert.equal(v.second_run_comments, 0, r);
    assert.deepEqual(v.closed_must_not, [], r);
  }
});

test('every close carries its evidence in the same write, and each closed ticket has exactly one', () => {
  const s = fresh();
  resolveOnce(s);
  resolveOnce(s);
  const writes = s.writes();
  assert.ok(writes.length > 0);
  for (const w of writes) assert.ok(w.comment.trim().length > 20, `${w.target_id} closed without evidence`);
  const ids = writes.map((w) => w.target_id);
  assert.equal(new Set(ids).size, ids.length, 'a ticket was closed or commented on twice');
});

test('a resolver with no must-not ticket in its scope is a coverage gap, and the run is not verified', () => {
  const f = loadTicketFixture(EXAMPLE);
  f.tickets = f.tickets.filter((t) => !(t.created_by_id === 'bpos_orchestrator' && t.expect === 'stay_open'));
  const s = new TicketSandbox(f);
  assert.deepEqual(coverageGaps(s), ['bpos_capability']);
  assert.equal(verifyResolution(s).verified, false);
});

test('the sandbox refuses to close a closed ticket or to close without evidence', () => {
  const s = fresh();
  assert.throws(() => s.closeTicket('t-wf-recovered', 'done', 'workforce', '   '), /evidence/);
  s.closeTicket('t-wf-recovered', 'done', 'workforce', 'example evidence that satisfied the rule');
  assert.throws(() => s.closeTicket('t-wf-recovered', 'done', 'workforce', 'again'), /already done/);
  assert.equal(s.writes().length, 1);
});

test('where the platform closes without evidence, Ellis leaves the ticket open and says the platform would close it', () => {
  const cases: Array<[string, ReturnType<typeof workforceRule>]> = [
    ['workforce, 0 runs', workforceRule(wfTicket('t', 'a'), { ...SOURCES, ai_agents: [agent('a', { run_count: 0, error_count: 0 })] })],
    ['cory, agent deleted', coryEngineRule(ceTicket('t', agentFailure('gone')), SOURCES)],
    ['cory, agent disabled', coryEngineRule(ceTicket('t', agentFailure('a')), { ...SOURCES, ai_agents: [agent('a', { enabled: false })] })],
    ['cory, agent paused', coryEngineRule(ceTicket('t', agentFailure('a')), { ...SOURCES, ai_agents: [agent('a', { status: 'paused' })] })],
    ['cory, lead query failed', coryEngineRule(ceTicket('t', '**Problem:** Lead generation dropped 50% in last 48h'), { ...SOURCES, leads: { available: false, recent_48h: 50, last_7d: 70 } })],
    ['cory, no baseline', coryEngineRule(ceTicket('t', '**Problem:** Lead generation dropped 50% in last 48h'), { ...SOURCES, leads: { available: true, recent_48h: 0, last_7d: 6 } })],
  ];
  for (const [name, d] of cases) {
    assert.equal(d.close_to, null, name);
    assert.equal(d.platform_would_close, true, name);
  }
});

test('the conversion check uses the platform integer baseline: 13 leads in 7 days expects 2, so 1 is still a drop', () => {
  const d = coryEngineRule(ceTicket('t', '**Problem:** Lead generation dropped 50% in last 48h'), { ...SOURCES, leads: { available: true, recent_48h: 1, last_7d: 13 } });
  assert.equal(d.outcome, 'conversion_drop_still_active');
});

test('the workforce threshold matches the platform: above 20% and at least 10 errors stays open; 20% exactly closes', () => {
  assert.equal(workforceRule(wfTicket('t', 'a'), { ...SOURCES, ai_agents: [agent('a', { run_count: 50, error_count: 11 })] }).close_to, null);
  assert.equal(workforceRule(wfTicket('t', 'a'), { ...SOURCES, ai_agents: [agent('a', { run_count: 50, error_count: 10 })] }).close_to, 'done');
  assert.equal(workforceRule(wfTicket('t', 'a'), { ...SOURCES, ai_agents: [agent('a', { run_count: 20, error_count: 9 })] }).close_to, 'done');
});

test('resolvers read no expectations: rows handed to the rules carry no expect field', () => {
  const s = fresh();
  for (const t of s.openTickets(() => true)) assert.equal('expect' in t, false);
  for (const i of s.openItems(() => true)) assert.equal('expect' in i, false);
});

test('only a TicketSandbox can be resolved; there is no production target', () => {
  assert.throws(() => resolveOnce({} as TicketSandbox), (e: unknown) => e instanceof SandboxError && e.errorClass === 'ContractViolation');
});

test('a fixture with an unknown expectation is refused', () => {
  const bad = JSON.parse(JSON.stringify(loadTicketFixture(EXAMPLE))) as TicketFixture;
  (bad.tickets[0] as { expect: string }).expect = 'maybe';
  const path = join(tmpdir(), `ellis-bad-ticket-fixture-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(bad));
  try {
    assert.throws(() => loadTicketFixture(path), /expect must be/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('idempotent: the same queue in any order gives the same verification', () => {
  const f = loadTicketFixture(EXAMPLE);
  const a = verifyResolution(new TicketSandbox(f));
  const b = verifyResolution(new TicketSandbox({ ...f, tickets: [...f.tickets].reverse(), inbox_items: [...f.inbox_items].reverse() }));
  assert.deepEqual(a, b);
});
