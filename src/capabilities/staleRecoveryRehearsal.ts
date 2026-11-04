// platform.stale_action_recovery, rung R4: runs the platform's stale-action recovery against a sandbox queue
// seeded with stuck, slow and cap-exceeded actions, and checks three things: the slow action is untouched, the
// cap-exceeded action is parked rather than recycled, and two recovery runs at once recover each row once.
// Sandbox only: the queue is an in-memory copy, every write is journaled, and nothing reaches a database.
//
// Platform behaviour this mirrors (platform repo, commit c150d4c48, backend/src/services/scheduling/claimLease.ts):
// - A row is stale when it is in 'processing' and processing_started_at is older than 10 minutes (:32).
// - Recovery runs in one transaction: rows with no attempt left are failed first, then the rest go back to
//   'pending', and both consume an attempt (:81-120). Each is one UPDATE whose WHERE is re-checked per row at
//   write time, so a second recovery finds nothing left to take, and a row renewed meanwhile is skipped.
// - A live owner renews its claim before each send, pushing processing_started_at forward (:55-67, called at
//   schedulerService.ts:539). That renewal is what keeps a slow row from being recovered under its owner.
// - The timer runs every 15 minutes (schedulerService.ts:2316-2317).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = 'c150d4c48';
export const STALE_AFTER_MS = 10 * 60 * 1000;
export const LIMITS: readonly string[] = [
  'Concurrency is modelled as two runs that read, then write, with every write re-testing its condition. It shows the logic holds; it is not a test of the database\'s own locking.',
  'One interleaving is run: both reads first, the owner\'s renewal between, then the writes. A pass does not cover every timing.',
  'A parked row is failed, as the platform does. Whether its message was sent before the run hung is not knowable from the row, so the platform counts the attempt.',
  'The queue is a sandbox copy of scheduled_emails columns only. What a recovered row does when it is next claimed is not run here.',
];

export type Status = 'pending' | 'processing' | 'sent' | 'failed';
export interface QueueRow { id: string; status: Status; attempts_made: number; max_attempts: number; processing_started_at: string | null; processor_id: string | null }
export type Expect = 'requeued' | 'parked' | 'untouched';
// A slow row's owner is alive: it renews its claim while the first recovery is between reading and writing.
export interface SeededRow extends QueueRow { role: 'stuck' | 'slow' | 'cap_exceeded' | 'fresh' | 'idle'; expect: Expect }
export interface QueueFixture { fixture_id: string; description: string; now: string; rows: SeededRow[] }
export interface JournalEntry { seq: number; run: string; row_id: string; column: keyof QueueRow; before: unknown; after: unknown }

export class SandboxQueue {
  private rows = new Map<string, QueueRow>();
  private log: JournalEntry[] = [];
  constructor(rows: QueueRow[]) { for (const r of rows) this.rows.set(r.id, { ...r }); }
  get(id: string): QueueRow | undefined { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  all(): QueueRow[] { return [...this.rows.values()].map((r) => ({ ...r })); }
  journal(): JournalEntry[] { return this.log.map((e) => ({ ...e })); }
  // One conditional write, as one SQL UPDATE: applied only if `where` still holds when the row is written.
  update(run: string, id: string, where: (r: QueueRow) => boolean, patch: Partial<QueueRow>): boolean {
    const row = this.rows.get(id);
    if (!row || !where(row)) return false;
    for (const [k, v] of Object.entries(patch) as Array<[keyof QueueRow, unknown]>) {
      if (row[k] === v) continue;
      this.log.push({ seq: this.log.length + 1, run, row_id: id, column: k, before: row[k], after: v });
      (row as unknown as Record<string, unknown>)[k] = v;
    }
    return true;
  }
}

const stale = (r: QueueRow, nowMs: number) => r.status === 'processing' && r.processing_started_at !== null && Date.parse(r.processing_started_at) < nowMs - STALE_AFTER_MS;
const noneLeft = (r: QueueRow) => r.attempts_made + 1 >= r.max_attempts;

// read: the rows this run selected as stale when it read the queue, before any write.
export interface RunResult { run: string; read: string[]; requeued: string[]; exhausted: string[] }

// The read half: which rows this run would take, as of when it reads.
export function planRecovery(q: SandboxQueue, nowMs: number): string[] {
  return q.all().filter((r) => stale(r, nowMs)).map((r) => r.id).sort();
}

// The write half. With recheck, each write re-tests the WHERE, as the platform's UPDATE does; without it, the
// run writes whatever it read, which is what the harness must be able to catch.
export function applyRecovery(q: SandboxQueue, run: string, plan: string[], nowMs: number, recheck = true): RunResult {
  const out: RunResult = { run, read: [...plan], requeued: [], exhausted: [] };
  const gate = (extra: (r: QueueRow) => boolean) => (r: QueueRow) => (recheck ? stale(r, nowMs) && extra(r) : extra(r));
  for (const id of plan) {
    const before = q.get(id);
    if (!before) continue;
    const spend = { attempts_made: before.attempts_made + 1, processing_started_at: null, processor_id: null };
    if (q.update(run, id, gate(noneLeft), { status: 'failed', ...spend })) out.exhausted.push(id);
  }
  for (const id of plan) {
    if (out.exhausted.includes(id)) continue;
    const before = q.get(id);
    if (!before) continue;
    if (q.update(run, id, gate((r) => !noneLeft(r)), { status: 'pending', attempts_made: before.attempts_made + 1, processing_started_at: null, processor_id: null })) out.requeued.push(id);
  }
  return out;
}

// The owner's renewal: pushes the lease forward only if this processor still holds the row.
export function renewClaim(q: SandboxQueue, id: string, processorId: string, nowMs: number): boolean {
  return q.update('owner', id, (r) => r.status === 'processing' && r.processor_id === processorId, { processing_started_at: new Date(nowMs).toISOString() });
}

export interface RowOutcome { id: string; role: SeededRow['role']; expect: Expect; got: Expect; recovered_by: string[]; attempts: { before: number; after: number }; status: Status }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  runs: RunResult[];
  rows: RowOutcome[];
  checks: { slow_untouched: boolean; cap_parked_not_recycled: boolean; one_recovery_each: boolean; harness_catches_double_recovery: boolean };
  verified: boolean;
  statement: string;
  limits: string[];
  journal: JournalEntry[];
}

