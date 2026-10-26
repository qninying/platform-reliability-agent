import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiAgentRow, ActivityLogRow } from '../src/records.ts';
import { reapingReport, REAPER, type PreviewSnapshot, type PreviewStackRow, type PreviewEventRow } from '../src/capabilities/previewStackReaping.ts';

// Rows are shaped as GET /api/admin/preview-stacks and the reaper's cron run write them; test inputs, not production data.
const NOW = new Date('2026-10-27T15:00:00Z');

function minsAgo(m: number) {
  return new Date(NOW.getTime() - m * 60_000).toISOString();
}

function stack(slug: string, over: Partial<PreviewStackRow> = {}): PreviewStackRow {
  return { id: `id-${slug}`, slug, status: 'running', last_accessed_at: minsAgo(5), last_started_at: minsAgo(120), updated_at: minsAgo(120), ...over };
}

const reaper: AiAgentRow = { id: 'id-reaper', agent_name: REAPER, status: 'idle', enabled: true, schedule: '*/5 * * * *', last_run_at: minsAgo(2), updated_at: null };
const reaperRun: ActivityLogRow = { id: 'run-1', agent_id: 'id-reaper', action: 'cron_run', result: 'success', created_at: minsAgo(2) };

function snap(stacks: PreviewStackRow[], over: Partial<PreviewSnapshot> = {}): PreviewSnapshot {
  return { captured_at: NOW.toISOString(), captured_by: 'test', preview_stacks: stacks, preview_events: [], ai_agents: [reaper], ai_agent_activity_logs: [reaperRun], ...over };
}

function live(r: ReturnType<typeof reapingReport>, slug: string) {
  return r.live.find((s) => s.slug === slug)!;
}

test('acceptance: a stack with no activity signal at all is reported as unknown-idle, not as idle', () => {
  const r = reapingReport(snap([stack('never-opened', { last_accessed_at: null, last_started_at: null })]), { now: NOW });
  const s = live(r, 'never-opened');
  assert.equal(s.idle, 'unknown_idle');
  assert.equal(s.idle_minutes, null);
  assert.equal(s.reap_candidate, false);
  assert.deepEqual(r.reap_candidates, []);
  assert.deepEqual(r.counts, { active: 0, idle: 0, unknown_idle: 1 });
});

test("acceptance: stack age is not activity: a never-accessed stack is unknown-idle even when the platform would stop it by age", () => {
  const r = reapingReport(snap([stack('old-unopened', { last_accessed_at: null, last_started_at: minsAgo(300) })]), { now: NOW });
  const s = live(r, 'old-unopened');
  assert.equal(s.idle, 'unknown_idle');
  assert.equal(s.reap_candidate, false);
  assert.equal(s.platform_would_stop, true);
  assert.match(s.reason, /by its age/);
});

test('a stack accessed past the threshold is idle and a reap candidate; a recent one is active', () => {
  const r = reapingReport(snap([stack('busy', { last_accessed_at: minsAgo(3) }), stack('quiet', { last_accessed_at: minsAgo(45) })]), { now: NOW });
  assert.equal(live(r, 'busy').idle, 'active');
  assert.equal(live(r, 'quiet').idle, 'idle');
  assert.equal(live(r, 'quiet').idle_minutes, 45);
  assert.deepEqual(r.reap_candidates, ['quiet']);
});

test('the threshold boundary: exactly at the threshold is still active', () => {
  const r = reapingReport(snap([stack('edge', { last_accessed_at: minsAgo(30) })]), { now: NOW });
  assert.equal(live(r, 'edge').idle, 'active');
});

test('a given threshold is used and labelled; the default is labelled as the platform default', () => {
  const s = [stack('a', { last_accessed_at: minsAgo(20) })];
  assert.deepEqual(reapingReport(snap(s), { now: NOW }).threshold, { minutes: 30, source: 'platform_default' });
  const r = reapingReport(snap(s), { now: NOW, idleMinutes: 15 });
  assert.deepEqual(r.threshold, { minutes: 15, source: 'given' });
  assert.deepEqual(r.reap_candidates, ['a']);
});

test('an unusable or future access time is unknown-idle, not active', () => {
  const r = reapingReport(snap([stack('bad', { last_accessed_at: 'not-a-time' }), stack('future', { last_accessed_at: minsAgo(-10) })]), { now: NOW });
  assert.equal(live(r, 'bad').idle, 'unknown_idle');
  assert.equal(live(r, 'future').idle, 'unknown_idle');
});

test('only running stacks are live; stuck transitions and failures are listed for attention', () => {
  const r = reapingReport(snap([
    stack('stopped', { status: 'stopped' }),
    stack('archived', { status: 'archived' }),
    stack('stuck-teardown', { status: 'tearing_down', updated_at: minsAgo(90) }),
    stack('fresh-provision', { status: 'provisioning', updated_at: minsAgo(4) }),
    stack('broken', { status: 'failed' }),
  ]), { now: NOW });
  assert.equal(r.live.length, 0);
  assert.deepEqual(r.attention.map((a) => a.slug), ['broken', 'stuck-teardown']);
});

test('reaper status: ran, overdue, failed, disabled and untracked', () => {
  const cases: Array<[Partial<PreviewSnapshot>, string]> = [
    [{}, 'ran'],
    [{ ai_agent_activity_logs: [{ ...reaperRun, created_at: minsAgo(40) }] }, 'overdue'],
    [{ ai_agent_activity_logs: [{ ...reaperRun, result: 'failed' }] }, 'failed'],
    [{ ai_agents: [{ ...reaper, enabled: false }] }, 'disabled'],
    [{ ai_agents: [] }, 'untracked'],
  ];
  for (const [over, status] of cases) assert.equal(reapingReport(snap([], over), { now: NOW }).reaper.status, status);
});

test('recent stops are counted with citations, and the report says reaper and admin stops cannot be told apart', () => {
  const events: PreviewEventRow[] = [
    { id: 'e1', preview_stack_id: 'id-a', event_type: 'stop', created_at: minsAgo(60) },
    { id: 'e2', preview_stack_id: 'id-b', event_type: 'boot', created_at: minsAgo(50) },
    { id: 'e3', preview_stack_id: 'id-c', event_type: 'stop', created_at: minsAgo(60 * 30) },
  ];
  const r = reapingReport(snap([], { preview_events: events }), { now: NOW });
  assert.equal(r.recent_stops.count, 1);
  assert.equal(r.recent_stops.citations[0].id, 'e1');
  assert.match(r.recent_stops.note, /cannot|without saying who/);
});

test('every live answer cites its preview_stacks row', () => {
  const r = reapingReport(snap([stack('a'), stack('b', { last_accessed_at: null })]), { now: NOW });
  for (const s of r.live) assert.deepEqual(s.citation, { table: 'preview_stacks', id: `id-${s.slug}`, fields: ['status', 'last_accessed_at', 'last_started_at'] });
});

test('idempotent: the same rows in any order give the same report', () => {
  const stacks = [stack('c', { last_accessed_at: minsAgo(50) }), stack('a'), stack('b', { last_accessed_at: null })];
  const a = reapingReport(snap(stacks), { now: NOW });
  const b = reapingReport(snap([...stacks].reverse()), { now: NOW });
  assert.deepEqual(a, b);
});
