import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalReport, type InitiativeRow, type ProposalSnapshot, type ProposalTicketRow, type TicketActivityRow } from '../src/capabilities/evolutionProposals.ts';

// Rows are shaped as the platform's initiatives, tickets and ticket_activities; test inputs, not production data.
function init(id: string, over: Partial<InitiativeRow> = {}): InitiativeRow {
  return { id, department_id: 'dept-infra', title: `proposal ${id}`, description: `rationale for ${id}`, status: 'planned', created_by_agent: 'InfrastructureEvolutionArchitect', tags: [], created_at: '2026-10-01T06:22:00Z', ...over };
}
const ticket = (id: string, initiativeId: string, status = 'backlog'): ProposalTicketRow => ({ id, status, entity_type: 'initiative', entity_id: initiativeId });
function move(id: string, ticketId: string, to: string, over: Partial<TicketActivityRow> = {}): TicketActivityRow {
  return { id, ticket_id: ticketId, actor_type: 'human', actor_id: 'person-1', action: 'status_changed', from_value: 'backlog', to_value: to, created_at: '2026-10-05T10:00:00Z', ...over };
}
function snap(initiatives: InitiativeRow[], tickets: ProposalTicketRow[] = [], ticket_activities: TicketActivityRow[] = []): ProposalSnapshot {
  return { captured_at: '2026-10-27T15:00:00Z', captured_by: 'test', initiatives, tickets, ticket_activities };
}
const one = (s: ProposalSnapshot) => proposalReport(s).proposals[0];
const STATES = ['open', 'accepted', 'deferred', 'rejected'];

test('acceptance: a proposal with no recorded outcome reads as open, not as accepted', () => {
  const p = one(snap([init('a')], [ticket('t', 'a')]));
  assert.equal(p.state, 'open');
  assert.equal(p.decided, null);
  assert.match(p.reason, /open, not accepted/);
});

test("acceptance: every proposal's state is one of open, accepted, deferred or rejected, whatever the records hold", () => {
  const rows = [
    init('planned'), init('active', { status: 'active' }), init('completed', { status: 'completed' }), init('on-hold', { status: 'on_hold' }),
    init('cancelled', { status: 'cancelled' }), init('odd', { status: 'archived' }), init('blank', { status: '' }),
  ];
  const tickets = rows.map((r) => ticket(`t-${r.id}`, r.id));
  const moves = [move('m1', 't-planned', 'in_review'), move('m2', 't-odd', 'paused')];
  const r = proposalReport(snap(rows, tickets, moves));
  assert.equal(r.proposals.length, rows.length);
  for (const p of r.proposals) assert.ok(STATES.includes(p.state), `${p.id} is '${p.state}'`);
  assert.equal(r.proposals.find((p) => p.id === 'odd')!.state, 'open');
  assert.equal(r.proposals.find((p) => p.id === 'blank')!.state, 'open');
});

test('a person moving the ticket forward is accepted; cancelling it is rejected; each names who and when', () => {
  const acc = one(snap([init('a')], [ticket('t', 'a', 'in_progress')], [move('m', 't', 'in_progress')]));
  assert.equal(acc.state, 'accepted');
  assert.deepEqual(acc.decided, { by: 'person-1', at: '2026-10-05T10:00:00Z', source: 'ticket_activity' });
  const rej = one(snap([init('a')], [ticket('t', 'a', 'cancelled')], [move('m', 't', 'cancelled')]));
  assert.equal(rej.state, 'rejected');
});

test('an agent moving or closing the ticket is not a decision: the proposal stays open', () => {
  const p = one(snap([init('a')], [ticket('t', 'a', 'done')], [move('m', 't', 'done', { actor_type: 'agent', actor_id: 'some-agent' })]));
  assert.equal(p.state, 'open');
  assert.ok(p.notes.some((n) => /agent cannot decide/.test(n)));
  assert.ok(p.notes.some((n) => /no person changed it/.test(n)));
});

test('a ticket status with no activity row behind it is not a decision', () => {
  assert.equal(one(snap([init('a')], [ticket('t', 'a', 'cancelled')])).state, 'open');
});

test('on_hold is the only source of deferred, and a status-only outcome says no one is recorded as setting it', () => {
  const p = one(snap([init('a', { status: 'on_hold', updated_at: '2026-10-09T00:00:00Z' })]));
  assert.equal(p.state, 'deferred');
  assert.deepEqual(p.decided, { by: 'unattributed', at: '2026-10-09T00:00:00Z', source: 'initiative_status' });
});

test('outcomes that disagree read as open, with both named', () => {
  const p = one(snap([init('a', { status: 'cancelled' })], [ticket('t', 'a', 'in_progress')], [move('m', 't', 'in_progress')]));
  assert.equal(p.state, 'open');
  assert.match(p.reason, /disagree.*accepted.*rejected/);
});

test('the latest human move wins', () => {
  const p = one(snap([init('a')], [ticket('t', 'a', 'cancelled')], [
    move('m1', 't', 'todo', { created_at: '2026-10-05T10:00:00Z' }),
    move('m2', 't', 'cancelled', { created_at: '2026-10-06T10:00:00Z' }),
  ]));
  assert.equal(p.state, 'rejected');
});

test('rationale is the recorded description, and a missing one is said, not invented', () => {
  assert.equal(one(snap([init('a')])).rationale, 'rationale for a');
  const p = one(snap([init('a', { description: '  ' })]));
  assert.equal(p.rationale, null);
  assert.ok(p.notes.includes('no rationale was recorded'));
});

test('only the three platform architects are in scope by default; others can be named', () => {
  const rows = [init('mine'), init('theirs', { created_by_agent: 'MarketingAutomationArchitect' }), init('none', { created_by_agent: null })];
  assert.deepEqual(proposalReport(snap(rows)).proposals.map((p) => p.id), ['mine']);
  assert.deepEqual(proposalReport(snap(rows), { architects: ['MarketingAutomationArchitect'] }).proposals.map((p) => p.id), ['theirs']);
});

test('a proposal re-raised after the same idea was rejected in the same department is listed', () => {
  const tag = ['dedup_key:opportunity_type:health_gap'];
  const r = proposalReport(snap(
    [init('first', { tags: tag, created_at: '2026-10-01T00:00:00Z' }), init('again', { tags: tag, created_at: '2026-10-08T00:00:00Z' }), init('other-dept', { tags: tag, department_id: 'dept-x', created_at: '2026-10-09T00:00:00Z' })],
    [ticket('t1', 'first', 'cancelled')],
    [move('m', 't1', 'cancelled')],
  ));
  assert.deepEqual(r.reproposed_after_rejection, [{ id: 'again', earlier_rejected: ['first'] }]);
});

test('every proposal cites its initiative, its tickets and the deciding activity', () => {
  const p = one(snap([init('a')], [ticket('t', 'a', 'todo')], [move('m', 't', 'todo')]));
  assert.deepEqual(p.citations.map((c) => `${c.table}:${c.id}`), ['initiatives:a', 'tickets:t', 'ticket_activities:m']);
});

test('idempotent: the same rows in any order give the same report', () => {
  const rows = [init('b', { created_at: '2026-10-02T00:00:00Z' }), init('a'), init('c', { status: 'on_hold', created_at: '2026-10-03T00:00:00Z' })];
  const tickets = [ticket('tb', 'b'), ticket('ta', 'a')];
  const moves = [move('m1', 'ta', 'todo'), move('m2', 'tb', 'cancelled')];
  assert.deepEqual(proposalReport(snap(rows, tickets, moves)), proposalReport(snap([...rows].reverse(), [...tickets].reverse(), [...moves].reverse())));
});
