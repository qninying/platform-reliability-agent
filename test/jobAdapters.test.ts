import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skipAnswer, type OverlapAnswer, type TimerAnswer } from '../src/capabilities/cronOverlapGuard.ts';
import { askRun, type RunSnapshot } from '../src/capabilities/cronRunInstrumentation.ts';
import type { DeadLetterAnswer, FamilyReport } from '../src/capabilities/deadLetterCapture.ts';
import type { TriageAnswer } from '../src/capabilities/deadLetterTriage.ts';
import { staleReport, RECOVERY_TIMER, type StaleSnapshot } from '../src/capabilities/staleActionRecovery.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { overlapOutput, runRecordOutput, deadLetterOutput, triageOutput, staleOutput } from '../src/output/jobAdapters.ts';

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

const timer = (name: string, over: Partial<TimerAnswer> = {}): TimerAnswer => ({
  timer: name, where: [`x.ts:1`], schedule: '*/5 * * * *', enabled: true, interval_ms: 300_000,
  duration: { average_ms: 1000, worst_ms: 2000, worst_row_id: `run-${name}`, runs_in_window: 3 },
  verdict: 'not_seen_to_overlap', basis: 'within_interval', unassessable_because: null,
  observed_overlaps: { count: 0, row_ids: [] }, guard: { library: null, own_claim: 'none_found', claim_sites: [] }, ...over,
});
const overlap = (can: TimerAnswer[], un: TimerAnswer[], not: TimerAnswer[]): OverlapAnswer => ({
  captured_at: CAP.captured_at, source_commit: 'abc123', window_days: 7,
  verdict: can.length ? 'can_overlap' : un.length ? 'none_assessable_overlap' : 'all_clear_on_record', statement: 's',
  counts: { timers: can.length + un.length + not.length, can_overlap: can.length, not_seen_to_overlap: not.length, unassessable: un.length, holding_own_claim: 0 },
  can_overlap: can, unassessable: un, not_seen_to_overlap: not, claims: { sites: 0, tied_to_a_timer: 0, not_tied: [] },
  skips: skipAnswer([]), limits: [],
});
const unassessable = (name: string) => timer(name, { verdict: 'unassessable', basis: null, unassessable_because: 'no_agents_row', duration: { average_ms: null, worst_ms: null, worst_row_id: null, runs_in_window: 0 } });

test('overlap: a recorded overlap is a problem citing both run rows; one flagged on its average cites its inventory entry, not a run', () => {
  const seen = timer('Seen', { verdict: 'can_overlap', basis: 'observed_overlap', observed_overlaps: { count: 1, row_ids: ['r1', 'r2'] } });
  const avg = timer('Avg', { verdict: 'can_overlap', basis: 'average', duration: { average_ms: 900_000, worst_ms: 1000, worst_row_id: 'r-small', runs_in_window: 1 } });
  const a = overlap([seen, avg], [unassessable('Dark')], []);
  const o = overlapOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['ai_agent_activity_logs', 'r1'], ['ai_agent_activity_logs', 'r2'], ['timer_inventory', 'Avg']]);
  assert.deepEqual(o.blind_spots, ['Dark: no_agents_row']);
  assert.equal(o.as_of.note, 'platform commit abc123');
});

test('overlap: none can overlap but some cannot be assessed is partly unknown, never ok; all unassessable is unknown; all clear is ok', () => {
  const part = overlap([], [unassessable('Dark')], [timer('Fine')]);
  const p = overlapOutput(part, CAP, EMPTY);
  holds(p, part);
  assert.equal(p.verdict, 'partly_unknown');
  assert.deepEqual(p.evidence.map((e) => e.id), ['run-Fine']);
  assert.equal(overlapOutput(overlap([], [unassessable('Dark')], []), CAP, EMPTY).verdict, 'unknown');
  const clear = overlap([], [], [timer('Fine')]);
  assert.equal(overlapOutput(clear, CAP, EMPTY).verdict, 'ok');
});

