// platform.dead_letter_capture, first release behaviour (R2):
// reports what has been dead-lettered, by error class, and names the job families that cannot dead-letter, so
// an empty queue is never read as a healthy fleet. Ellis reads the queue; it never writes to it. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - wrapWithDeadLetter counts only an error that reaches it, and writes a dead_letter_jobs row on the third
//   consecutive failure, then clears the count (services/deadLetterService.ts:17, :25-34, :40-62). The count
//   is in memory, so a restart starts it again (:19).
// - It is applied in startStandardTask only (services/aiOpsScheduler.ts:554), not in startDynamicTask (:565)
//   or to any inline timer. Being wrapped is not enough: these runners catch the failure and never rethrow, so
//   the wrapper sees a success: runAgent (aiOrchestrator.ts:300, :333), runHealthScans (aiOrchestrator.ts:157)
//   and instrumentCronJob with a row (cronInstrumentation.ts:61). trackAgentRun rethrows
//   (agentRunTracker.ts:98), and a director's run has no catch around it (workforce/directorActions.ts:41).
// - Nothing sets resolved or resolved_at on dead_letter_jobs: only the writer's own false and null exist
//   (deadLetterService.ts:49-50), and no route or page reads the table.
// - publishing_jobs is a second, separate mechanism: dead_lettered_at and dead_letter_reason with
//   last_error_class (services/publishing/publishingWorker.ts:126-146), read by an admin route
//   (routes/admin/publishingRoutes.ts:63-64) and cleared by a later success (publishingReceiptService.ts:83-84).

import type { TimerIndex, Site } from '../inventory/timerHomes.ts';

export interface DeadLetterRow { id: string; job_name: string; label: string | null; consecutive_failures: number; error_class: string; resolved: boolean; resolved_at: string | null; created_at: string }
export interface PublishingRow { id: string; state: string; last_error_class: string | null; dead_lettered_at: string | null; dead_letter_reason: string | null }
export interface DeadLetterSnapshot { captured_at: string; captured_by: string; dead_letter_jobs: DeadLetterRow[]; publishing_jobs: PublishingRow[] }
export const TABLES = ['dead_letter_jobs', 'publishing_jobs'] as const;

export type Family = 'can_dead_letter' | 'wrapped_but_swallowed' | 'dynamic_registry' | 'inline' | 'other_timers' | 'unknown';
export interface FamilyReport { family: Family; can_dead_letter: boolean | null; count: number; why: string; jobs: string[] }
export interface ClassReport { error_class: string; rows: number; jobs: Array<{ job: string; family: Family | 'not_in_source'; rows: number }>; first_at: string; last_at: string; row_ids: string[] }
export interface PublishingClass { error_class: string; rows: number; row_ids: string[] }
export interface DeadLetterAnswer {
  captured_at: string;
  source_commit: string | null;
  verdict: 'dead_lettered' | 'queue_empty';
  statement: string;
  dead_letter_jobs: { rows: number; marked_resolved: number; by_class: ClassReport[] };
  publishing_jobs: { rows: number; by_class: PublishingClass[] };
  coverage: { total_jobs: number; can_dead_letter: number; cannot_or_unknown: number; families: FamilyReport[] };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'A row means at least three consecutive failures, not one: the count clears after each write, so one long failure writes a row every third run.',
  'The failure count is in memory, so a restart starts it again and a job failing once per deploy never reaches three.',
  'instrumentCronJob rethrows only when the job has no ai_agents row (cronInstrumentation.ts:29-38), so such a job in wrapped_but_swallowed can still dead-letter; this report reads the code, not the rows.',
  'A job in the can_dead_letter family that catches its own errors inside its runner never reaches the wrapper; this report reads the wrapper layer only.',
  'resolved means nothing yet: no code sets it, so an open row says nothing about whether the job recovered.',
  'dead_letter_jobs and publishing_jobs are separate mechanisms with no shared view; this report keeps their answers separate.',
];

const WHY: Record<Family, string> = {
  can_dead_letter: 'wrapped, and a failure reaches the wrapper: trackAgentRun rethrows, and a director has no catch around its run',
  wrapped_but_swallowed: 'wrapped, but its runner catches the failure and never rethrows, so the wrapper sees a success: runAgent, runHealthScans and instrumentCronJob with a row',
  dynamic_registry: 'not wrapped: startDynamicTask calls instrumentCronJob directly',
  inline: 'not wrapped: registered inline with cron.schedule',
  other_timers: 'not wrapped, and its callback names no instrumentCronJob run, so Ellis lists the timer by its place in the source',
  unknown: "wrapped, but Ellis could not read how its runner handles a failure",
};
const ORDER: Family[] = ['wrapped_but_swallowed', 'dynamic_registry', 'inline', 'other_timers', 'unknown', 'can_dead_letter'];
const CAN: Record<Family, boolean | null> = { can_dead_letter: true, wrapped_but_swallowed: false, dynamic_registry: false, inline: false, other_timers: false, unknown: null };

