import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, verdictOf, checkFixture, loadAuditFixture, MODELS, type AuditFixture } from '../src/capabilities/replayVerdicts.ts';
import { twiceRun, World } from '../src/sandbox/twiceRun.ts';
import { previewReaper, retentionSweep, staleRecovery, REAP_FIXTURE, RETENTION_FIXTURE, STALE_FIXTURE } from '../src/sandbox/platformJobs.ts';
import { unclaimedPublish, NOTHING_DUE } from '../src/sandbox/publishingJobs.ts';
import { auditRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixtures are sandbox models with invented rows: not production data.
const FIXTURE = 'examples/replay-audit.fixture.json';
const load = (): AuditFixture => loadAuditFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const byJob = (r: Awaited<ReturnType<typeof rehearse>>, j: string) => r.jobs.find((x) => x.job === j)!;

test('acceptance (R4): each verdict is safe, unsafe or untestable-in-sandbox with the reason; no job is reported safe on a documented mechanism alone', async () => {
  const r = await rehearse(load());
  assert.equal(r.verified, true, r.statement);
  for (const j of r.jobs) {
    assert.ok(['safe', 'unsafe', 'untestable_in_sandbox'].includes(j.verdict), j.job);
    assert.ok(j.reason.length > 20, `${j.job} has a reason`);
    if (j.verdict === 'safe') assert.deepEqual([j.sequential!.mode, j.overlap!.mode], ['safe', 'safe'], j.job);
  }
  assert.match(r.statement, /Safe: publishing_worker, stale_action_recovery, intelligence_retention\. Unsafe: preview_stack_reaper\. Untestable in a sandbox: openclaw_content_response\./);
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
});

test('the preview reaper has a guard in its code and is still unsafe: two runs at once both pass the running check and stop the stack twice', async () => {
  const j = byJob(await rehearse(load()), 'preview_stack_reaper');
  assert.equal(j.guard_in_code, 'stopStack returns early when the stack is not running');
  assert.deepEqual([j.verdict, j.sequential!.mode, j.overlap!.mode], ['unsafe', 'safe', 'unsafe']);
  assert.deepEqual(j.overlap!.differences, ['stack-idle:compose_stop: 1 after one run, 2 after this', 'stack-idle:stop_event: 1 after one run, 2 after this']);
  assert.match(j.reason, /safe twice in a row, but two runs at once changed the end state.*no overlap guard/);
});

test('stale recovery, the publishing claim and the retention sweep end where one run ends, in a row and at once', async () => {
  for (const [job, fixture] of [[staleRecovery, STALE_FIXTURE], [retentionSweep, RETENTION_FIXTURE]] as const) {
    const t = await twiceRun(job, fixture);
    assert.deepEqual([t.sequential.mode, t.overlap.mode], ['safe', 'safe']);
  }
  const w = new World(STALE_FIXTURE);
  await staleRecovery(w, 'a');
  assert.deepEqual([...w.rows.values()].map((r) => [r.id, r.status, r.attempts_made]), [['email-stale', 'pending', 1], ['email-last-try', 'failed', 3], ['email-fresh', 'processing', 0], ['email-pending', 'pending', 0]]);
  const ret = new World(RETENTION_FIXTURE);
  await retentionSweep(ret, 'a');
  assert.deepEqual([...ret.rows.keys()].sort(), ['archive:dec-old-1', 'archive:dec-old-2', 'dec-new']);
  const late = new World(REAP_FIXTURE);
  await Promise.all([previewReaper(late, 'a'), (async () => { late.update('stack-idle', () => true, { status: 'stopped' }); })()]);
  assert.deepEqual(late.effects, [], 'a stack stopped after the candidates were read is skipped by the running check');
  const reap = new World(REAP_FIXTURE);
  await previewReaper(reap, 'a');
  assert.deepEqual([reap.rows.get('stack-idle')!.status, reap.rows.get('stack-busy')!.status, reap.effects.length], ['stopped', 'running', 2]);
});

test('the sandbox world refuses a second row with the same id, and removes a row only while it still matches', () => {
  const w = new World({ rows: [{ id: 'a', v: 1 }] });
  assert.equal(w.insert({ id: 'a', v: 2 }), 0);
  assert.equal(w.rows.get('a')!.v, 1);
  assert.equal(w.insert({ id: 'b', v: 1 }), 1);
  assert.equal(w.remove('a', (r) => r.v === 9), 0);
  assert.ok(w.rows.has('a'));
  assert.equal(w.remove('a', (r) => r.v === 1), 1);
  assert.equal(w.remove('missing', () => true), 0);
});

test('the content agent is untestable in a sandbox, with the reason, and nothing was compared for it', async () => {
  const j = byJob(await rehearse(load()), 'openclaw_content_response');
  assert.deepEqual([j.verdict, j.sequential, j.overlap], ['untestable_in_sandbox', null, null]);
  assert.match(j.reason, /a model writes on each run/);
});

test('the verdict needs both comparisons: unsafe in a row, unsafe at once, and anything unsettled is unknown, never safe', () => {
  const c = (mode: 'safe' | 'unsafe' | 'unknown', why = 'w') => ({ mode, why, differences: ['d1', 'd2', 'd3', 'd4'] });
  assert.equal(verdictOf(c('safe'), c('safe')).verdict, 'safe');
  assert.equal(verdictOf(c('unsafe'), c('safe')).verdict, 'unsafe');
  assert.match(verdictOf(c('unsafe'), c('unsafe')).reason, /^a second run in a row changed the end state: d1; d2; d3$/);
  assert.equal(verdictOf(c('safe'), c('unsafe')).verdict, 'unsafe');
  assert.deepEqual(verdictOf(c('unknown', 'first'), c('safe')), { verdict: 'unknown', reason: 'first' });
  assert.deepEqual(verdictOf(c('safe'), c('unknown', 'second')), { verdict: 'unknown', reason: 'second' });
});

test('a job whose fixture exercises nothing is unknown, so it fails its check rather than passing as safe', async () => {
  const models = { ...MODELS, publishing_worker: { ...MODELS.publishing_worker, fixture: NOTHING_DUE } } as typeof MODELS;
  const r = await rehearse(load(), models);
  assert.equal(byJob(r, 'publishing_worker').verdict, 'unknown');
  assert.equal(r.checks.publishing_worker, false);
});

test('with the claim taken away, the publishing worker is unsafe at once; without the control and the reaper, nothing unsafe is caught', async () => {
  const models = { ...MODELS, publishing_worker: { ...MODELS.publishing_worker, run: unclaimedPublish } } as typeof MODELS;
  assert.equal(byJob(await rehearse(load(), models), 'publishing_worker').verdict, 'unsafe');
  const r = await rehearse({ ...load(), jobs: load().jobs.filter((j) => j.expect !== 'unsafe') });
  assert.equal(r.checks.harness_caught_an_unsafe_job, false);
  assert.equal(r.verified, false);
});

test('a job expected safe that cannot be run in a sandbox fails its check', async () => {
  const untestable = { ...MODELS, stale_action_recovery: { ...MODELS.openclaw_content_response, job: 'stale_action_recovery' } } as typeof MODELS;
  const u = await rehearse(load(), untestable);
  assert.equal(byJob(u, 'stale_action_recovery').verdict, 'untestable_in_sandbox');
  assert.equal(u.checks.stale_action_recovery, false);
  assert.match(u.statement, /not verified: stale_action_recovery/);
});

test('the same fixture always gives the same verdicts, and the fixture itself is not changed', async () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(await rehearse(f), await rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified audit is ok citing each job, and the untestable job is a blind spot; a wrong verdict is the evidence when it fails', async () => {
  const c = { captured_at: '2026-11-05T14:00:00Z', captured_by: 'test' };
  const r = await rehearse(load());
  const o = auditRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 6);
  assert.match(o.as_of.note!, /sandbox fixture replay-audit-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 5);
  assert.match(o.blind_spots[0], /^openclaw_content_response: untestable in a sandbox, because its end state holds text/);
  const wrong = await rehearse({ ...load(), jobs: load().jobs.map((j) => (j.job === 'preview_stack_reaper' ? { ...j, expect: 'safe' as const } : j)) });
  const f = auditRehearsalOutput(wrong, c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((x) => x.id), ['preview_stack_reaper']);
});

