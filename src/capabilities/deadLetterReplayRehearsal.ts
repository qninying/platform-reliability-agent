// platform.dead_letter_triage, rung R4: verifies a replay end to end in a sandbox for one job family, publishing
// jobs. Before an entry is replayed, Ellis replays it twice on a throwaway copy and counts the posts its content
// ends up with, the one that may have landed before it was dead-lettered included. One post: the entry is
// replay-safe, and is replayed once on the sandbox queue. More: it is reported as not replay-safe and left alone.
// A triage that replays without the trial runs on the same entries as the control. Sandbox only.
//
// Platform facts this rests on (platform repo, commit 350243226):
// - Publishing jobs dead-letter on their own row (backend/src/models/PublishingJob.ts:108-109) and carry an
//   idempotency_key (:98) that the worker hands the provider (backend/src/services/publishing/publishingWorker.ts:226).
// - A keyed provider returns the same post for the same key (publishing/dryRunAdapter.ts:22).
// - Meta has no idempotency key (publishing/metaAdapter.ts:198-199). Its flows look for a post with the same text
//   in the last six hours and return it instead of posting again (publishing/metaPublish.ts:22, :68, :106, :240).
//   Past six hours, the same text posts again.
// - dead_letter_jobs rows keep no job input, only last_failed_at (backend/src/services/deadLetterService.ts:48),
//   so that store has nothing to replay; this family is the one that can be replayed.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = '350243226';
export const WINDOW_MS = 6 * 60 * 60 * 1000;
export const LIMITS: readonly string[] = [
  'One job family, publishing, with providers modelled on the platform\'s three behaviours. No real provider was called, and each sandbox account holds only the entry\'s own posts, so other content on the same account is not run.',
  'A side effect here is a post. Event rows and attempt counts repeat on every run by design and are not counted.',
  'The trial runs both replays at triage time. A replay that runs much later than its trial can fall outside the duplicate window the trial relied on.',
  'Replaying in production re-fires real side effects and stays a person\'s decision; production_database is default-denied (executionPolicy.ts:33-42).',
];

export type Provider = 'keyed' | 'text_window' | 'none';
export interface Entry {
  id: string;
  provider: Provider;
  idempotency_key: string;
  text: string;
  // When the failed attempt's post landed before the job was dead-lettered; null when it never did.
  prior_post_at: string | null;
  expect: 'replay_safe' | 'not_replay_safe';
}
export interface ReplayFixture { fixture_id: string; description: string; triage_at: string; entries: Entry[] }

interface Post { key: string; text: string; at: number }
// One provider account: the posts on it, and a publish that dedups as its provider does.
interface Account { posts: Post[]; publish: (key: string, text: string, at: number) => void }
const seeded = (e: Entry): Account => {
  const posts: Post[] = e.prior_post_at ? [{ key: e.idempotency_key, text: e.text, at: Date.parse(e.prior_post_at) }] : [];
  const publish = (key: string, text: string, at: number): void => {
    if (e.provider === 'keyed' && posts.some((p) => p.key === key)) return;
    if (e.provider === 'text_window' && posts.some((p) => p.text === text && at - p.at < WINDOW_MS)) return;
    posts.push({ key, text, at });
  };
  return { posts, publish };
};

export type Triage = 'trial_first' | 'replay_directly';
export interface EntryResult {
  id: string;
  provider: Provider;
  trial_posts: number | null;
  verdict: 'replay_safe' | 'not_replay_safe' | 'replayed_without_trial';
  replayed: boolean;
  resolved: boolean;
  queue_posts: number;
  expect: Entry['expect'];
}

// The queue copy is the sandbox queue; the trial copy is thrown away after counting.
export function triage(e: Entry, at: number, how: Triage): EntryResult {
  const queue = seeded(e);
  if (how === 'replay_directly') {
    // Replayed as an operator would retry it: once, then again when it still looks failed.
    queue.publish(e.idempotency_key, e.text, at);
    queue.publish(e.idempotency_key, e.text, at);
    return { id: e.id, provider: e.provider, trial_posts: null, verdict: 'replayed_without_trial', replayed: true, resolved: true, queue_posts: queue.posts.length, expect: e.expect };
  }
  const trial = seeded(e);
  trial.publish(e.idempotency_key, e.text, at);
  trial.publish(e.idempotency_key, e.text, at);
  const safe = trial.posts.length === 1;
  if (safe) queue.publish(e.idempotency_key, e.text, at);
  return { id: e.id, provider: e.provider, trial_posts: trial.posts.length, verdict: safe ? 'replay_safe' : 'not_replay_safe', replayed: safe, resolved: safe, queue_posts: queue.posts.length, expect: e.expect };
}

export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  entries: EntryResult[];
  control: EntryResult[];
  // One check per entry (its verdict is the one expected), plus what the queue shows and the control.
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: ReplayFixture, how: { subject: Triage; control: Triage } = { subject: 'trial_first', control: 'replay_directly' }): Rehearsal {
  const at = Date.parse(fx.triage_at);
  const entries = fx.entries.map((e) => triage(e, at, how.subject));
  const control = fx.entries.map((e) => triage(e, at, how.control));
  const unsafe = entries.filter((x) => x.expect === 'not_replay_safe');
  // A safe verdict replays once and an unsafe one never does, by construction; the queue is what is checked.
  const checks: Record<string, boolean> = {
    ...Object.fromEntries(entries.map((x) => [x.id, x.verdict === x.expect])),
    no_entry_ends_with_a_duplicate: entries.every((x) => x.queue_posts <= 1),
    // The positive control: replaying without a trial puts a second post on at least one entry. With no unsafe
    // entry in the fixture it cannot, and the rehearsal is not verified.
    control_duplicates: control.some((x) => x.queue_posts > 1),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const dup = control.filter((x) => x.queue_posts > 1).map((x) => x.id);
  const safe = entries.filter((x) => x.verdict === 'replay_safe').map((x) => x.id);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, entries, control, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: of ${entries.length} dead-lettered publishing entries, ${safe.length} replayed twice on a copy ended with one post each and were replayed once (${safe.join(', ')}); ${unsafe.length} ended with two and were reported as not replay-safe, not replayed (${unsafe.map((x) => x.id).join(', ')}). Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` Replaying without a trial put a second post on ${dup.length ? dup.join(', ') : 'no entry'}.`,
    limits: [...LIMITS],
  };
}

export function loadReplayFixture(path: string): ReplayFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: ReplayFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const PROVIDERS: Provider[] = ['keyed', 'text_window', 'none'];
export function checkFixture(fx: ReplayFixture, path: string): ReplayFixture {
  const when = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  if (typeof fx.fixture_id !== 'string' || !when(fx.triage_at) || !Array.isArray(fx.entries) || fx.entries.length === 0) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, a triage_at date and a non-empty entries[]`);
  }
  for (const e of fx.entries) {
    const ok = typeof e?.id === 'string' && PROVIDERS.includes(e.provider) && typeof e.idempotency_key === 'string' && typeof e.text === 'string'
      && (e.prior_post_at === null || when(e.prior_post_at)) && (e.expect === 'replay_safe' || e.expect === 'not_replay_safe');
    if (!ok) throw new SandboxError('ContractViolation', `fixture ${path}: entry ${e?.id ?? '?'} needs id, provider (${PROVIDERS.join(', ')}), idempotency_key, text, prior_post_at (a date or null) and expect`);
  }
  if (new Set(fx.entries.map((e) => e.id)).size !== fx.entries.length) throw new SandboxError('ContractViolation', `fixture ${path}: entry ids must be unique`);
  return fx;
}