export function families(ix: TimerIndex): FamilyReport[] {
  const { standard, dynamic, other } = ix.deadLetter;
  if (standard === null || dynamic === null) throw new Error('startStandardTask or startDynamicTask could not be read in aiOpsScheduler.ts');
  // Coverage the families below do not describe means the platform has changed; nothing is guessed.
  if (!standard || dynamic || other.length) throw new Error(`dead-letter wrapping has moved (standard ${standard}, dynamic ${dynamic}, other ${other.map((o: Site) => `${o.file}:${o.line}`).join(', ') || 'none'}); the families need re-reading`);
  const out = new Map<Family, Set<string>>(ORDER.map((f) => [f, new Set<string>()]));
  for (const e of ix.registry) {
    const f: Family = e.registry === 'DYNAMIC_SCHEDULE_REGISTRY' ? 'dynamic_registry'
      : e.how === 'trackAgentRun' || e.how === 'director_gate' ? 'can_dead_letter'
      : e.how === 'unknown' ? 'unknown' : 'wrapped_but_swallowed';
    out.get(f)!.add(e.agentName);
  }
  for (const s of ix.inline) out.get('inline')!.add(s.name);
  // The registries' own task starters pass `schedule`; their timers are already counted by entry.
  for (const s of ix.scheduleSites) {
    if ((s.file === 'backend/src/services/aiOpsScheduler.ts' && s.schedule === '(schedule)') || ix.inline.some((i) => i.file === s.file && i.schedule_line === s.line)) continue;
    out.get('other_timers')!.add(`${s.file}:${s.line}`);
  }
  return ORDER.map((family) => {
    const jobs = [...out.get(family)!].sort();
    return { family, can_dead_letter: CAN[family], count: jobs.length, why: WHY[family], jobs };
  });
}

export function report(ix: TimerIndex, s: DeadLetterSnapshot): DeadLetterAnswer {
  const fams = families(ix);
  const familyOf = (job: string): Family | 'not_in_source' => fams.find((f) => f.jobs.includes(job))?.family ?? 'not_in_source';
  const classes = new Map<string, DeadLetterRow[]>();
  for (const r of s.dead_letter_jobs) classes.set(r.error_class, [...(classes.get(r.error_class) ?? []), r]);
  const by_class: ClassReport[] = [...classes].map(([error_class, rows]) => {
    const jobs = [...new Set(rows.map((r) => r.job_name))].sort();
    const times = rows.map((r) => r.created_at).sort();
    return { error_class, rows: rows.length, jobs: jobs.map((job) => ({ job, family: familyOf(job), rows: rows.filter((r) => r.job_name === job).length })), first_at: times[0], last_at: times[times.length - 1], row_ids: rows.map((r) => r.id).sort() };
  }).sort((a, b) => b.rows - a.rows || a.error_class.localeCompare(b.error_class));
  const published = s.publishing_jobs.filter((j) => j.dead_lettered_at);
  const pub = new Map<string, string[]>();
  for (const j of published) { const c = j.last_error_class ?? 'not recorded'; pub.set(c, [...(pub.get(c) ?? []), j.id]); }
  const pubClasses = [...pub].map(([error_class, ids]) => ({ error_class, rows: ids.length, row_ids: ids.sort() })).sort((a, b) => b.rows - a.rows || a.error_class.localeCompare(b.error_class));

  const total = fams.reduce((n, f) => n + f.count, 0);
  const can = fams.filter((f) => f.can_dead_letter === true).reduce((n, f) => n + f.count, 0);
  const named = fams.filter((f) => f.can_dead_letter !== true && f.count).map((f) => `${f.family} (${f.count})`).join(', ');
  const empty = !s.dead_letter_jobs.length && !published.length;
  const coverage = `Only ${can} of ${total} jobs can dead-letter. The rest cannot, or Ellis cannot tell: ${named}.`;
  const statement = empty
    ? `Nothing is dead-lettered in either mechanism. That does not mean the fleet is healthy. ${coverage}`
    : `${s.dead_letter_jobs.length} row(s) in dead_letter_jobs and ${published.length} in publishing_jobs. ${coverage}`;
  return {
    captured_at: s.captured_at, source_commit: ix.source_commit,
    verdict: empty ? 'queue_empty' : 'dead_lettered', statement,
    dead_letter_jobs: { rows: s.dead_letter_jobs.length, marked_resolved: s.dead_letter_jobs.filter((r) => r.resolved).length, by_class },
    publishing_jobs: { rows: published.length, by_class: pubClasses },
    coverage: { total_jobs: total, can_dead_letter: can, cannot_or_unknown: total - can, families: fams },
    limits: [...LIMITS],
  };
}
