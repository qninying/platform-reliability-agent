// platform.cron_overlap_guard, first release behaviour (R2):
// names every timer whose recorded duration can exceed its own interval, with both figures, and states which
// jobs already hold their own claim. A timer with no duration data is unassessable, never safe. Read-only:
// applying a guard to a live timer is a deploy, which stays a person's.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - The timers pass only { timezone: 'America/Chicago' } to cron.schedule (services/aiOpsScheduler.ts:559, :570).
// - instrumentCronJob has no lock and no in-flight check: a second tick starts while the first runs
//   (services/cronInstrumentation.ts:53-61).
// - It reads the row before the run and writes run_count and avg_duration_ms from that copy (:28, :68-72), so
//   overlapping runs overwrite each other's counters. Per-run duration_ms in the activity log (:98) does not.
// - created_at on that row is written after the run ends, so start = created_at - duration_ms.
// - With no ai_agents row the job runs with no record (:36-39). trackAgentRun moves the row's counters and
//   writes no activity row (services/agentRunTracker.ts:44-55), so it has an average and no worst run.

import { parseCron, gapRange } from '../inventory/cronExpression.ts';
import { arrayAfter, topObjects, ownString } from '../inventory/registrySource.ts';
import { claimIndex, guardAtLine, guardInStarter, type ClaimSite, type LibraryGuard } from '../inventory/claimSites.ts';
import type { TimerIndex } from '../inventory/timerHomes.ts';
import type { Reader } from './registryReconciliation.ts';

export interface AgentRow { id: string; agent_name: string; enabled: boolean; avg_duration_ms: number | null }
export interface RunRow { id: string; agent_id: string; action: string; result: string; duration_ms: number | null; created_at: string }
export interface ConfigRow { agent_name: string; active_schedule: string; enabled: boolean }
export interface OverlapSnapshot { captured_at: string; captured_by: string; ai_agents: AgentRow[]; ai_agent_activity_logs: RunRow[]; cron_schedule_configs: ConfigRow[] }
export const TABLES = ['ai_agents', 'ai_agent_activity_logs', 'cron_schedule_configs'] as const;

export type Verdict = 'can_overlap' | 'not_seen_to_overlap' | 'unassessable';
export type Basis = 'observed_overlap' | 'worst_run' | 'average' | 'within_interval';
export type Unassessable = 'schedule_not_read' | 'no_run_name' | 'no_row_named' | 'no_agents_row' | 'no_duration_recorded' | 'average_only';

export interface TimerAnswer {
  timer: string;
  where: string[];
  schedule: string | null;
  enabled: boolean | null;
  interval_ms: number | null;
  duration: { average_ms: number | null; worst_ms: number | null; worst_row_id: string | null; runs_in_window: number };
  verdict: Verdict;
  basis: Basis | null;
  unassessable_because: Unassessable | null;
  observed_overlaps: { count: number; row_ids: string[] };
  guard: { library: LibraryGuard | null; own_claim: 'claim_found' | 'none_found'; claim_sites: ClaimSite[] };
}

export interface OverlapAnswer {
  captured_at: string;
  source_commit: string | null;
  window_days: number;
  verdict: 'can_overlap' | 'none_assessable_overlap' | 'all_clear_on_record';
  statement: string;
  counts: { timers: number; can_overlap: number; not_seen_to_overlap: number; unassessable: number; holding_own_claim: number };
  can_overlap: TimerAnswer[];
  unassessable: TimerAnswer[];
  not_seen_to_overlap: TimerAnswer[];
  claims: { sites: number; tied_to_a_timer: number; not_tied: ClaimSite[] };
  policy_open: { decided: false; decided_by: 'K.D.'; question: string };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'Not seen to overlap is not safe: it means no recorded run exceeded the interval in the window.',
  'A job that ran few times has a worst run drawn from few runs; runs_in_window says how few.',
  'The interval is the shortest gap between fires, in UTC, over the next eight days. The platform schedules in America/Chicago, so a gap across a clock change can differ by an hour.',
  'An average comes from counters that overlapping runs overwrite, so it is a weak figure. Ellis uses it alone only to flag a timer, never to clear one.',
  'A start time is derived from the finish time and the duration; a run that never finished has no row, so an overlap with it is not seen.',
  'A claim is read from source text, one hop from the timer into the function it imports. Finding one does not prove it holds, and it may guard only part of the job; none_found does not prove there is none.',
  'noOverlap is per process and only holds if the callback returns the run. Whether the platform runs each timer in one process is not read here.',
  'Two timers on one row share its durations, and each is measured against its own interval only, unless a real overlap was recorded.',
];

