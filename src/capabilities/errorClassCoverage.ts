// platform.error_class_coverage, first release behaviour (R2):
// reports current classification coverage as a share of all recorded failures, with a generic class counted as
// unclassified, and names every catch site on the cron path that records no class. Read-only. The vocabulary
// itself is K.D.'s decision: Ellis measures against none and only says which classes it saw.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - instrumentCronJob captures only the message and the stack (services/cronInstrumentation.ts:64-65) and writes
//   them to ai_agent_activity_logs, which has no class column (models/AiAgentActivityLog.ts). details is
//   JSONB and null on this path (:96), so details.error_class is the only place a class could sit on the row.
// - wrapWithDeadLetter is the one capture point: err?.constructor?.name || err?.name || 'Error'
//   (deadLetterService.ts:46), so a plain throw records the generic value the platform's standard forbids.
// - The standard names TimeoutError, RateLimitError, AuthError, ValidationError, UpstreamUnavailable and
//   ContractViolation as examples, and says generic Error is not acceptable (CLAUDE.md, Observability Framework).
// - Activity rows mark a failure as 'failed' on most paths and 'failure' on a few.

import { catchSites, type CatchSite, type CatchKind } from '../inventory/catchSites.ts';
import type { TimerIndex } from '../inventory/timerHomes.ts';
import type { Reader } from './registryReconciliation.ts';

export interface ActivityRow { id: string; action: string; result: string; details: { error_class?: unknown } | null; created_at: string }
export interface DeadLetterClassRow { id: string; job_name: string; error_class: string | null; created_at: string }
export interface CoverageSnapshot { captured_at: string; captured_by: string; ai_agent_activity_logs: ActivityRow[]; dead_letter_jobs: DeadLetterClassRow[] }
export const TABLES = ['ai_agent_activity_logs', 'dead_letter_jobs'] as const;

export type ClassKind = 'named_in_standard' | 'language_builtin' | 'other';
export interface ClassCount { error_class: string; kind: ClassKind; rows: number; row_ids: string[] }
export interface StoreCoverage { failures: number; classified: number; unclassified: number; unclassified_ids: string[]; generic: number; no_class: number }
export interface CoverageAnswer {
  captured_at: string;
  source_commit: string | null;
  window_days: number;
  verdict: 'measured' | 'no_failures';
  statement: string;
  coverage: { failures: number; classified: number; unclassified: number; percent: number | null };
  by_store: { ai_agent_activity_logs: StoreCoverage; dead_letter_jobs: StoreCoverage };
  classes: ClassCount[];
  catch_sites: { files_read: string[]; total: number; records_class: number; no_class: number; by_kind: Record<CatchKind, number>; records_no_class: CatchSite[] };
  vocabulary: { decided: false; decided_by: 'K.D.'; note: string };
  limits: string[];
}

const GENERIC = new Set(['', 'error', 'unknown', 'unknownerror', 'unclassified', 'exception', 'undefined', 'null', 'object']);
export const NAMED = new Set(['TimeoutError', 'RateLimitError', 'AuthError', 'ValidationError', 'UpstreamUnavailable', 'ContractViolation']);
const BUILTIN = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError', 'AggregateError']);
const FAILED = new Set(['failed', 'failure', 'error']);
const WRAPPERS = ['cronInstrumentation', 'agentRunTracker', 'aiOrchestrator', 'aiOpsScheduler', 'deadLetterService', 'schedulerService'].map((f) => `backend/src/services/${f}.ts`);
const KINDS: CatchKind[] = ['records_class', 'class_may_be_generic', 'records_no_class', 'rethrows', 'logs_only', 'silent', 'not_read'];

export const LIMITS: readonly string[] = [
  'A class-looking word is not an agreed class: until K.D. decides the vocabulary, classified means only not generic.',
  'A language built-in such as TypeError counts as classified here, and is shown apart: it names how code broke, not why.',
  'A failure written only to ai_agents, as trackAgentRun does, has no row here, so it is outside this measure.',
  'One failure can have both an activity row and a dead-letter row, so the total counts records, not distinct failures.',
  'Catch sites are read in the cron wrappers, the scheduler and inside cron.schedule callbacks. A runner in another file is not read.',
  'A handler is read by the names in it, so a handler that delegates to a function counts by what is written at the site.',
];