// Two runs read the queue at the same moment, a slow row's owner renews between their read and their writes,
// then both write. Run B is the second run: it must change nothing the first one already did.
function race(fx: QueueFixture, recheck: boolean): { q: SandboxQueue; runs: RunResult[] } {
  const now = Date.parse(fx.now);
  const q = new SandboxQueue(fx.rows.map(({ role: _r, expect: _e, ...row }) => row));
  const a = planRecovery(q, now), b = planRecovery(q, now);
  for (const r of fx.rows.filter((x) => x.role === 'slow')) renewClaim(q, r.id, r.processor_id!, now);
  const runs = [applyRecovery(q, 'A', a, now, recheck), applyRecovery(q, 'B', b, now, recheck)];
  return { q, runs };
}

export function rehearse(fx: QueueFixture): Rehearsal {
  const { q, runs } = race(fx, true);
  const by = (id: string) => runs.filter((r) => r.requeued.includes(id) || r.exhausted.includes(id)).map((r) => r.run);
  const rows: RowOutcome[] = fx.rows.map((s) => {
    const now = q.get(s.id)!;
    const got: Expect = now.status === 'failed' && s.status === 'processing' ? 'parked' : now.status === 'pending' && s.status === 'processing' ? 'requeued' : 'untouched';
    return { id: s.id, role: s.role, expect: s.expect, got, recovered_by: by(s.id), attempts: { before: s.attempts_made, after: now.attempts_made }, status: now.status };
  });
  const role = (k: SeededRow['role']) => rows.filter((r) => r.role === k);
  // The same race without the write-time re-check must recover some row twice, or the harness proves nothing.
  const naive = race(fx, false).runs;
  const twice = fx.rows.some((s) => naive.filter((r) => r.requeued.includes(s.id) || r.exhausted.includes(s.id)).length > 1);
  const checks = {
    slow_untouched: role('slow').length > 0 && role('slow').every((r) => r.got === 'untouched' && r.attempts.after === r.attempts.before),
    cap_parked_not_recycled: role('cap_exceeded').length > 0 && role('cap_exceeded').every((r) => r.got === 'parked' && r.status !== 'pending'),
    one_recovery_each: rows.every((r) => r.recovered_by.length <= 1) && rows.every((r) => r.got === r.expect),
    harness_catches_double_recovery: twice,
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, runs, rows, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}: the slow action was untouched, the cap-exceeded action was parked, and two concurrent runs recovered each stuck row once. Sandbox only; nothing reached production.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
    journal: q.journal(),
  };
}

export function loadQueueFixture(path: string): QueueFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: QueueFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof fx.fixture_id !== 'string' || Number.isNaN(Date.parse(fx.now)) || !Array.isArray(fx.rows)) throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, now and rows[]`);
  for (const r of fx.rows) {
    if (typeof r.id !== 'string' || !Number.isInteger(r.attempts_made) || !Number.isInteger(r.max_attempts)) throw new SandboxError('ContractViolation', `fixture ${path}: row ${JSON.stringify(r.id)} needs id, attempts_made and max_attempts`);
    if (r.role === 'slow' && !r.processor_id) throw new SandboxError('ContractViolation', `fixture ${path}: slow row ${r.id} needs the processor_id that renews it`);
  }
  return fx;
}