const DAY = 86_400_000;
const SCHEDULER = 'backend/src/services/aiOpsScheduler.ts';
const STARTER = { SCHEDULE_REGISTRY: 'startStandardTask', DYNAMIC_SCHEDULE_REGISTRY: 'startDynamicTask' } as const;

function intervalOf(expr: string | null, now: Date): number | null {
  const c = expr === null ? null : parseCron(expr);
  if (!c) return null;
  return (gapRange(c, now) ?? gapRange(c, now, 400))?.shortest ?? null;
}

// Two runs of one job overlap when the later one started before an earlier one finished.
function overlaps(runs: RunRow[]): { count: number; row_ids: string[] } {
  const spans = runs.flatMap((r) => (r.duration_ms === null ? [] : [{ id: r.id, end: Date.parse(r.created_at), start: Date.parse(r.created_at) - r.duration_ms }])).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const ids = new Set<string>();
  let count = 0;
  let last: (typeof spans)[number] | null = null;
  for (const s of spans) {
    if (last && s.start < last.end) { count++; ids.add(last.id); ids.add(s.id); }
    if (!last || s.end > last.end) last = s;
  }
  return { count, row_ids: [...ids].sort() };
}

interface Seed { timer: string; row: string | null; where: string[]; schedule: string | null; enabled: boolean | null; library: LibraryGuard | null; claim_sites: ClaimSite[] }

function seeds(r: Reader, ix: TimerIndex, s: OverlapSnapshot, job: (file: string, snippet: string) => ClaimSite[]): Seed[] {
  const scheduler = r.read(SCHEDULER);
  const entries = new Map((['export const SCHEDULE_REGISTRY', 'const DYNAMIC_SCHEDULE_REGISTRY']).flatMap((m) => topObjects(arrayAfter(scheduler, m))).map(({ text }) => [ownString(text, 'agentName'), text]));
  const reg: Seed[] = ix.registry.map((e) => {
    const cfg = s.cron_schedule_configs.find((c) => c.agent_name === e.agentName);
    return { timer: e.agentName, row: e.row, where: [`${SCHEDULER}:${e.line}`], schedule: cfg?.active_schedule || e.schedule || null, enabled: cfg?.enabled ?? true, library: guardInStarter(scheduler, STARTER[e.registry]), claim_sites: job(SCHEDULER, entries.get(e.agentName) ?? '') };
  });
  const callText = (file: string, line: number) => r.read(file).split('\n').slice(line - 1, line + 15).join('\n');
  const inline: Seed[] = ix.inline.map((t) => ({
    timer: t.name, row: t.name, where: [`${t.file}:${t.line}`], schedule: t.schedule, enabled: null,
    library: t.schedule_line === null ? null : guardAtLine(r.read(t.file), t.schedule_line), claim_sites: job(t.file, callText(t.file, t.schedule_line ?? t.line)),
  }));
  const placed = new Set(ix.inline.map((t) => `${t.file}:${t.schedule_line}`));
  const unnamed: Seed[] = ix.scheduleSites
    .filter((x) => !placed.has(`${x.file}:${x.line}`) && !(x.file === SCHEDULER && x.schedule.startsWith('(')))
    .map((x) => ({ timer: `${x.file}:${x.line}`, row: null, where: [`${x.file}:${x.line}`], schedule: x.schedule.startsWith('(') ? null : x.schedule, enabled: null, library: guardAtLine(r.read(x.file), x.line), claim_sites: job(x.file, callText(x.file, x.line)) }));
  return [...reg, ...inline, ...unnamed];
}

