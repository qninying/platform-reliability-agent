import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CoverageAnswer, StoreCoverage } from '../src/capabilities/errorClassCoverage.ts';
import type { AuditAnswer } from '../src/capabilities/idempotencyAudit.ts';
import { retentionReport, type RetentionSnapshot, type TableAnswer } from '../src/capabilities/dataRetentionSweep.ts';
import { classifyBaseline, type BugTicket, type RunResult } from '../src/capabilities/bugBaseline.ts';
import { assessPrompts, type PromptSnapshot } from '../src/capabilities/promptPerformance.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { errorCoverageOutput, idempotencyOutput, retentionOutput, baselineOutput, promptOutput } from '../src/output/qualityAdapters.ts';

// Inputs are the repository's examples, or answers written in the checks' own shapes: not production data.
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

const storeOf = (ids: string[]): StoreCoverage => ({ failures: ids.length + 1, classified: 1, unclassified: ids.length, unclassified_ids: ids, generic: ids.length, no_class: 0, outside_the_six: 0 });
const coverage = (activity: string[], dead: string[], sites: number, failures = true): CoverageAnswer => ({
  captured_at: CAP.captured_at, source_commit: 'abc', window_days: 7, verdict: failures ? 'measured' : 'no_failures', statement: failures ? 's' : 'No failure is recorded, so coverage is unknown, not 100%.',
  coverage: { failures: 2, classified: 1, unclassified: activity.length + dead.length, percent: 50 },
  by_store: { ai_agent_activity_logs: storeOf(activity), dead_letter_jobs: storeOf(dead) }, classes: [],
  catch_sites: { files_read: ['backend/src/services/cronInstrumentation.ts'], total: sites + 1, records_class: 1, no_class: sites, by_kind: {} as CoverageAnswer['catch_sites']['by_kind'], records_no_class: Array.from({ length: sites }, (_, i) => ({ file: 'jobs.ts', line: 10 + i, kind: 'silent' as const })) },
  vocabulary: { decided: true, decided_by: 'K.D.', decided_on: '2026-11-08', classes: ['TimeoutError'], note: 'n' }, limits: [],
});

test('error classes: unclassified failures are a problem citing each row in its store, then any catch site that records no class', () => {
  const a = coverage(['a1'], ['d1'], 1);
  const o = errorCoverageOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['ai_agent_activity_logs', 'a1'], ['dead_letter_jobs', 'd1'], ['platform_source', 'jobs.ts:10']]);
  assert.equal(errorCoverageOutput(coverage([], [], 2), CAP, EMPTY).verdict, 'problem', 'a catch site recording no class is a problem on its own');
});

test('error classes: everything classified is ok citing the files read; no failures recorded is unknown, not 100%', () => {
  assert.equal(errorCoverageOutput(coverage([], [], 0), CAP, EMPTY).verdict, 'ok');
  const none = coverage([], [], 0, false);
  const o = errorCoverageOutput(none, CAP, EMPTY);
  holds(o, none);
  assert.equal(o.verdict, 'unknown');
  assert.match(o.blind_spots[0], /not 100%/);
});

const audit = (v: AuditAnswer['verdict']): AuditAnswer => ({
  source_commit: 'abc', family: 'publishing', verdict: v, statement: v === 'harness_cannot_fail' ? 'the harness missed the unsafe job' : 's',
  claim_in_source: { file: 'backend/src/services/publishing/publishingWorker.ts', line: 42 }, fixture_jobs: [],
  platform_jobs: { verdict: 'unknown', why: 'no platform job has been run twice yet' }, evidence_kind: 'twice_run_on_fixture', limits: [],
});

test('idempotency: a proven harness still leaves every platform job unknown; a harness that cannot fail is a problem', () => {
  const a = audit('harness_proven');
  const o = idempotencyOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'unknown');
  assert.deepEqual(o.blind_spots, ['no platform job has been run twice yet']);
  assert.deepEqual(o.evidence.map((e) => e.id), ['backend/src/services/publishing/publishingWorker.ts:42']);
  assert.equal(idempotencyOutput(audit('harness_cannot_fail'), CAP, EMPTY).verdict, 'problem');
});