test('run record: a failed last run is a problem citing its row and run; a success is ok and still names what cannot be said', () => {
  const s = json<RunSnapshot>('examples/cron-runs.example.json');
  const answers = s.ai_agents.map((r) => askRun(s, r.agent_name));
  for (const a of answers) holds(runRecordOutput(a, s, EMPTY), a);
  const ok = answers.find((a) => a.answer !== 'ambiguous' && a.answer !== 'not_instrumented' && a.failed === false)!;
  const o = runRecordOutput(ok, s, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.ok(o.blind_spots.some((b) => /error class/.test(b)));
  const failed = askRun({ ...s, ai_agent_activity_logs: s.ai_agent_activity_logs.map((l) => ({ ...l, result: 'failed' })) }, ok.name);
  const f = runRecordOutput(failed, s, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.ok(f.evidence.some((e) => e.table === 'ai_agents'));
});

test('run record: a name with no row is unknown with the reason, never ok or a problem', () => {
  const s = json<RunSnapshot>('examples/cron-runs.example.json');
  const a = askRun(s, 'NoSuchJob');
  const o = runRecordOutput(a, s, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'unknown');
  assert.match(o.blind_spots[0], /not instrumented, no record exists/);
});

const fams: FamilyReport[] = [
  { family: 'can_dead_letter', can_dead_letter: true, count: 2, why: 'w', jobs: ['A', 'B'] },
  { family: 'inline', can_dead_letter: false, count: 5, why: 'not wrapped', jobs: [] },
];
const capture = (dl: string[], pub: string[]): DeadLetterAnswer => ({
  captured_at: CAP.captured_at, source_commit: 'abc123', verdict: dl.length || pub.length ? 'dead_lettered' : 'queue_empty', statement: 's',
  dead_letter_jobs: { rows: dl.length, marked_resolved: 0, by_class: dl.length ? [{ error_class: 'TimeoutError', rows: dl.length, jobs: [], first_at: 'a', last_at: 'b', row_ids: dl }] : [] },
  publishing_jobs: { rows: pub.length, by_class: pub.length ? [{ error_class: 'AuthError', rows: pub.length, row_ids: pub }] : [] },
  coverage: { total_jobs: 7, can_dead_letter: 2, cannot_or_unknown: 5, families: fams }, limits: [],
});

test('dead letters: rows in either store are a problem citing each row in its own table', () => {
  const a = capture(['d1'], ['p1']);
  const o = deadLetterOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['dead_letter_jobs', 'd1'], ['publishing_jobs', 'p1']]);
});

test('dead letters: an empty queue is partly unknown, naming the jobs that could not have reached it, never ok', () => {
  const a = capture([], []);
  const o = deadLetterOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'partly_unknown');
  assert.deepEqual(o.blind_spots, ['inline (5 jobs): not wrapped']);
  const full = { ...a, coverage: { ...a.coverage, families: [fams[0]] } };
  assert.equal(deadLetterOutput(full, CAP, EMPTY).verdict, 'unknown');
});

const triage = (ids: string[]): TriageAnswer => ({
  captured_at: CAP.captured_at, source_commit: 'abc123', verdict: ids.length ? 'queue_open' : 'queue_empty', statement: 's',
  queue: ids.length ? [{ error_class: 'TimeoutError', rows: ids.length, jobs: 1, stores: ['dead_letter_jobs'], distinct_errors: 1, broad_class: false, note: null,
    entries: [{ store: 'dead_letter_jobs', job: 'A', family: 'can_dead_letter', rows: ids.length, row_ids: ids, last_at: 'b', since_last_dead_letter: 'still_failing', proposal: 'fix_and_replay', because: 'x', how_a_person_acts: 'y' }] }] : [],
  closed: { marked_resolved: [], publishing_cancelled: [] },
  could_not_have_reached: { cannot_or_unknown: 5, of: 7, families: fams, conditions: ['fewer than three failures in a row'] },
  decision: { decided_by: 'a person, at every autonomy level', replay_safety: 'unproven', why: 'w' }, limits: [],
});

