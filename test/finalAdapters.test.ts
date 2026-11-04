import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommendDisable, type ControlSnapshot } from '../src/capabilities/agentEnableDisableControl.ts';
import { verifyResolution } from '../src/capabilities/agentTicketAutoResolution.ts';
import { TicketSandbox, loadTicketFixture } from '../src/sandbox/ticketSandbox.ts';
import { runRepair, type RepairReport } from '../src/capabilities/orchestrationAutoRepair.ts';
import { loadFixture, SandboxStore } from '../src/sandbox/sandboxStore.ts';
import { proposalReport, type ProposalSnapshot, type ProposalReport } from '../src/capabilities/evolutionProposals.ts';
import type { PromotionAnswer, Criterion } from '../src/capabilities/promotionEvidence.ts';
import type { ThresholdAnswer, Threshold } from '../src/capabilities/reliabilityThresholds.ts';
import type { Briefing } from '../src/capabilities/reliabilityReport.ts';
import { assessDirection, type DirectionSnapshot } from '../src/capabilities/workforceTechnologyDirection.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { disableOutput, ticketOutput, repairOutput } from '../src/output/actionAdapters.ts';
import { evolutionOutput, promotionOutput, thresholdsOutput, briefingOutput, directionOutput } from '../src/output/governanceAdapters.ts';

// Inputs are the repository's examples and sandbox fixtures, or answers written in the checks' own shapes: not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'));
const CAP = { captured_at: '2026-11-04T12:00:00Z', captured_by: 'test' };