export function isGeneric(c: unknown): boolean { return typeof c !== 'string' || GENERIC.has(c.trim().toLowerCase()); }
const kindOfClass = (c: string): ClassKind => (NAMED.has(c) ? 'named_in_standard' : BUILTIN.has(c) ? 'language_builtin' : 'other');

function store(rows: Array<{ id: string; cls: unknown }>): StoreCoverage {
  const unclassified = rows.filter((r) => isGeneric(r.cls));
  const noClass = unclassified.filter((r) => r.cls === null || r.cls === undefined).length;
  return { failures: rows.length, classified: rows.length - unclassified.length, unclassified: unclassified.length, unclassified_ids: unclassified.map((r) => r.id).sort(), generic: unclassified.length - noClass, no_class: noClass };
}

export function cronPathFiles(ix: TimerIndex): string[] {
  return [...new Set([...WRAPPERS, ...ix.scheduleSites.map((s) => s.file), ...ix.inline.map((s) => s.file)])].sort();
}

export function coverage(r: Reader, ix: TimerIndex, s: CoverageSnapshot, opts: { window_days: number }): CoverageAnswer {
  const end = Date.parse(s.captured_at);
  const start = end - opts.window_days * 86400000;
  const inWindow = (at: string) => { const t = Date.parse(at); return t > start && t <= end; };
  const activity = s.ai_agent_activity_logs.filter((a) => FAILED.has(a.result) && inWindow(a.created_at)).map((a) => ({ id: a.id, cls: a.details?.error_class }));
  const dead = s.dead_letter_jobs.filter((d) => inWindow(d.created_at)).map((d) => ({ id: d.id, cls: d.error_class }));
  const a = store(activity), d = store(dead);
  const failures = a.failures + d.failures, classified = a.classified + d.classified;
  const counts = new Map<string, string[]>();
  for (const x of [...activity, ...dead]) if (!isGeneric(x.cls)) counts.set(x.cls as string, [...(counts.get(x.cls as string) ?? []), x.id]);
  const classes = [...counts].map(([error_class, ids]) => ({ error_class, kind: kindOfClass(error_class), rows: ids.length, row_ids: ids.sort() })).sort((x, y) => y.rows - x.rows || x.error_class.localeCompare(y.error_class));

  const files = cronPathFiles(ix);
  const sites = files.flatMap((f) => catchSites(f, r.read(f), !WRAPPERS.includes(f)));
  const by_kind = Object.fromEntries(KINDS.map((k) => [k, sites.filter((c) => c.kind === k).length])) as Record<CatchKind, number>;
  const noClass = sites.filter((c) => c.kind !== 'records_class' && c.kind !== 'class_may_be_generic');
  const percent = failures ? Math.round((classified / failures) * 1000) / 10 : null;
  const siteLine = `${noClass.length} of ${sites.length} catch sites on the cron path record no class.`;
  return {
    captured_at: s.captured_at, source_commit: ix.source_commit, window_days: opts.window_days,
    verdict: failures ? 'measured' : 'no_failures',
    statement: failures
      ? `${classified} of ${failures} recorded failures carry a specific class (${percent}%), counted over all recorded failures in ${opts.window_days} days. ${siteLine}`
      : `No failure is recorded in ${opts.window_days} days, so coverage is unknown, not 100%. ${siteLine}`,
    coverage: { failures, classified, unclassified: failures - classified, percent },
    by_store: { ai_agent_activity_logs: a, dead_letter_jobs: d },
    classes,
    catch_sites: { files_read: files, total: sites.length, records_class: by_kind.records_class + by_kind.class_may_be_generic, no_class: noClass.length, by_kind, records_no_class: noClass },
    vocabulary: { decided: false, decided_by: 'K.D.', note: 'The vocabulary is a decision. Ellis measures against none, and marks only the classes the platform standard names as examples.' },
    limits: [...LIMITS],
  };
}
