import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { coverage, cronPathFiles, LIMITS, type CoverageSnapshot, type ActivityRow, type DeadLetterClassRow } from '../src/capabilities/errorClassCoverage.ts';
import { catchSites, kindOf } from '../src/inventory/catchSites.ts';
import { timerIndex } from '../src/inventory/timerHomes.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `export const SCHEDULE_REGISTRY: ScheduleEntry[] = [];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [];
function startStandardTask(entry, schedule) { const task = cron.schedule(schedule, () => { wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()).catch(() => {}); }); }
function startDynamicTask(entry, schedule) { const task = cron.schedule(schedule, () => { instrumentCronJob(entry.agentName, entry.dynamicImport); }); }
`,
  [`${S}/aiOrchestrator.ts`]: `export const x = 1;\n`,
  [`${S}/cronInstrumentation.ts`]: `export async function run() {
  try { await a(); } catch (err) { result = 'failed'; errorMsg = err.message; }
}
`,
  [`${S}/agentRunTracker.ts`]: `try { go(); } catch (err) { throw err; }\n`,
  [`${S}/deadLetterService.ts`]: `try { go(); } catch (err) { await DeadLetterJob.create({ error_class: err?.constructor?.name || 'Error' }); }\n`,
  [`${S}/schedulerService.ts`]: `export function startScheduler() {
  cron.schedule('*/30 * * * *', async () => {
    try { await instrumentCronJob('Inline1', one); } catch (err) { console.error(err.message); }
  });
  try { go(); } catch { /* non-critical */ }
  go().catch(handleIt);
}
`,
  'backend/src/server.ts': `app.get('/x', async () => { try { a(); } catch (e) { console.error(e); } });
cron.schedule('*/5 * * * *', async () => { try { b(); } catch (e) { logAiEvent('x', 'y', { error_class: 'TimeoutError' }); } });
`,
};
const reader = (files: Record<string, string>): Reader => ({
  read: (rel) => { if (!(rel in files)) throw new Error(`missing ${rel}`); return files[rel]; },
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir)).sort(),
});
const r = reader(FILES);
const ix = timerIndex(r, 'abc123def');
const run = (id: string, result = 'failed', cls?: unknown, created_at = '2026-10-30T01:00:00Z'): ActivityRow => ({ id, action: 'Job', result, details: cls === undefined ? null : { error_class: cls }, created_at });
const dl = (id: string, error_class: string | null, created_at = '2026-10-30T02:00:00Z'): DeadLetterClassRow => ({ id, job_name: 'Job', error_class, created_at });
const snap = (o: Partial<CoverageSnapshot> = {}): CoverageSnapshot => ({ captured_at: '2026-10-31T12:00:00Z', captured_by: 'test', ai_agent_activity_logs: [], dead_letter_jobs: [], ...o });
const answer = (s: CoverageSnapshot, window_days = 7) => coverage(r, ix, s, { window_days });

test('acceptance: coverage is a share of all recorded failures; a generic fallback counts as unclassified, not classified', () => {
  const a = answer(snap({ ai_agent_activity_logs: [run('a1'), run('a2'), run('a3', 'failed', 'RateLimitError')], dead_letter_jobs: [dl('d1', 'Error'), dl('d2', 'TimeoutError')] }));
  assert.deepEqual(a.coverage, { failures: 5, classified: 2, unclassified: 3, percent: 40 });
  assert.equal(a.verdict, 'measured');
  assert.match(a.statement, /^2 of 5 recorded failures carry a specific class \(40%\), counted over all recorded failures in 7 days\./);
  assert.deepEqual(a.by_store.dead_letter_jobs.unclassified_ids, ['d1']);
  assert.deepEqual(a.by_store.ai_agent_activity_logs.unclassified_ids, ['a1', 'a2']);
  assert.equal(a.by_store.dead_letter_jobs.generic, 1);
  assert.equal(a.by_store.ai_agent_activity_logs.no_class, 2);
});

test('every generic spelling is unclassified, whatever its case or padding', () => {
  for (const g of ['Error', 'error', ' ERROR ', 'Unknown', 'UnknownError', 'Exception', '', 'undefined', 'null', 'Object', 7, null]) {
    assert.equal(answer(snap({ ai_agent_activity_logs: [run('a', 'failed', g)] })).coverage.classified, 0, String(g));
  }
});

test('only failures are in the denominator, and every failure spelling is', () => {
  const a = answer(snap({ ai_agent_activity_logs: [run('a', 'success'), run('b', 'skipped'), run('c', 'failed'), run('d', 'failure'), run('e', 'error')] }));
  assert.equal(a.coverage.failures, 3);
});

test('the window bounds both stores, at its edges', () => {
  const a = answer(snap({ ai_agent_activity_logs: [run('old', 'failed', 'X', '2026-10-24T12:00:00Z'), run('edge', 'failed', 'X', '2026-10-24T12:00:01Z'), run('future', 'failed', 'X', '2026-10-31T12:00:01Z')], dead_letter_jobs: [dl('dold', 'X', '2026-10-01T00:00:00Z'), dl('dnew', 'X')] }));
  assert.equal(a.coverage.failures, 2);
  assert.equal(answer(snap({ dead_letter_jobs: [dl('dold', 'X', '2026-10-01T00:00:00Z')] }), 60).coverage.failures, 1);
});

test('no recorded failure is unknown, never 100%', () => {
  const a = answer(snap({ ai_agent_activity_logs: [run('a', 'success')] }));
  assert.equal(a.verdict, 'no_failures');
  assert.equal(a.coverage.percent, null);
  assert.match(a.statement, /coverage is unknown, not 100%/);
});

test('classes seen are listed by kind, and no vocabulary is assumed', () => {
  const a = answer(snap({ dead_letter_jobs: [dl('d1', 'TimeoutError'), dl('d2', 'TimeoutError'), dl('d3', 'TypeError'), dl('d4', 'SequelizeTimeoutError')] }));
  assert.deepEqual(a.classes.map((c) => [c.error_class, c.kind, c.rows]), [['TimeoutError', 'named_in_standard', 2], ['SequelizeTimeoutError', 'other', 1], ['TypeError', 'language_builtin', 1]]);
  assert.deepEqual(a.classes[0].row_ids, ['d1', 'd2']);
  assert.equal(a.vocabulary.decided, false);
  assert.equal(a.vocabulary.decided_by, 'K.D.');
});

test('acceptance: every catch site on the cron path that records no class is named', () => {
  const a = answer(snap());
  const at = (f: string) => a.catch_sites.records_no_class.filter((c) => c.file.endsWith(f)).map((c) => [c.line, c.kind]);
  assert.deepEqual(at('cronInstrumentation.ts'), [[2, 'records_no_class']]);
  assert.deepEqual(at('agentRunTracker.ts'), [[1, 'rethrows']]);
  assert.deepEqual(at('schedulerService.ts'), [[3, 'logs_only'], [5, 'silent'], [6, 'not_read']]);
  assert.deepEqual(at('deadLetterService.ts'), []);
  assert.equal(a.catch_sites.by_kind.class_may_be_generic, 1);
  assert.equal(a.catch_sites.by_kind.records_class, 1);
  assert.equal(a.catch_sites.no_class, a.catch_sites.total - a.catch_sites.records_class);
  assert.match(a.statement, new RegExp(`${a.catch_sites.no_class} of ${a.catch_sites.total} catch sites`));
});

test('outside the wrappers only catches inside a timer count, and every timer file is read', () => {
  const a = answer(snap());
  assert.deepEqual(a.catch_sites.records_no_class.filter((c) => c.file.endsWith('server.ts')), []);
  assert.ok(cronPathFiles(ix).includes('backend/src/server.ts'));
  assert.ok(cronPathFiles(ix).includes(`${S}/agentRunTracker.ts`));
});

test('the scanner ignores catch in comments and strings, and reads .catch handlers', () => {
  const sites = catchSites('f.ts', `// catch (e) { nothing }\nconst t = 'catch (e) { x }';\nconst u = ".catch(() => {})";\nfoo().catch((e) => { console.error(e); });\nbar().catch(() => {});\nbaz().catch(function (e) { throw e; });\ntry { a(); } catch (e) { b(); }\n`);
  assert.deepEqual(sites.map((c) => [c.line, c.kind]), [[4, 'logs_only'], [5, 'silent'], [6, 'rethrows'], [7, 'silent']]);
});