function assess(t: Seed, s: OverlapSnapshot, now: Date, windowDays: number): TimerAnswer {
  const interval = intervalOf(t.schedule, now);
  const agent = t.row ? s.ai_agents.find((a) => a.agent_name === t.row) ?? null : null;
  const from = now.getTime() - windowDays * DAY;
  const runs = agent ? s.ai_agent_activity_logs.filter((x) => x.agent_id === agent.id && x.action === t.row && Date.parse(x.created_at) > from && Date.parse(x.created_at) <= now.getTime()) : [];
  const timed = runs.filter((x) => x.duration_ms !== null);
  const worst = timed.reduce<RunRow | null>((a, x) => (!a || (x.duration_ms as number) > (a.duration_ms as number) ? x : a), null);
  const average = agent?.avg_duration_ms ?? null;
  const seen = overlaps(runs);
  const worstMs = worst?.duration_ms ?? null;
  const base = { timer: t.timer, where: t.where, schedule: t.schedule, enabled: agent ? (t.enabled ?? true) && agent.enabled : t.enabled, interval_ms: interval, duration: { average_ms: average, worst_ms: worstMs, worst_row_id: worst?.id ?? null, runs_in_window: runs.length }, observed_overlaps: seen, guard: { library: t.library, own_claim: t.claim_sites.length ? 'claim_found' as const : 'none_found' as const, claim_sites: t.claim_sites } };
  const no = (why: Unassessable): TimerAnswer => ({ ...base, verdict: 'unassessable', basis: null, unassessable_because: why });
  const yes = (basis: Basis): TimerAnswer => ({ ...base, verdict: 'can_overlap', basis, unassessable_because: null });
  if (seen.count) return yes('observed_overlap');
  if (interval === null) return no('schedule_not_read');
  if (t.row === null) return no(t.timer.includes(':') ? 'no_run_name' : 'no_row_named');
  if (!agent) return no('no_agents_row');
  if (worstMs !== null && worstMs > interval) return yes('worst_run');
  if (average !== null && average > interval) return yes('average');
  if (worstMs === null) return no(average === null ? 'no_duration_recorded' : 'average_only');
  return { ...base, verdict: 'not_seen_to_overlap', basis: 'within_interval', unassessable_because: null };
}

export function overlapGuard(r: Reader, ix: TimerIndex, s: OverlapSnapshot, opts: { window_days: number }): OverlapAnswer {
  const now = new Date(s.captured_at);
  const claims = claimIndex(r);
  const all = seeds(r, ix, s, claims.job).map((t) => assess(t, s, now, opts.window_days)).sort((a, b) => a.timer.localeCompare(b.timer));
  const pick = (v: Verdict) => all.filter((t) => t.verdict === v);
  const can = pick('can_overlap'), un = pick('unassessable'), not = pick('not_seen_to_overlap');
  const tied = new Set(all.flatMap((t) => t.guard.claim_sites.map((c) => `${c.file}:${c.line}`)));
  const holding = all.filter((t) => t.guard.own_claim === 'claim_found').length;
  const verdict = can.length ? 'can_overlap' : un.length ? 'none_assessable_overlap' : 'all_clear_on_record';
  return {
    captured_at: s.captured_at, source_commit: ix.source_commit, window_days: opts.window_days, verdict,
    statement: `${all.length} timers: ${can.length} can overlap, ${un.length} cannot be assessed, ${not.length} not seen to overlap in ${opts.window_days} days. Own claim found for ${holding}.`,
    counts: { timers: all.length, can_overlap: can.length, not_seen_to_overlap: not.length, unassessable: un.length, holding_own_claim: holding },
    can_overlap: can, unassessable: un, not_seen_to_overlap: not,
    claims: { sites: claims.sites.length, tied_to_a_timer: claims.sites.filter((c) => tied.has(`${c.file}:${c.line}`)).length, not_tied: claims.sites.filter((c) => !tied.has(`${c.file}:${c.line}`)) },
    policy_open: { decided: false, decided_by: 'K.D.', question: 'Should a skipped tick be recorded as a missed run? It changes what the missed-run detector reports.' },
    limits: [...LIMITS],
  };
}
