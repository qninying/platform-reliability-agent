import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { report, families, LIMITS, type DeadLetterSnapshot } from '../src/capabilities/deadLetterCapture.ts';
import { timerIndex, type TimerIndex } from '../src/inventory/timerHomes.ts';
import { recordsUnder, type RegistryEntry } from '../src/inventory/registrySource.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `
const UNINSTRUMENTED_AGENTS = new Set(['Plain']);
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'ViaRunAgent', hardcodedSchedule: '0 * * * *', runner: runOne, label: 'One' },
  { agentName: 'ViaConstant', hardcodedSchedule: '0 * * * *', runner: runTwo, label: 'Two' },
  { agentName: 'Scanner', hardcodedSchedule: '*/15 * * * *', runner: runScans, label: 'Scanner' },
  { agentName: 'Plain', hardcodedSchedule: '0 1 * * *', runner: runPlain, label: 'Plain' },
  { agentName: 'Tracked', hardcodedSchedule: '0 6 * * *', runner: () => trackAgentRun('Tracked', async () => { await go(); }), label: 'Tracked' },
  { agentName: 'Director', hardcodedSchedule: '0 9 * * 1', runner: async () => { const m = await import('./workforce/directorActions'); return m.runX(); }, label: 'Director' },
  { agentName: 'Mystery', hardcodedSchedule: '0 4 * * *', runner: runMystery, label: 'Mystery' },
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
cron.schedule('* * * * *', async () => { await evaluate(); });
`,
  [`${S}/aiOrchestrator.ts`]: `
export async function runOne(): Promise<void> {
  return runAgent('OneAgent', async () => { await go(); });
}
export async function runTwo(): Promise<void> {
  return runAgent(TWO_NAME, async () => { await go(); });
}
export async function runScans(): Promise<void> {
  const agent = await AiAgent.findOne({ where: { agent_name: 'Scanner' } });
}
`,
  [`${S}/schedulerService.ts`]: `