function holds<D>(o: ToolOutput<D>, detail: D) {
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no evidence`);
  if (o.verdict === 'partly_unknown' || o.verdict === 'unknown') assert.ok(o.blind_spots.length > 0, `${o.tool}: ${o.verdict} names no blind spot`);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned');
  assert.equal(o.detail, detail);
}

type DisableExample = ControlSnapshot & { requests: Parameters<typeof recommendDisable>[1][] };

test('disable: a recommendation is a problem citing the agent row and the evidence given; timers it cannot stop are named', () => {
  const s = json<DisableExample>('examples/disable-recommendation.example.json');
  const r = recommendDisable(s, s.requests[0]);
  const o = disableOutput(r, s, EMPTY);
  holds(o, r);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  assert.ok(o.evidence.some((e) => e.table === 'ai_agent_activity_logs' && e.id === 'example-log-1'));
  const leaky = { ...r, would_not_stop: [{ timer: 'Side', schedule: '* * * * *', label: 'Side', ref: 'x.ts:3', effect: 'it checks another row' }] };
  assert.deepEqual(disableOutput(leaky, s, EMPTY).blind_spots, ['Side (x.ts:3) keeps running: it checks another row']);
});

test('disable: already disabled is ok; no evidence, or no row, is unknown with the reason', () => {
  const s = json<DisableExample>('examples/disable-recommendation.example.json');
  const name = s.requests[0].agent_name;
  const off = { ...s, ai_agents: s.ai_agents.map((a) => (a.agent_name === name ? { ...a, enabled: false } : a)) };
  assert.equal(disableOutput(recommendDisable(off, s.requests[0]), s, EMPTY).verdict, 'ok');
  const bare = recommendDisable(s, { agent_name: name, evidence: [] });
  const u = disableOutput(bare, s, EMPTY);
  holds(u, bare);
  assert.equal(u.verdict, 'unknown');
  assert.equal(disableOutput(recommendDisable(s, { agent_name: 'NoSuchAgent', evidence: s.requests[0].evidence }), s, EMPTY).verdict, 'unknown');
});

test('tickets: the sandbox fixture holds the contract and says it is a sandbox; a ticket closed that must stay open is the problem', () => {
  const v = verifyResolution(new TicketSandbox(loadTicketFixture('examples/ticket-resolution.fixture.json')));
  const o = ticketOutput(v, CAP, EMPTY);
  holds(o, v);
  assert.match(o.as_of.note!, /sandbox fixture .*not production/);
  const wrong = { ...v, closed_must_not: ['T-9'], verified: false };
  const w = ticketOutput(wrong, CAP, EMPTY);
  holds(w, wrong);
  assert.equal(w.verdict, 'problem');
  assert.deepEqual(w.evidence.map((e) => e.id), ['T-9']);
  const twice = { ...v, second_run_comments: 1, verified: false };
  assert.equal(ticketOutput(twice, CAP, EMPTY).verdict, 'problem', 'a second run that writes anything is not idempotent');
  const gaps = { ...v, coverage_gaps: [v.resolvers[0]] };
  assert.equal(ticketOutput(gaps, CAP, EMPTY).verdict, 'partly_unknown');
});

test('repair: the sandbox fixture holds the contract; a change that is not verified, or a failed run, is the problem', () => {
  const fixture = loadFixture('examples/orchestration-repair.fixture.json');
  const r = runRepair(new SandboxStore(fixture), fixture.faults);
  const o = repairOutput(r, CAP, EMPTY);
  holds(o, r);
  if (r.applied.length) {
    const unverified: RepairReport = { ...r, verified: false };
    const u = repairOutput(unverified, CAP, EMPTY);
    assert.equal(u.verdict, 'problem');
    assert.deepEqual(u.evidence.slice(0, r.applied.length).map((e) => e.id), r.applied.map((x) => x.row_id));
  }
  const change = { key: 'k', table: 'orchestration_runs' as RepairReport['applied'][number]['table'], row_id: 'run-1', column: 'status', from: 'stuck', to: 'failed', fault_id: 'f1', repair_class: 'c', action: 'mark failed' };
  const failed: RepairReport = { fixture_id: 'fx', outcome: 'failed', applied: [change], no_op: [], left_alone: [], deferred: [], verified: false, error: { error_class: 'ContractViolation', message: 'm' } };
  const f = repairOutput(failed, CAP, EMPTY);
  holds(f, failed);
  assert.equal(f.verdict, 'problem');
  assert.ok(f.blind_spots.includes('ContractViolation: m'));
  const deferred: RepairReport = { ...failed, outcome: 'partial', verified: true, error: undefined, deferred: [{ ...change, row_id: 'run-2' }] };
  assert.equal(repairOutput(deferred, CAP, EMPTY).verdict, 'partly_unknown');
  const nothing: RepairReport = { fixture_id: 'fx', outcome: 'no_op', applied: [], no_op: [], left_alone: [], deferred: [], verified: true };
  assert.equal(repairOutput(nothing, CAP, EMPTY).verdict, 'unknown');
});

test('evolution: the example holds the contract; an idea proposed again after rejection is the problem, citing both proposals', () => {
  const s = json<ProposalSnapshot>('examples/evolution-proposals.example.json');
  const r = proposalReport(s);
  holds(evolutionOutput(r, s, EMPTY), r);
  const [a, b] = r.proposals;
  const again: ProposalReport = { ...r, reproposed_after_rejection: [{ id: b.id, earlier_rejected: [a.id] }] };
  const o = evolutionOutput(again, s, EMPTY);
  holds(o, again);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(new Set(o.evidence.map((e) => e.id)), new Set([...a.citations, ...b.citations].map((c) => c.id)));
  const none: ProposalReport = { ...r, proposals: [], reproposed_after_rejection: [] };
  assert.equal(evolutionOutput(none, s, EMPTY).verdict, 'unknown');
});

const criterion = (n: number, state: Criterion['state'], cites: string[]): Criterion => ({ number: n, text: `c${n}`, state, run_records: cites.map((cite) => ({ criterion: n, kind: 'run_record' as const, cite, source: 'evidence_file' as const })), supporting: [] });
const promotion = (verdict: PromotionAnswer['verdict'], criteria: Criterion[]): PromotionAnswer => ({
  source_commit: 'abc', capability_id: 'platform.CAP.x', rung: 'autonomy:R2', environment: 'sandbox', verdict, statement: `verdict ${verdict}`, criteria, not_counted: [{ kind: 'conversation', cite: 'chat', why: 'a conversation is not evidence' }],
  level: { approved: 'autonomy:R1', ceiling: 'autonomy:R3', after_this_assembly: 'autonomy:R1', changed: false }, separate_pilot_approval_required: false,
  story_status: { state: null, counts_as_evidence: false }, blockers: [], human_decision: { promotion: 'person_only', decided_by: 'K.D.', ellis_may: 'assemble_and_present', decision_recorded: false, applies_to: 'this capability at this rung alone' }, limits: [],
});

test('promotion: criteria met is ok citing each run record; unmet is a problem; partly proven is partly unknown; nothing cited is unknown', () => {
  const ok = promotion('meets_criteria', [criterion(1, 'met', ['runs/a.json'])]);
  const o = promotionOutput(ok, CAP, EMPTY);
  holds(o, ok);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence, [{ table: 'evidence_file', id: 'runs/a.json', fields: ['criterion 1', 'run_record'] }]);
  assert.equal(promotionOutput(promotion('unmet', [criterion(1, 'unmet', ['runs/b.json'])]), CAP, EMPTY).verdict, 'problem');
  const part = promotion('unproven', [criterion(1, 'met', ['runs/a.json']), criterion(2, 'unproven', [])]);
  const p = promotionOutput(part, CAP, EMPTY);
  holds(p, part);
  assert.equal(p.verdict, 'partly_unknown');
  assert.ok(p.blind_spots.includes('criterion 2 unproven: c2'));
  const none = promotion('no_criteria_defined', []);
  const n = promotionOutput(none, CAP, EMPTY);
  holds(n, none);
  assert.equal(n.verdict, 'unknown');
});

const threshold = (name: string, where: string | null, located: Threshold['located'] = 'read'): Threshold => ({
  name, file: 'alerts.ts', line: 1, where, value: '5', number: 5, concept: 'error_count_limit', delivery: 'alert_table', located,
  owner_claim_at: null, owner_review_on_record: false, producing: { state: 'unmeasured', reason: 'no_alert_record_read', alerts: null, occurrences: null, false_positive_rate: null },
});
const thresholds = (ts: Threshold[], clash = false, read = false): ThresholdAnswer => ({
  source_commit: 'abc', statement: 's', inventory_complete: true,
  counts: { thresholds: ts.length, files: 1, unmeasured: ts.length, outcomes_recorded: 0, not_located: ts.filter((t) => t.located !== 'read').length, owner_claimed_never_reviewed: 0, no_owner_named: ts.length, outside_the_inventory: 0 },
  thresholds: ts, same_concept_different_numbers: clash ? [{ concept: 'error_count_limit', values: [{ where: 'a.ts:1', name: 'A', number: 5 }, { where: 'b.ts:9', name: 'B', number: 3 }] }] : [],
  outside_the_inventory: [], alert_record: { read, captured_at: null, rows: 0, total: null, complete: false },
  human_decision: { setting_a_threshold: 'person_only', owner: 'K.D.', ellis_may: 'report_and_propose', proposals_in_this_release: 0, why_none: 'w', applying_a_change: 'a' }, limits: [],
});

test('thresholds: one concept held to different numbers is a problem citing both places; unmeasured outcomes are always a blind spot', () => {
  const a = thresholds([threshold('A', 'a.ts:1')], true);
  const o = thresholdsOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), ['a.ts:1', 'b.ts:9']);
  const plain = thresholds([threshold('A', 'a.ts:1'), threshold('Lost', null, 'not_found')]);
  const p = thresholdsOutput(plain, CAP, EMPTY);
  assert.equal(p.verdict, 'partly_unknown');
  assert.ok(p.blind_spots.includes('Lost in alerts.ts: not_found'));
  assert.ok(p.blind_spots.some((b) => /no outcome record/.test(b)));
  assert.equal(thresholdsOutput(thresholds([threshold('Lost', null, 'not_found')]), CAP, EMPTY).verdict, 'unknown');
});

const briefing = (measured: Array<number | null>, unmeasured: string[]): Briefing => ({
  produced_at: '2026-11-04T13:00:00Z', source_commit: 'abc', records_captured_at: CAP.captured_at, scope: 's', delivery: 'd', headline: 'nothing measured yet',
  measured: measured.map((value, i) => ({ label: `figure ${i}`, value, of: 10, unit: 'runs', percent: null, source: `tool-${i}` })),
  unmeasured: unmeasured.map((item) => ({ item, count: null, why: 'no record', names: [], source: 'x' })), decisions: [], limits: [],
});

test('briefing: every item measured is ok citing the tool behind each figure; anything unmeasured is partly unknown; no figure is unknown', () => {
  const ok = briefing([3], []);
  const o = briefingOutput(ok, EMPTY);
  holds(o, ok);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence.map((e) => e.id), ['tool-0']);
  assert.equal(o.as_of.captured_at, CAP.captured_at);
  assert.equal(briefingOutput(briefing([3, null], ['backups']), EMPTY).verdict, 'partly_unknown');
  const none = briefing([null], []);
  const n = briefingOutput(none, EMPTY);
  holds(n, none);
  assert.equal(n.verdict, 'unknown');
});

test('technology direction: both examples hold the contract; with no direction on file the answer is unknown and says why', () => {
  const without = json<DirectionSnapshot>('examples/technology-direction.example.json');
  const r = assessDirection(without);
  const o = directionOutput(r, without, EMPTY);
  holds(o, r);
  if (r.verdict === 'unknown') assert.ok(o.blind_spots.includes(r.direction.reason));
  const withDir = json<DirectionSnapshot>('examples/technology-direction.with-direction.example.json');
  const d = assessDirection(withDir);
  const w = directionOutput(d, withDir, EMPTY);
  holds(w, d);
  if (d.verdict === 'divergent') assert.equal(w.verdict, 'problem');
});