test('a handler is read by what it names, class first', () => {
  assert.equal(kindOf('{ log({ error_class: classify(e) }); throw e; }'), 'records_class');
  assert.equal(kindOf("{ x({ error_class: e.name || 'Error' }); }"), 'class_may_be_generic');
  assert.equal(kindOf('{ x({ errorClass: e.constructor.name }); }'), 'class_may_be_generic');
  assert.equal(kindOf('{ await agent.update({ last_error: e.message }); throw e; }'), 'records_no_class');
  assert.equal(kindOf('{ console.error(e); throw e; }'), 'rethrows');
  assert.equal(kindOf('{ logger.warn(e); }'), 'logs_only');
  assert.equal(kindOf('{ }'), 'silent');
});

test('every answer carries its limits, and error text never appears', () => {
  const a = answer(snap({ ai_agent_activity_logs: [{ ...run('a'), details: { error_class: 'X', message: 'leaky-detail-text' } as ActivityRow['details'] }] }));
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.ok(!JSON.stringify(a).includes('leaky-detail-text'));
});

test('cli: exit 3 unclassified, 0 all classified, 4 no failures, 1 for bad input', () => {
  const root = mkdtempSync(join(tmpdir(), 'ecc-'));
  for (const [f, text] of Object.entries(FILES)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); }
  const go = (s: unknown, ...more: string[]) => { const p = join(root, 's.json'); writeFileSync(p, JSON.stringify(s)); return spawnSync('node', ['src/cli/errorClassCoverage.ts', '--source', root, '--snapshot', p, ...more], { encoding: 'utf8' }); };
  assert.equal(go(snap({ dead_letter_jobs: [dl('d', 'Error')] })).status, 3);
  assert.equal(go(snap({ dead_letter_jobs: [dl('d', 'TimeoutError')] })).status, 0);
  assert.equal(go(snap()).status, 4);
  const bad = go({ captured_at: '2026-10-31T12:00:00Z', ai_agent_activity_logs: [] });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /dead_letter_jobs/);
  assert.equal(go(snap(), '--window-days', '0').status, 1);
  assert.equal(go({ ...snap(), captured_at: 'nope' }).status, 1);
});

test('the shipped example is labelled and counts as its write-up says', () => {
  const s = JSON.parse(readFileSync('examples/error-class-coverage.example.json', 'utf8')) as CoverageSnapshot;
  assert.match(s.captured_by, /not production data/);
  assert.deepEqual(answer(s).coverage, { failures: 7, classified: 3, unclassified: 4, percent: 42.9 });
});
