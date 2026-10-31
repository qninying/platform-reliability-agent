import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, findClaim, verdictOf, CASES, LIMITS } from '../src/capabilities/idempotencyAudit.ts';
import { twiceRun, World, endState, type Job, type Check } from '../src/sandbox/twiceRun.ts';
import { FIXTURE, NOTHING_DUE, claimedPublish, unclaimedPublish, unguardedPublish, brokenPublish } from '../src/sandbox/publishingJobs.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

const WORKER = 'backend/src/services/publishing/publishingWorker.ts';
const SRC = `export async function runDueJobs() {
  for (const job of due) {
    const previous = job.state;
    // where: { id: job.id } in a comment is not the claim
    const [claimedRows] = await PublishingJob.update(
      { state: 'claimed', claimed_by: deps.workerId, claimed_at: now },
      { where: { id: job.id, state: previous } },
    );
  }
}
`;
const reader = (text: string): Reader => ({ read: () => text, list: () => [WORKER] });
const c = (mode: Check['mode']): Check => ({ mode, why: '', differences: [] });

test('acceptance: the harness detects a deliberately non-idempotent fixture job as unsafe; if it cannot fail, it cannot pass', async () => {
  const r = await twiceRun(unguardedPublish, FIXTURE);
  assert.equal(r.sequential.mode, 'unsafe');
  assert.ok(r.sequential.differences.includes('job-done:post: 1 after one run, 2 after this'), r.sequential.differences.join('; '));
  const a = await audit(reader(SRC), 'abc');
  assert.equal(a.verdict, 'harness_proven');
  assert.equal(a.fixture_jobs.find((j) => j.job === 'unguarded_publish')!.verdict, 'unsafe');
  // A world where the harness cannot see the fault: the unsafe job is expected safe, and the run is refused.
  const blind = await audit(reader(SRC), 'abc', [{ ...CASES[2], expected: 'safe' }]);
  assert.equal(blind.verdict, 'harness_cannot_fail');
  assert.match(blind.statement, /nothing it says can be relied on/);
  const none = await audit(reader(SRC), 'abc', [CASES[0]]);
  assert.equal(none.verdict, 'harness_cannot_fail');
});

test('the claimed job is safe in sequence and at once, and posts each due job once', async () => {
  const r = await twiceRun(claimedPublish, FIXTURE);
  assert.equal(r.sequential.mode, 'safe');
  assert.equal(r.overlap.mode, 'safe');
  const w = new World(FIXTURE);
  await claimedPublish(w, 'a');
  assert.deepEqual(w.effects.map((e) => e.row_id).sort(), ['job-due-1', 'job-due-2']);
  assert.equal(w.rows.get('job-future')!.state, 'pending');
});

test('a run-twice pass does not cover overlap: a job with no claim is caught only at once', async () => {
  const r = await twiceRun(unclaimedPublish, FIXTURE);
  assert.equal(r.sequential.mode, 'safe');
  assert.equal(r.overlap.mode, 'unsafe');
  assert.ok(r.overlap.differences.includes('job-due-1:post: 1 after one run, 2 after this'));
});

test('a run that changed nothing, or threw, is unknown, never safe', async () => {
  const idle = await twiceRun(claimedPublish, NOTHING_DUE);
  assert.deepEqual([idle.sequential.mode, idle.overlap.mode], ['unknown', 'unknown']);
  assert.match(idle.sequential.why, /changed nothing/);
  const failed = await twiceRun(brokenPublish, FIXTURE);
  assert.equal(failed.sequential.mode, 'unknown');
  assert.match(failed.sequential.why, /first run threw TypeError/);
  let runs = 0;
  const failsOnRepeat: Job = async (w) => { if (runs++ % 2 === 1) throw new TypeError('second'); w.emit({ row_id: 'x', kind: 'post' }); };
  const repeat = await twiceRun(failsOnRepeat, FIXTURE);
  assert.equal(repeat.sequential.mode, 'unknown');
  assert.match(repeat.sequential.why, /repeat threw TypeError/);
});

test('each run starts from a fresh copy, and a state change with no effect is seen', async () => {
  const before = JSON.stringify(FIXTURE);
  await twiceRun(unguardedPublish, FIXTURE);
  assert.equal(JSON.stringify(FIXTURE), before);
  let n = 0;
  const counts: Job = async (w) => { n += 1; w.update('job-due-1', () => true, { state: `s${n}` }); };
  const r = await twiceRun(counts, FIXTURE);
  assert.equal(r.sequential.mode, 'unsafe');
  assert.deepEqual(r.sequential.differences, ['row job-due-1 differs']);
});

test('end state ignores row and key order, and counts effects', () => {
  const a = new World({ rows: [{ id: 'a', x: 1, y: 2 }, { id: 'b' }] });
  const b = new World({ rows: [{ id: 'b' }, { id: 'a', y: 2, x: 1 }] });
  assert.equal(endState(a), endState(b));
  a.emit({ row_id: 'a', kind: 'post' });
  assert.notEqual(endState(a), endState(b));
});

test('verdicts join both checks, and the weaker one decides', () => {
  assert.equal(verdictOf(c('safe'), c('safe')), 'safe');
  assert.equal(verdictOf(c('safe'), c('unsafe')), 'safe_in_sequence_only');
  assert.equal(verdictOf(c('unsafe'), c('safe')), 'unsafe');
  assert.equal(verdictOf(c('unknown'), c('safe')), 'unknown');
  assert.equal(verdictOf(c('safe'), c('unknown')), 'unknown');
});

test('no platform job gets a verdict from a fixture', async () => {
  const a = await audit(reader(SRC), 'abc');
  assert.equal(a.platform_jobs.verdict, 'unknown');
  assert.equal(a.evidence_kind, 'twice_run_on_fixture');
  assert.match(a.statement, /This proves the harness, not any platform job: all stay unknown/);
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.deepEqual(a.fixture_jobs.map((j) => [j.job, j.verdict]), [['claimed_publish', 'safe'], ['unclaimed_publish', 'safe_in_sequence_only'], ['unguarded_publish', 'unsafe'], ['nothing_to_do', 'unknown'], ['throws', 'unknown']]);
});

test('the claim the model stands for is found in the source, and a moved claim is refused', async () => {
  assert.deepEqual(findClaim(reader(SRC)), { file: WORKER, line: 7 });
  assert.throws(() => findClaim(reader('// { where: { id: job.id, state: previous } }\nconst x = 1;\n')), /no longer in/);
  await assert.rejects(audit(reader('nothing'), 'abc'), /no longer in/);
});

test('cli: exit 0 when proven, 1 when the claim has moved or the source is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-'));
  const go = (text: string) => { mkdirSync(dirname(join(root, WORKER)), { recursive: true }); writeFileSync(join(root, WORKER), text); writeFileSync(join(root, 'backend/src/services/aiOpsScheduler.ts'), ''); return spawnSync('node', ['src/cli/replayHarness.ts', '--source', root], { encoding: 'utf8' }); };
  const ok = go(SRC);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /harness_proven/);
  assert.equal(go('nothing').status, 1);
  assert.equal(spawnSync('node', ['src/cli/replayHarness.ts'], { encoding: 'utf8' }).status, 1);
});
