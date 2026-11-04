import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, loadReapFixture, candidates, PLATFORM_IDLE_MINUTES, type ReapFixture, type SeededStack, type Container } from '../src/capabilities/previewReapRehearsal.ts';
import { reapRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox inventory with invented slugs and paths: not production data.
const FIXTURE = 'examples/preview-reap.fixture.json';
const load = (): ReapFixture => loadReapFixture(FIXTURE);
const NOW = '2026-11-04T15:00:00Z';
const ago = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
const stack = (slug: string, expect: SeededStack['expect'], over: Partial<SeededStack> = {}): SeededStack =>
  ({ id: `id-${slug}`, slug, expect, status: 'running', last_accessed_at: ago(60), last_started_at: ago(300), last_stopped_at: null, stack_path: `/stacks/${slug}/repo`, ...over });
const boxes = (slug: string, n: number, state: Container['state'] = 'running'): Container[] => Array.from({ length: n }, (_, i) => ({ id: `${slug}-${i}`, stack: slug, service: `s${i}`, state }));
const fx = (stacks: SeededStack[], containers: Container[], interrupt: ReapFixture['interrupt']): ReapFixture => ({ fixture_id: 't', description: 't', now: NOW, stacks, containers, interrupt });

test('acceptance (R4): an interrupted teardown, re-run, reaches a fully clean end state with no orphaned resources', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(r.runs[0].errors.map((e) => e.slug), ['idle-a', 'idle-b'], 'two stops were interrupted');
  assert.ok(r.after_interruption.rows_out_of_step.length > 0, 'the interruption left work unfinished');
  assert.deepEqual(r.after_rerun, { orphans: [], rows_out_of_step: [] });
  assert.deepEqual(r.runs[1].stopped, ['idle-a', 'idle-b'], 'the re-run picked up exactly the unfinished stops');
  for (const s of r.stacks.filter((x) => x.expect === 'stopped')) assert.deepEqual([s.slug, s.status, s.containers_running], [s.slug, 'stopped', 0]);
  assert.match(r.statement, /Sandbox only; nothing reached docker or a database/);
});

test('the stack in active use and the stack already stopped are left exactly as they were', () => {
  const r = rehearse(load());
  const s = (slug: string) => r.stacks.find((x) => x.slug === slug)!;
  assert.deepEqual([s('in-review').status, s('in-review').containers_running, s('in-review').stop_events], ['running', 2, 0]);
  assert.deepEqual([s('already-stopped').status, s('already-stopped').stop_events], ['stopped', 0]);
});

test('the reap decision is the platform\'s: past 30 minutes since access, or never accessed and started over 30 minutes ago', () => {
  const stacks = [
    stack('used-29', 'untouched', { last_accessed_at: ago(29) }), stack('used-31', 'stopped', { last_accessed_at: ago(31) }),
    stack('never-new', 'untouched', { last_accessed_at: null, last_started_at: ago(10) }), stack('never-old', 'stopped', { last_accessed_at: null, last_started_at: ago(40) }),
    stack('no-times', 'untouched', { last_accessed_at: null, last_started_at: null }), stack('stopped', 'untouched', { status: 'stopped' }),
  ];
  assert.deepEqual(candidates(stacks, Date.parse(NOW)), ['never-old', 'used-31']);
  assert.equal(PLATFORM_IDLE_MINUTES, 30);
});

test('a stop whose event write fails still stops the stack, and the missing stop event is reported, not hidden', () => {
  const r = rehearse(load());
  assert.deepEqual(r.stops_not_recorded, ['idle-c']);
  assert.equal(r.stacks.find((x) => x.slug === 'idle-c')!.stop_events, 0);
  assert.match(r.statement, /1 stop\(s\) left no stop event/);
});

test('the control order, row first and containers second, strands containers the re-run never reaches: the check can see orphans', () => {
  const r = rehearse(fx([stack('a', 'stopped')], boxes('a', 3), [{ slug: 'a', at: 'during_compose_stop' }]));
  assert.equal(r.checks.control_order_leaves_orphans, true);
  assert.equal(r.verified, true);
});

test('with no interruption that leaves work unfinished, or no fault the control can strand, the rehearsal is not verified', () => {
  const none = rehearse(fx([stack('a', 'stopped')], boxes('a', 2), []));
  assert.equal(none.checks.interruption_left_work_unfinished, false);
  assert.equal(none.verified, false);
  const lateOnly = rehearse(fx([stack('a', 'stopped')], boxes('a', 2), [{ slug: 'a', at: 'after_compose_stop' }]));
  assert.equal(lateOnly.checks.control_order_leaves_orphans, false, 'a fault after the containers stop cannot strand any');
  assert.equal(lateOnly.verified, false);
});

test('a stack with no stack path is marked stopped with its containers still running: an orphan the re-run cannot reach', () => {
  const r = rehearse(fx([stack('a', 'stopped'), stack('b', 'stopped', { stack_path: null })], [...boxes('a', 3), ...boxes('b', 2)], [{ slug: 'a', at: 'during_compose_stop' }]));
  assert.deepEqual(r.after_rerun.orphans, ['b-0', 'b-1']);
  assert.equal(r.checks.rerun_ends_clean, false);
  assert.equal(r.verified, false);
});

test('a stack seeded to stay untouched that the reaper stops makes the rehearsal fail', () => {
  const r = rehearse(fx([stack('a', 'stopped'), stack('quiet', 'untouched', { last_accessed_at: ago(45) })], [...boxes('a', 3), ...boxes('quiet', 1)], [{ slug: 'a', at: 'during_compose_stop' }]));
  assert.equal(r.checks.reaped_as_expected, false);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing every stack, names the lost stop event, and says it is not production', () => {
  const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
  const r = rehearse(load());
  const o = reapRehearsalOutput(r, { captured_at: NOW, captured_by: 'test' }, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, r.stacks.length);
  assert.match(o.as_of.note!, /sandbox fixture preview-reap-sandbox-1, not production/);
  assert.ok(o.blind_spots.some((b) => /idle-c: stopped with no stop event/.test(b)));
  const orphaned = rehearse(fx([stack('a', 'stopped'), stack('b', 'stopped', { stack_path: null })], [...boxes('a', 3), ...boxes('b', 2)], [{ slug: 'a', at: 'during_compose_stop' }]));
  const p = reapRehearsalOutput(orphaned, { captured_at: NOW, captured_by: 'test' }, EMPTY);
  assert.equal(p.verdict, 'problem');
  assert.deepEqual(p.evidence.filter((e) => e.table === 'sandbox_containers').map((e) => e.id), ['b-0', 'b-1']);
});

test('the command exits 0 when verified, and 1 for a missing fixture or one naming an unknown stack', () => {
  const ok = spawnSync(process.execPath, ['src/cli/previewReapRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  assert.equal(spawnSync(process.execPath, ['src/cli/previewReapRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/previewReapRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
  assert.throws(() => loadReapFixture('test/fixtures/preview-reap-unknown-stack.json'), /names unknown stack ghost/);
});