test('retention: the example holds the contract, and a sweep deleting outside its stated window is the problem case', () => {
  const s = json<RetentionSnapshot>('examples/retention-sweep.example.json');
  const tables = retentionReport(s, { now: new Date(s.captured_at) });
  holds(retentionOutput(tables, s, EMPTY), tables);
  const t = tables[0];
  const off: TableAnswer[] = [{ ...t, code_check: { follows_stated_window: false, note: 'deletes after 30 days, stated 90' } }, ...tables.slice(1)];
  const o = retentionOutput(off, s, EMPTY);
  holds(o, off);
  assert.equal(o.verdict, 'problem');
  assert.ok(o.evidence.some((e) => e.table === 'platform_source' && e.id === t.code_ref));
});

test('retention: a disabled sweep is a problem; a stated window and a running sweep is ok; an unknown window is a blind spot', () => {
  const base: TableAnswer = {
    table: 't', job: 'J', action: 'delete' as TableAnswer['action'], window: { status: 'stated', days: 90, reason: 'approved', stated: [] },
    code_check: { follows_stated_window: true, note: 'n' }, last_sweep: { status: 'swept', at: CAP.captured_at, reason: 'ran' },
    rows_removed: { count: 1, reason: 'r' }, risks: [], code_ref: 'jobs/cleanup.ts:5', citations: [{ table: 'ai_agents', id: 'row-J', fields: ['enabled'] }],
  };
  assert.equal(retentionOutput([base], CAP, EMPTY).verdict, 'ok');
  const rule = { ...EMPTY, rules: [{ tool: 'platform.CAP.data_retention_sweep', case: 'sweep_not_running', severity: 'Medium' as const, why: 'old rows pile up' }] };
  const off = retentionOutput([{ ...base, last_sweep: { status: 'disabled', at: null, reason: 'off' } }], CAP, rule);
  assert.deepEqual([off.verdict, off.severity], ['problem', 'Medium']);
  const dark = [{ ...base, window: { status: 'unknown' as const, days: null, reason: 'no window is stated anywhere', stated: [] } }];
  const o = retentionOutput(dark, CAP, EMPTY);
  assert.equal(o.verdict, 'partly_unknown');
  assert.deepEqual(o.blind_spots, ['t: no window is stated anywhere']);
});

const ticket: BugTicket = { id: 'T-1', type: 'bug', title: 'x', description: 'd' };
const reason = { error_name: 'TypeError', message_includes: 'boom' };
const failing: RunResult = { exit_code: 1, timed_out: false, outcomes: [{ name: 'repro', kind: 'thrown', error_name: 'TypeError', message: 'boom here' }] };
const passing: RunResult = { exit_code: 0, timed_out: false, outcomes: [{ name: 'repro', kind: 'pass', error_name: null, message: null }] };

test('bug baseline: a reproduced defect is a problem citing the ticket; passing before any fix is ok; one run is unknown', () => {
  const b = classifyBaseline(ticket, reason, [failing, failing]);
  const o = baselineOutput(b, CAP, EMPTY);
  holds(o, b);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['bug_ticket', 'T-1']]);
  assert.equal(baselineOutput(classifyBaseline(ticket, reason, [passing, passing]), CAP, EMPTY).verdict, 'ok');
  const once = classifyBaseline(ticket, reason, [failing]);
  const u = baselineOutput(once, CAP, EMPTY);
  holds(u, once);
  assert.equal(u.verdict, 'unknown');
});

test('prompt performance: the example holds the contract; an open proposal with no measurement before it is the problem case', () => {
  const s = json<PromptSnapshot>('examples/prompt-performance.example.json');
  const r = assessPrompts(s);
  const o = promptOutput(r, s, EMPTY);
  holds(o, r);
  const p = r.prompts[0];
  const guess = { ...r, prompts: [{ ...p, open_proposals: [{ id: 'prop-1', measured_before: false }] }, ...r.prompts.slice(1)] };
  const g = promptOutput(guess, s, EMPTY);
  holds(g, guess);
  assert.equal(g.verdict, 'problem');
  assert.equal(g.evidence[0].id, 'prop-1');
  assert.equal(g.as_of.captured_at, r.window.end);
});

test('prompt performance: no recorded run cites nothing, so it is unknown', () => {
  const s: PromptSnapshot = { captured_at: CAP.captured_at, captured_by: 'test', window_days: 7, prompts: [], llm_calls: [], proposals: null };
  const r = assessPrompts(s);
  const o = promptOutput(r, s, EMPTY);
  holds(o, r);
  assert.equal(o.verdict, 'unknown');
});
