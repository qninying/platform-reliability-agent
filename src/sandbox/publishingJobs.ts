// Fixture jobs for the publishing family. Models, not the platform's code: the claimed job follows the optimistic
// claim in services/publishing/publishingWorker.ts:290-295 (commit bbde6ef), and the others take a defence away.
// The effect is an entry in the harness's list, never a post.

import type { Fixture, Job, Row, World } from './twiceRun.ts';

const NOW = '2026-10-31T12:00:00Z';
const due = (r: Row) => (r.state === 'pending' || r.state === 'retrying') && String(r.publish_at) <= NOW;
const row = (id: string, state: string, publish_at: string): Row => ({ id, state, publish_at, claimed_by: null });

export const FIXTURE: Fixture = { rows: [row('job-due-1', 'pending', '2026-10-31T09:00:00Z'), row('job-due-2', 'retrying', '2026-10-31T10:00:00Z'), row('job-future', 'pending', '2026-11-01T09:00:00Z'), row('job-done', 'published', '2026-10-30T09:00:00Z')] };
export const NOTHING_DUE: Fixture = { rows: [row('job-future', 'pending', '2026-11-01T09:00:00Z')] };

async function publish(w: World, id: string): Promise<void> {
  await w.tick();
  w.emit({ row_id: id, kind: 'post' });
  await w.tick();
  w.update(id, () => true, { state: 'published', claimed_by: null });
}

// Conditional on the state it read, so of two workers only one gets the row.
export const claimedPublish: Job = async (w, worker) => {
  for (const job of w.read(due)) {
    await w.tick();
    const moved = w.update(job.id, (r) => r.state === job.state, { state: 'claimed', claimed_by: worker });
    if (moved) await publish(w, job.id);
  }
};

// Checks what is due but claims nothing: two runs in a row are fine, two at once both post.
export const unclaimedPublish: Job = async (w) => {
  for (const job of w.read(due)) await publish(w, job.id);
};

// Deliberately not idempotent: it posts everything it can see, on every run.
export const unguardedPublish: Job = async (w) => {
  for (const job of w.read((r) => String(r.publish_at) <= NOW)) await publish(w, job.id);
};

export const brokenPublish: Job = async () => { throw new TypeError('fixture failure'); };
