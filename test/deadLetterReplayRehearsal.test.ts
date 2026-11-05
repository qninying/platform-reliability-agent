import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, triage, checkFixture, loadReplayFixture, WINDOW_MS, type Entry, type ReplayFixture } from '../src/capabilities/deadLetterReplayRehearsal.ts';
import { replayRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is sandbox publishing entries with invented content: not production data.
const FIXTURE = 'examples/dead-letter-replay.fixture.json';
const load = (): ReplayFixture => loadReplayFixture(FIXTURE);
const AT = Date.parse('2026-11-05T12:00:00Z');
const e = (over: Partial<Entry> = {}): Entry => ({ id: 'x', provider: 'keyed', idempotency_key: 'k', text: 't', prior_post_at: null, expect: 'replay_safe', ...over });
const hoursBefore = (h: number) => new Date(AT - h * 3_600_000).toISOString();
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const byId = (r: ReturnType<typeof rehearse>, id: string) => r.entries.find((x) => x.id === id)!;

test('acceptance (R4): replaying the same entry twice produces one set of side effects; if it produces two, the entry is reported as not replay-safe rather than replayed', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(byId(r, 'pjob-keyed-1'), { id: 'pjob-keyed-1', provider: 'keyed', trial_posts: 1, verdict: 'replay_safe', replayed: true, resolved: true, queue_posts: 1, expect: 'replay_safe' });
  assert.deepEqual(byId(r, 'pjob-unkeyed'), { id: 'pjob-unkeyed', provider: 'none', trial_posts: 2, verdict: 'not_replay_safe', replayed: false, resolved: false, queue_posts: 0, expect: 'not_replay_safe' });
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
});

test('a text-window provider is safe while the earlier post is inside six hours, and not once it is outside', () => {
  assert.equal(WINDOW_MS, 6 * 60 * 60 * 1000);
  const r = rehearse(load());
  assert.equal(byId(r, 'pjob-window-recent').verdict, 'replay_safe');
  assert.deepEqual([byId(r, 'pjob-window-stale').trial_posts, byId(r, 'pjob-window-stale').verdict, byId(r, 'pjob-window-stale').queue_posts], [2, 'not_replay_safe', 1]);
  const edge = (h: number) => triage(e({ provider: 'text_window', prior_post_at: hoursBefore(h) }), AT, 'trial_first').verdict;
  assert.equal(edge(5.99), 'replay_safe');
  assert.equal(edge(6), 'not_replay_safe', 'at exactly six hours the earlier post is outside the window');
});

test('a keyed provider returns the earlier post for the same key at any age, but a new key posts again', () => {
  assert.equal(triage(e({ prior_post_at: hoursBefore(48) }), AT, 'trial_first').trial_posts, 1);
  const r = rehearse(load());
  assert.deepEqual([byId(r, 'pjob-keyed-posted').queue_posts, byId(r, 'pjob-keyed-posted').resolved], [1, true]);
});

test('an unsafe entry is left exactly as it was: what landed before stays, nothing is added, and it stays open', () => {
  const stale = triage(e({ provider: 'text_window', prior_post_at: hoursBefore(8), expect: 'not_replay_safe' }), AT, 'trial_first');
  assert.deepEqual([stale.replayed, stale.resolved, stale.queue_posts], [false, false, 1]);
});

test('replaying without a trial, as the control, posts twice where the trial would have stopped it', () => {
  const r = rehearse(load());
  assert.deepEqual(r.control.filter((x) => x.queue_posts > 1).map((x) => x.id), ['pjob-window-stale', 'pjob-unkeyed']);
  assert.ok(r.control.every((x) => x.verdict === 'replayed_without_trial' && x.trial_posts === null));
  assert.match(r.statement, /Replaying without a trial put a second post on pjob-window-stale, pjob-unkeyed/);
});

test('graded as the subject, replaying without a trial misjudges every entry and leaves duplicates; as the control, a trial adds none', () => {
  const r = rehearse(load(), { subject: 'replay_directly', control: 'trial_first' });
  assert.deepEqual(r.checks, {
    'pjob-keyed-1': false, 'pjob-keyed-posted': false, 'pjob-window-recent': false, 'pjob-window-stale': false, 'pjob-unkeyed': false,
    no_entry_ends_with_a_duplicate: false, control_duplicates: false,
  });
  assert.equal(r.verified, false);
});

test('a fixture with no unsafe entry, or an expectation the trial does not meet, is not verified', () => {
  const base = load();
  const allSafe = rehearse({ ...base, entries: base.entries.filter((x) => x.expect === 'replay_safe') });
  assert.equal(allSafe.checks.control_duplicates, false);
  const wrong = rehearse({ ...base, entries: [e({ provider: 'none', expect: 'replay_safe' }), ...base.entries.slice(3)] });
  assert.equal(wrong.checks.x, false);
  assert.match(wrong.statement, /not verified: x/);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each entry and says it is not production; misjudged entries are the evidence when it fails', () => {
  const c = { captured_at: '2026-11-05T12:30:00Z', captured_by: 'test' };
  const r = rehearse(load());
  const o = replayRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 5);
  assert.match(o.as_of.note!, /sandbox fixture dead-letter-replay-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const base = load();
  const f = replayRehearsalOutput(rehearse({ ...base, entries: [e({ id: 'bad', provider: 'none' }), ...base.entries] }), c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((x) => x.id), ['bad']);
});

test('a fixture is refused with no entries, a bad date, an unknown provider, a missing expectation or a repeated id; the command exits 0, 3 and 1', () => {
  const base = load();
  const bad: ReplayFixture[] = [
    { ...base, entries: [] }, { ...base, triage_at: 'noon' }, { ...base, fixture_id: 1 as never },
    { ...base, entries: [e({ provider: 'meta' as never })] }, { ...base, entries: [e({ prior_post_at: 'yesterday' })] },
    { ...base, entries: [e({ expect: undefined as never })] }, { ...base, entries: [e({ text: undefined as never })] },
    { ...base, entries: [e({ idempotency_key: 1 as never })] }, { ...base, entries: [e({ id: 2 as never })] },
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /ContractViolation|needs/);
  assert.throws(() => checkFixture({ ...base, entries: [e(), e()] }, 'inline'), /ids must be unique/);
  assert.equal(checkFixture(base, 'inline').entries.length, 5);
  const ok = spawnSync(process.execPath, ['src/cli/deadLetterReplayRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const not = spawnSync(process.execPath, ['src/cli/deadLetterReplayRehearsal.ts', '--fixture', 'test/fixtures/dead-letter-replay-all-safe.json'], { encoding: 'utf8' });
  assert.equal(not.status, 3, not.stderr);
  assert.equal(spawnSync(process.execPath, ['src/cli/deadLetterReplayRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/deadLetterReplayRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