test('triage: an open queue is a problem citing its rows; an empty one is partly unknown with what could not reach it', () => {
  const open = triage(['d1', 'd2']);
  const o = triageOutput(open, CAP, EMPTY);
  holds(o, open);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), ['d1', 'd2']);
  const empty = triage([]);
  const e = triageOutput(empty, CAP, EMPTY);
  holds(e, empty);
  assert.equal(e.verdict, 'partly_unknown');
  assert.ok(e.blind_spots.includes('fewer than three failures in a row'));
});

test('stale actions: a row past its attempt cap is the problem case, citing that row; the example holds the contract', () => {
  const s = json<StaleSnapshot>('examples/stale-actions.example.json');
  const r = staleReport(s, { now: new Date(s.captured_at) });
  const o = staleOutput(r, s, EMPTY);
  holds(o, r);
  if (r.counts.past_attempt_cap) {
    assert.equal(o.verdict, 'problem');
    assert.ok(o.evidence.some((e) => r.must_not_recycle.includes(e.id)));
  }
});

const NOW = '2026-10-27T15:00:00Z';
const ago = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
const stale = (rows: StaleSnapshot['scheduled_emails'], enabled = true): StaleSnapshot => ({
  captured_at: NOW, captured_by: 'test', scheduled_emails: rows,
  ai_agents: [{ id: 'id-timer', agent_name: RECOVERY_TIMER, status: 'idle', enabled, schedule: '*/15 * * * *', last_run_at: ago(4), updated_at: null }],
  ai_agent_activity_logs: [{ id: 'run-1', agent_id: 'id-timer', action: 'cron_run', result: 'success', created_at: ago(4) }],
});
const email = (id: string, mins: number, attempts = 0) => ({ id, channel: 'email', status: 'processing', attempts_made: attempts, max_attempts: 2, processing_started_at: ago(mins), processor_id: `p-${id}` });

test('stale actions: a disabled recovery timer is a problem citing its row; rows in flight with a running timer are ok', () => {
  const off = stale([email('a', 2)], false);
  const o = staleOutput(staleReport(off, { now: new Date(NOW) }), off, EMPTY);
  assert.equal(o.verdict, 'problem');
  assert.ok(o.evidence.some((e) => e.table === 'ai_agents' && e.id === 'id-timer'));
  const fine = stale([email('a', 2)]);
  const f = staleOutput(staleReport(fine, { now: new Date(NOW) }), fine, EMPTY);
  assert.equal(f.verdict, 'ok');
  assert.deepEqual(f.evidence.map((e) => e.id), ['a', 'id-timer']);
  const past = stale([email('b', 30)]);
  const p = staleOutput(staleReport(past, { now: new Date(NOW) }), past, EMPTY);
  assert.equal(p.verdict, 'problem');
  assert.ok(p.blind_spots.some((b) => /slow rather than stuck/.test(b)));
});

test('stale actions: nothing in processing and no recovery timer row is unknown, never ok', () => {
  const s: StaleSnapshot = { ...stale([]), ai_agents: [], ai_agent_activity_logs: [] };
  const r = staleReport(s, { now: new Date(NOW) });
  const o = staleOutput(r, s, EMPTY);
  holds(o, r);
  assert.equal(o.verdict, 'unknown');
});

test('overlap: a skip that is not logged is a blind spot; a logged skip is not', () => {
  const a = { ...overlap([], [unassessable('T')], []), skips: skipAnswer([
    { file: 'a.ts', line: 3, flag: 'busy', records: 'nothing' as const },
    { file: 'b.ts', line: 9, flag: 'running', records: 'log_line' as const },
  ]) };
  const out = overlapOutput(a, CAP, EMPTY);
  assert.deepEqual(out.blind_spots, ['T: no_agents_row', 'a.ts:3: skips a run while the last is still going; the skip is not logged (nothing)']);
});