test('a fixture is refused with no jobs, an unmodelled job, a missing expectation or a job listed twice; the command exits 0, 3 and 1', () => {
  const base = load();
  for (const f of [{ ...base, jobs: [] }, { ...base, fixture_id: 1 as never }, { ...base, jobs: [{ job: 'nope', expect: 'safe' as const }] }, { ...base, jobs: [{ job: 'publishing_worker', expect: 'maybe' as never }] }, { ...base, jobs: [{ job: 1 as never, expect: 'safe' as const }] }]) {
    assert.throws(() => checkFixture(f, 'inline'), /needs|not a modelled job/);
  }
  assert.throws(() => checkFixture({ ...base, jobs: [base.jobs[0], base.jobs[0]] }, 'inline'), /listed once/);
  assert.equal(checkFixture(base, 'inline').jobs.length, 6);
  const ok = spawnSync(process.execPath, ['src/cli/replayVerdicts.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const not = spawnSync(process.execPath, ['src/cli/replayVerdicts.ts', '--fixture', 'test/fixtures/replay-audit-no-unsafe.json'], { encoding: 'utf8' });
  assert.equal(not.status, 3, not.stderr);
  assert.equal(spawnSync(process.execPath, ['src/cli/replayVerdicts.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/replayVerdicts.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
