import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { triage, CONDITIONS, LIMITS, type TriageSnapshot, type TriageDeadLetterRow, type TriagePublishingRow } from '../src/capabilities/deadLetterTriage.ts';
import { timerIndex } from '../src/inventory/timerHomes.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'ViaRunAgent', hardcodedSchedule: '0 * * * *', runner: runOne, label: 'One' },
  { agentName: 'Tracked', hardcodedSchedule: '0 6 * * *', runner: () => trackAgentRun('Tracked', async () => { await go(); }), label: 'Tracked' },
  { agentName: 'Tracked2', hardcodedSchedule: '0 7 * * *', runner: () => trackAgentRun('Tracked2', async () => { await go(); }), label: 'Tracked2' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  { agentName: 'Brief', hardcodedSchedule: '45 6 * * *', dynamicImport: async () => { await brief(); }, label: 'Briefing' },
];
function startStandardTask(entry: ScheduleEntry, schedule: string): void {
  const task = cron.schedule(schedule, () => { wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()).catch(() => {}); });
}
function startDynamicTask(entry: DynamicScheduleEntry, schedule: string): void {
  const task = cron.schedule(schedule, () => { instrumentCronJob(entry.agentName, entry.dynamicImport); });
}
`,
  [`${S}/aiOrchestrator.ts`]: `export async function runOne(): Promise<void> { return runAgent('OneAgent', async () => { await go(); }); }\n`,
  [`${S}/schedulerService.ts`]: `export function startScheduler() {
  cron.schedule('*/30 * * * *', () => { instrumentCronJob('Inline1', async () => { await one(); }); });
}\n`,
};
const reader = (files: Record<string, string>): Reader => ({
  read: (rel) => { if (!(rel in files)) throw new Error(`missing ${rel}`); return files[rel]; },
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir)).sort(),
});
const ix = () => timerIndex(reader(FILES), 'abc123def');
const dl = (id: string, job: string, error_class = 'TimeoutError', o: Partial<TriageDeadLetterRow> = {}): TriageDeadLetterRow =>
  ({ id, job_name: job, label: job, consecutive_failures: 3, error_class, error_message: 'timed out after 30000 ms', resolved: false, resolved_at: null, created_at: '2026-10-29T01:00:00Z', ...o });
const pub = (id: string, state: string, o: Partial<TriagePublishingRow> = {}): TriagePublishingRow =>
  ({ id, state, provider: 'linkedin', last_error_class: 'TimeoutError', last_error: 'timed out after 500 ms', dead_lettered_at: '2026-10-29T02:00:00Z', dead_letter_reason: 'leaky-reason-text', ...o });
const snap = (o: Partial<TriageSnapshot> = {}): TriageSnapshot => ({ captured_at: '2026-10-30T12:00:00Z', captured_by: 'test', dead_letter_jobs: [], publishing_jobs: [], ai_agents: [], ...o });
const entry = (a: ReturnType<typeof triage>, job: string) => a.queue.flatMap((g) => g.entries).find((e) => e.job === job)!;
const clean = { agent_name: 'Tracked', last_run_at: '2026-10-30T01:00:00Z', last_error_at: '2026-10-29T00:59:59Z' };

test("acceptance: an empty queue is reported as 'empty, and here is what could not have reached it', never as a healthy fleet", () => {
  const a = triage(ix(), snap());
  assert.equal(a.verdict, 'queue_empty');
  assert.match(a.statement, /^The queue is empty, and here is what could not have reached it\./);
  assert.match(a.statement, /This is not a healthy fleet\./);
  assert.match(a.statement, /wrapped_but_swallowed \(1\)/);
  assert.match(a.statement, /dynamic_registry \(1\)/);
  assert.match(a.statement, /inline \(1\)/);
  assert.match(a.statement, /Also out of reach: .*fewer than three times in a row/);
  assert.equal(a.could_not_have_reached.cannot_or_unknown, 3);
  assert.equal(a.could_not_have_reached.of, 5);
  assert.deepEqual(a.could_not_have_reached.conditions, [...CONDITIONS]);
  assert.ok(a.could_not_have_reached.families.find((f) => f.family === 'inline')!.jobs.includes('Inline1'));
});

test('a queue with only closed entries is still empty, and says what closed them', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'X', { resolved: true })], publishing_jobs: [pub('p1', 'cancelled')] }));
  assert.equal(a.verdict, 'queue_empty');
  assert.deepEqual(a.queue, []);
  assert.deepEqual(a.closed, { marked_resolved: ['d1'], publishing_cancelled: ['p1'] });
});

test('both stores read as one queue: one error class is one group across them', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked'), dl('d2', 'Tracked2'), dl('d3', 'Tracked', 'Other')], publishing_jobs: [pub('p1', 'dead_lettered')] }));
  assert.equal(a.verdict, 'queue_open');
  assert.deepEqual(a.queue.map((g) => [g.error_class, g.rows, g.jobs]), [['TimeoutError', 3, 3], ['Other', 1, 1]]);
  assert.deepEqual(a.queue[0].stores, ['dead_letter_jobs', 'publishing_jobs']);
  assert.match(a.statement, /^4 open in 2 error class\(es\)\. 2 of 5 jobs can reach this queue/);
});

test('a publishing job that retried away or never dead-lettered is not in the queue', () => {
  const a = triage(ix(), snap({ publishing_jobs: [pub('p1', 'pending', { dead_lettered_at: null }), pub('p2', 'published', { dead_lettered_at: '2026-10-29T02:00:00Z' })] }));
  assert.equal(a.verdict, 'queue_empty');
  assert.deepEqual(a.closed.publishing_cancelled, []);
});

test('each job proposal follows what its run record shows since the last dead letter', () => {
  const at = '2026-10-29T01:00:00Z';
  const of = (agent: TriageSnapshot['ai_agents'][number] | null) => entry(triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked')], ai_agents: agent ? [agent] : [] })), 'Tracked');
  assert.deepEqual([of(clean).since_last_dead_letter, of(clean).proposal], ['ran_clean', 'abandon']);
  const failing = of({ agent_name: 'Tracked', last_run_at: '2026-10-30T01:00:00Z', last_error_at: '2026-10-30T01:00:00Z' });
  assert.deepEqual([failing.since_last_dead_letter, failing.proposal], ['still_failing', 'fix_and_replay']);
  const noRun = of({ agent_name: 'Tracked', last_run_at: at, last_error_at: at });
  assert.deepEqual([noRun.since_last_dead_letter, noRun.proposal], ['no_run_since', 'read_first']);
  const never = of({ agent_name: 'Tracked', last_run_at: '2026-10-30T01:00:00Z', last_error_at: null });
  assert.equal(never.since_last_dead_letter, 'ran_clean');
  assert.deepEqual([of(null).since_last_dead_letter, of(null).proposal], ['not_readable', 'read_first']);
});

test('since is measured from the latest dead letter of that job', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'X', { created_at: '2026-10-28T00:00:00Z' }), dl('d2', 'Tracked', 'X', { created_at: '2026-10-30T02:00:00Z' })], ai_agents: [clean] }));
  assert.equal(entry(a, 'Tracked').since_last_dead_letter, 'no_run_since');
  assert.equal(entry(a, 'Tracked').last_at, '2026-10-30T02:00:00Z');
});

test('a job no timer carries is proposed for abandon, with its reason', () => {
  const e = entry(triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Gone')], ai_agents: [{ ...clean, agent_name: 'Gone' }] })), 'Gone');
  assert.deepEqual([e.family, e.proposal, e.since_last_dead_letter], ['not_in_source', 'abandon', null]);
});

test('publishing entries split by kind: permanent needs a fix, exhausted can be replayed', () => {
  const a = triage(ix(), snap({ publishing_jobs: [pub('p1', 'failed'), pub('p2', 'dead_lettered')] }));
  const es = a.queue[0].entries;
  assert.deepEqual(es.map((e) => [e.row_ids[0], e.proposal]), [['p1', 'fix_and_replay'], ['p2', 'recover_by_replay']]);
  assert.match(es[1].how_a_person_acts, /Retrying publishes outward/);
});

test('every answer keeps the decision human and replay unproven', () => {
  const a = triage(ix(), snap({ publishing_jobs: [pub('p2', 'dead_lettered')] }));
  assert.equal(a.decision.decided_by, 'a person, at every autonomy level');
  assert.equal(a.decision.replay_safety, 'unproven');
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.match(LIMITS.join(' '), /idempotency/);
});

test('distinct errors count messages, ignoring ids and numbers, and name a shared fault', () => {
  const same = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked'), dl('d2', 'Tracked2', 'TimeoutError', { error_message: 'timed out after 90 ms' })] }));
  assert.equal(same.queue[0].distinct_errors, 1);
  assert.match(same.queue[0].note!, /2 jobs share one error/);
  const ids = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'X', { error_message: 'row 123e4567-e89b-12d3-a456-426614174000 bad' }), dl('d2', 'Tracked', 'X', { error_message: 'row 00000000-0000-0000-0000-00000000abcd bad' })] }));
  assert.equal(ids.queue[0].distinct_errors, 1);
  const two = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked'), dl('d2', 'Tracked2', 'TimeoutError', { error_message: 'other' })] }));
  assert.equal(two.queue[0].distinct_errors, 2);
  assert.equal(two.queue[0].note, null);
  const across = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked')], publishing_jobs: [pub('p1', 'failed', { last_error: 'something else' })] }));
  assert.equal(across.queue[0].distinct_errors, 2);
  const missing = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'X', { error_message: undefined })] }));
  assert.equal(missing.queue[0].distinct_errors, null);
});

test('a broad class is flagged instead of read as one fault', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'TypeError'), dl('d2', 'Tracked2', 'TypeError')], publishing_jobs: [pub('p1', 'failed', { last_error_class: null })] }));
  const g = a.queue.find((x) => x.error_class === 'TypeError')!;
  assert.equal(g.broad_class, true);
  assert.match(g.note!, /too broad/);
  assert.equal(a.queue.find((x) => x.error_class === 'not recorded')!.broad_class, true);
});

test('messages, reasons and stacks never leave the module', () => {
  const out = JSON.stringify(triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked', 'X', { error_message: 'leaky-message-text' })], publishing_jobs: [pub('p1', 'failed', { last_error: 'leaky-last-error', dead_letter_reason: 'leaky-reason-text' })] })));
  for (const leak of ['leaky-message-text', 'leaky-last-error', 'leaky-reason-text']) assert.ok(!out.includes(leak), leak);
});

test('a job is read under the ai_agents row it records to, not its registry name', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'ViaRunAgent')], ai_agents: [{ ...clean, agent_name: 'OneAgent' }, { agent_name: 'ViaRunAgent', last_run_at: null, last_error_at: null }] }));
  assert.equal(entry(a, 'ViaRunAgent').since_last_dead_letter, 'ran_clean');
  assert.equal(entry(a, 'ViaRunAgent').family, 'wrapped_but_swallowed');
});

test('a failure writes both stamps close together; a clean run leaves a gap', () => {
  const of = (error: string) => entry(triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked')], ai_agents: [{ agent_name: 'Tracked', last_run_at: '2026-10-30T01:00:03Z', last_error_at: error }] })), 'Tracked').since_last_dead_letter;
  assert.equal(of('2026-10-30T01:00:02Z'), 'still_failing');
  assert.equal(of('2026-10-30T01:00:04Z'), 'still_failing');
  assert.equal(of('2026-10-30T00:00:00Z'), 'ran_clean');
});

test('a shared error across jobs is only called one fault with more than one job', () => {
  const a = triage(ix(), snap({ dead_letter_jobs: [dl('d1', 'Tracked'), dl('d2', 'Tracked')] }));
  assert.equal(a.queue[0].note, null);
});

test('entries from different publishing providers stay apart', () => {
  const a = triage(ix(), snap({ publishing_jobs: [pub('p1', 'failed'), pub('p2', 'failed', { provider: 'x' }), pub('p3', 'failed', { provider: null })] }));
  assert.deepEqual(a.queue[0].entries.map((e) => e.job), ['publishing:linkedin', 'publishing:not recorded', 'publishing:x']);
  assert.equal(a.queue[0].jobs, 3);
  assert.deepEqual(a.queue[0].entries.map((e) => e.row_ids), [['p1'], ['p3'], ['p2']]);
});

test('moved dead-letter wrapping is refused, not guessed', () => {
  const moved = { ...FILES, [`${S}/aiOpsScheduler.ts`]: FILES[`${S}/aiOpsScheduler.ts`].replace('wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()).catch(() => {});', 'entry.runner();') };
  assert.throws(() => triage(timerIndex(reader(moved), 'x'), snap()), /moved/);
});

test('cli: exit 0 open, 4 empty, 1 for a missing table', () => {
  const root = mkdtempSync(join(tmpdir(), 'triage-'));
  for (const [f, text] of Object.entries(FILES)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); }
  const run = (s: unknown) => { const p = join(root, 's.json'); writeFileSync(p, JSON.stringify(s)); return spawnSync('node', ['src/cli/deadLetterTriage.ts', '--source', root, '--snapshot', p], { encoding: 'utf8' }); };
  assert.equal(run(snap({ dead_letter_jobs: [dl('d1', 'Tracked')] })).status, 0);
  const empty = run(snap());
  assert.equal(empty.status, 4);
  assert.match(empty.stdout, /could not have reached it/);
  const bad = run({ captured_at: '2026-10-30T12:00:00Z', dead_letter_jobs: [], publishing_jobs: [] });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ai_agents/);
});

test('the shipped example has real shape', () => {
  const s = JSON.parse(readFileSync('examples/dead-letter-triage.example.json', 'utf8')) as TriageSnapshot;
  assert.match(s.captured_by, /not production data/);
  assert.equal(s.dead_letter_jobs.length, 5);
});