export function startScheduler() {
  cron.schedule('*/30 * * * *', () => { instrumentCronJob('Inline1', async () => { await one(); }); });
}
`,
  [`${S}/deadLetterService.ts`]: `export async function wrapWithDeadLetter(jobName, label, fn) { await fn(); }\n`,
  [`${S}/repoTree/refresh.ts`]: `export function start(schedule) { cron.schedule(schedule, () => { refresh(); }); }\n`,
  'backend/src/server.ts': `cron.schedule('*/5 * * * *', async () => { await rollup(); });\n`,
};
const reader = (files: Record<string, string>): Reader => ({
  read: (rel) => { if (!(rel in files)) throw new Error(`missing ${rel}`); return files[rel]; },
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir)).sort(),
});
const index = (files = FILES): TimerIndex => timerIndex(reader(files), 'abc123def');
const fam = (ix: TimerIndex, f: string) => families(ix).find((x) => x.family === f)!;
const snap = (): DeadLetterSnapshot => ({
  captured_at: '2026-10-30T12:00:00Z',
  captured_by: 'test',
  dead_letter_jobs: [
    { id: 'd1', job_name: 'Tracked', label: 'Tracked', consecutive_failures: 3, error_class: 'TypeError', resolved: false, resolved_at: null, created_at: '2026-10-28T01:00:00Z' },
    { id: 'd2', job_name: 'Tracked', label: 'Tracked', consecutive_failures: 3, error_class: 'TypeError', resolved: false, resolved_at: null, created_at: '2026-10-28T02:00:00Z' },
    { id: 'd3', job_name: 'Gone', label: null, consecutive_failures: 3, error_class: 'TypeError', resolved: true, resolved_at: '2026-10-29T00:00:00Z', created_at: '2026-10-27T01:00:00Z' },
    { id: 'd4', job_name: 'Director', label: 'Director', consecutive_failures: 3, error_class: 'TimeoutError', resolved: false, resolved_at: null, created_at: '2026-10-29T01:00:00Z' },
  ],
  publishing_jobs: [
    { id: 'p1', state: 'dead_lettered', last_error_class: 'RateLimitError', dead_lettered_at: '2026-10-29T09:00:00Z', dead_letter_reason: 'exhausted 3 attempts: RateLimitError' },
    { id: 'p2', state: 'failed', last_error_class: null, dead_lettered_at: '2026-10-29T10:00:00Z', dead_letter_reason: 'permanent: x' },
    { id: 'p3', state: 'published', last_error_class: 'Old', dead_lettered_at: null, dead_letter_reason: null },
  ],
});
const emptySnap = (): DeadLetterSnapshot => ({ ...snap(), dead_letter_jobs: [], publishing_jobs: [] });

test('acceptance: the report names the unwrapped job families explicitly, so an empty queue is never read as a healthy fleet', () => {
  const a = report(index(), emptySnap());
  assert.equal(a.verdict, 'queue_empty');
  assert.match(a.statement, /^Nothing is dead-lettered in either mechanism\. That does not mean the fleet is healthy\./);
  assert.match(a.statement, /Only 2 of 12 jobs can dead-letter\./);
  assert.match(a.statement, /wrapped_but_swallowed \(4\), dynamic_registry \(1\), inline \(1\), other_timers \(3\), unknown \(1\)/);
  assert.doesNotMatch(a.statement, /\b(healthy fleet|all clear|no problems)\b/i);
  const names = Object.fromEntries(a.coverage.families.map((f) => [f.family, f.jobs]));
  assert.deepEqual(names.wrapped_but_swallowed, ['Plain', 'Scanner', 'ViaConstant', 'ViaRunAgent']);
  assert.deepEqual(names.dynamic_registry, ['Brief']);
  assert.deepEqual(names.inline, ['Inline1']);
  assert.deepEqual(names.other_timers, ['backend/src/server.ts:1', `backend/src/services/aiOpsScheduler.ts:${timerIndexLine()}`, 'backend/src/services/repoTree/refresh.ts:1']);
  assert.deepEqual(names.unknown, ['Mystery']);
  assert.deepEqual(names.can_dead_letter, ['Director', 'Tracked']);
  assert.deepEqual(a.coverage.families.filter((f) => f.can_dead_letter === false).map((f) => f.family), ['wrapped_but_swallowed', 'dynamic_registry', 'inline', 'other_timers']);
  assert.equal(a.coverage.families.find((f) => f.family === 'unknown')!.can_dead_letter, null);
  assert.deepEqual([a.coverage.total_jobs, a.coverage.can_dead_letter, a.coverage.cannot_or_unknown], [12, 2, 10]);
  for (const f of a.coverage.families) assert.ok(f.why.length > 0, f.family);
});

function timerIndexLine(): number { return FILES[`${S}/aiOpsScheduler.ts`].split('\n').findIndex((l) => l.startsWith("cron.schedule('* * * * *'")) + 1; }

test('being wrapped is not being able to dead-letter: a runner that swallows its failure is reported as such', () => {
  const ix = index();
  const swallowed = fam(ix, 'wrapped_but_swallowed');
  assert.equal(swallowed.can_dead_letter, false);
  assert.match(swallowed.why, /catches the failure and never rethrows/);
  assert.ok(swallowed.jobs.includes('ViaRunAgent'), 'runAgent');
  assert.ok(swallowed.jobs.includes('Scanner'), 'its own row');
  assert.ok(swallowed.jobs.includes('Plain'), 'instrumentCronJob inside the wrapper');
  assert.ok(fam(ix, 'can_dead_letter').jobs.includes('Tracked'), 'trackAgentRun rethrows');
});

test('runAgent with the row name in a constant is read as runAgent, not unknown', () => {
  const entry: RegistryEntry = { agentName: 'X', schedule: '', registry: 'SCHEDULE_REGISTRY', runner: 'runTwo', line: 1 };
  assert.deepEqual(recordsUnder(entry, FILES[`${S}/aiOrchestrator.ts`], new Set()), { row: null, how: 'runAgent' });
});

test('a timer outside the registries is counted even when it passes a variable named schedule; only the registry starters are excluded', () => {
  const other = fam(index(), 'other_timers').jobs;
  assert.ok(other.includes('backend/src/server.ts:1'));
  assert.ok(other.includes(`backend/src/services/repoTree/refresh.ts:1`), other.join(', '));
  assert.ok(other.includes(`backend/src/services/aiOpsScheduler.ts:${timerIndexLine()}`));
  assert.equal(other.some((o) => /aiOpsScheduler\.ts:(2[0-9])$/.test(o) && !o.endsWith(`:${timerIndexLine()}`)), false, 'the starters are not listed');
});

test('rows are reported by error class, with each job, its family and the row ids, and both mechanisms stay separate', () => {
  const a = report(index(), snap());
  assert.equal(a.verdict, 'dead_lettered');
  assert.match(a.statement, /^4 row\(s\) in dead_letter_jobs and 2 in publishing_jobs\./);
  assert.match(a.statement, /Only 2 of 12 jobs can dead-letter/, 'the coverage is stated beside rows too');
  assert.deepEqual(a.dead_letter_jobs.by_class[0], {
    error_class: 'TypeError', rows: 3,
    jobs: [{ job: 'Gone', family: 'not_in_source', rows: 1 }, { job: 'Tracked', family: 'can_dead_letter', rows: 2 }],
    first_at: '2026-10-27T01:00:00Z', last_at: '2026-10-28T02:00:00Z', row_ids: ['d1', 'd2', 'd3'],
  });
  assert.equal(a.dead_letter_jobs.by_class[1].error_class, 'TimeoutError');
  assert.equal(a.dead_letter_jobs.marked_resolved, 1);
  assert.deepEqual(a.publishing_jobs, { rows: 2, by_class: [{ error_class: 'not recorded', rows: 1, row_ids: ['p2'] }, { error_class: 'RateLimitError', rows: 1, row_ids: ['p1'] }] });
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.ok(a.limits.some((l) => /no code sets it/.test(l)));
  assert.ok(a.limits.some((l) => /restart starts it again/.test(l)));
});

test('a publishing dead letter alone is not an empty queue', () => {
  const s = emptySnap();
  s.publishing_jobs = snap().publishing_jobs;
  assert.equal(report(index(), s).verdict, 'dead_lettered');
  const old = emptySnap();
  old.publishing_jobs = [snap().publishing_jobs[2]];
  assert.equal(report(index(), old).verdict, 'queue_empty');
});

test('error messages and stacks are never repeated, whatever the rows hold', () => {
  const s = snap();
  Object.assign(s.dead_letter_jobs[0], { error_message: 'PLANTED-MESSAGE', error_stack: 'PLANTED-STACK', context: { token: 'PLANTED-CONTEXT' } });
  Object.assign(s.publishing_jobs[0], { last_error: 'PLANTED-LAST' });
  assert.doesNotMatch(JSON.stringify(report(index(), s)), /PLANTED/);
});

test('if the wrapping moves, Ellis refuses rather than report families that no longer hold', () => {
  const dyn = { ...FILES, [`${S}/aiOpsScheduler.ts`]: FILES[`${S}/aiOpsScheduler.ts`].replace('instrumentCronJob(entry.agentName, entry.dynamicImport)', 'wrapWithDeadLetter(entry.agentName, entry.label, entry.dynamicImport)') };
  assert.throws(() => families(index(dyn)), /dead-letter wrapping has moved \(standard true, dynamic true/);
  const other = { ...FILES, [`${S}/new.ts`]: `cron.schedule('0 0 * * *', () => { wrapWithDeadLetter('N', 'N', go); });\n` };
  assert.throws(() => families(index(other)), /backend\/src\/services\/new\.ts:1/);
  const mention = { ...FILES, [`${S}/note.ts`]: `export const NOTE = 'wrapWithDeadLetter(job) is not a call here';\n` };
  assert.doesNotThrow(() => families(index(mention)), 'a name inside a string is not a call');
  const gone = { ...FILES, [`${S}/aiOpsScheduler.ts`]: FILES[`${S}/aiOpsScheduler.ts`].replace('function startStandardTask', 'function renamed') };
  assert.throws(() => families(index(gone)), /could not be read/);
  const unwrapped = { ...FILES, [`${S}/aiOpsScheduler.ts`]: FILES[`${S}/aiOpsScheduler.ts`].replace('wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()).catch(() => {});', 'entry.runner();') };
  assert.throws(() => families(index(unwrapped)), /standard false/);
});

test('the same inputs give the same answer twice, whatever order the rows are in, and reading them changes nothing', () => {
  const s = snap();
  const before = JSON.stringify(s);
  assert.deepEqual(report(index(), s), report(index(), s));
  assert.deepEqual(report(index(), { ...s, dead_letter_jobs: [...s.dead_letter_jobs].reverse(), publishing_jobs: [...s.publishing_jobs].reverse() }), report(index(), s));
  assert.equal(JSON.stringify(s), before);
});

test('CLI: exit 0 when something is dead-lettered, 4 when the queues are empty, 1 for bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ellis-dlq-'));
  for (const [rel, text] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  const file = join(dir, 'snap.json');
  const run = () => spawnSync(process.execPath, ['src/cli/deadLetters.ts', '--source', dir, '--snapshot', file], { encoding: 'utf8' });
  writeFileSync(file, JSON.stringify(snap()));
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verdict, 'dead_lettered');
  writeFileSync(file, JSON.stringify(emptySnap()));
  assert.equal(run().status, 4);
  const bad = JSON.parse(readFileSync(file, 'utf8'));
  delete bad.publishing_jobs;
  writeFileSync(file, JSON.stringify(bad));
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /a missing table is not an empty one/);
});
