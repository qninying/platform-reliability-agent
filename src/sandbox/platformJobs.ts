// Sandbox models of platform job families, for the twice-run harness. Models, not the platform's code: each follows
// the lines it names (platform repo, commit 29bdbb61b), with an await wherever the code awaits between a read and a
// write, so two runs at once interleave where the real ones can. A single SQL statement is one step with no await
// inside it. Effects are entries in the harness's list, never real work.

import type { Fixture, Job, Row, World } from './twiceRun.ts';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const MIN = 60_000;
const ago = (m: number) => new Date(NOW - m * MIN).toISOString();

// Stale action recovery: services/scheduling/claimLease.ts:87-111. Two UPDATE statements in one transaction, each
// conditional on status = 'processing' and a stale start, so a row another run already moved no longer matches.
const STALE_MS = 10 * MIN;
const email = (id: string, status: string, started: string | null, attempts: number): Row => ({ id, status, processing_started_at: started, attempts_made: attempts, max_attempts: 3, processor_id: started ? 'proc-1' : null });
export const STALE_FIXTURE: Fixture = { rows: [email('email-stale', 'processing', ago(30), 0), email('email-last-try', 'processing', ago(30), 2), email('email-fresh', 'processing', ago(2), 0), email('email-pending', 'pending', null, 0)] };
const stale = (r: Row) => r.status === 'processing' && r.processing_started_at !== null && Date.parse(String(r.processing_started_at)) < NOW - STALE_MS;
// One statement, so nothing runs between its read and its write.
const statement = (w: World, when: (r: Row) => boolean, set: (r: Row) => Partial<Row>) => {
  for (const r of w.read(when)) w.update(r.id, () => true, set(r));
};
export const staleRecovery: Job = async (w) => {
  await w.tick();
  statement(w, (r) => stale(r) && Number(r.attempts_made) + 1 >= Number(r.max_attempts), (r) => ({ status: 'failed', attempts_made: Number(r.attempts_made) + 1, processing_started_at: null, processor_id: null }));
  await w.tick();
  statement(w, (r) => stale(r) && Number(r.attempts_made) + 1 < Number(r.max_attempts), (r) => ({ status: 'pending', attempts_made: Number(r.attempts_made) + 1, processing_started_at: null, processor_id: null }));
};

// Preview stack reaping: services/previewStackReaper.ts:18-38 finds running idle stacks, then for each calls
// stopStack (services/previewStackService.ts:299-308): read the row, return if not running, compose stop, set the
// status, log a stop event. The check and the write are separate awaits, with the compose stop between them.
const IDLE_MS = 30 * MIN;
const stack = (id: string, status: string, accessed: string): Row => ({ id, status, last_accessed_at: accessed });
export const REAP_FIXTURE: Fixture = { rows: [stack('stack-idle', 'running', ago(120)), stack('stack-busy', 'running', ago(5)), stack('stack-stopped', 'stopped', ago(300))] };
export const previewReaper: Job = async (w) => {
  const candidates = w.read((r) => r.status === 'running' && Date.parse(String(r.last_accessed_at)) < NOW - IDLE_MS);
  for (const c of candidates) {
    await w.tick();
    const [now] = w.read((r) => r.id === c.id);
    if (now.status !== 'running') continue;
    await w.tick();
    w.emit({ row_id: c.id, kind: 'compose_stop' });
    await w.tick();
    w.update(c.id, () => true, { status: 'stopped' });
    await w.tick();
    w.emit({ row_id: c.id, kind: 'stop_event' });
  }
};

// Retention sweep: services/cory/intelligenceRetention.ts:50-55 copies decisions older than 30 days (:17) not yet
// archived (one INSERT ... SELECT ... NOT IN statement), then :74-79 deletes them (one DELETE statement). The archive
// table copies the source's keys (:27), so a duplicate archive row is refused as well.
const decision = (id: string, at: string): Row => ({ id, table: 'intelligence_decisions', timestamp: at });
export const RETENTION_FIXTURE: Fixture = { rows: [decision('dec-old-1', ago(60 * 24 * 120)), decision('dec-old-2', ago(60 * 24 * 31)), decision('dec-new', ago(60 * 24 * 29))] };
const old = (r: Row) => r.table === 'intelligence_decisions' && Date.parse(String(r.timestamp)) < NOW - 30 * 24 * 60 * MIN;
export const retentionSweep: Job = async (w) => {
  await w.tick();
  for (const r of w.read(old)) if (!w.rows.has(`archive:${r.id}`)) w.insert({ ...r, id: `archive:${r.id}`, table: 'intelligence_decisions_archive' });
  await w.tick();
  for (const r of w.read(old)) w.remove(r.id, old);
};
