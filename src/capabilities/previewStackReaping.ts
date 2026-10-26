// platform.preview_stack_reaping, first release behaviour (R2):
// answers "which preview stacks are live, how idle is each, and which are reap candidates?" from the
// stack inventory and activity data. Idle is measured only from real access. A live stack with no
// access recorded is 'unknown_idle', never 'idle', and is never a reap candidate. Read-only; Ellis
// stops nothing (cloud_resource_deletion is default-denied, so the platform's timer does the stopping).
//
// Platform behaviour this rests on (platform repo, commit 4a34e9e):
// - PreviewStackReaper runs every 5 minutes (backend/src/services/schedulerService.ts:2331-2342) and
//   stops running stacks idle longer than PREVIEW_IDLE_TIMEOUT_MS, default 30 minutes
//   (backend/src/services/previewStackReaper.ts:14-30).
// - The only activity signal is last_accessed_at, set when a request passes the preview proxy
//   (backend/src/middlewares/previewProxyMiddleware.ts:113, previewStackService.ts:338-343).
// - For a stack never accessed, the reaper falls back to last_started_at, which is the stack's age,
//   not activity (previewStackReaper.ts:23-27). Ellis reports that case as unknown_idle and says the
//   platform would stop it anyway.
// - A stop is recorded as a preview_events 'stop' row with no detail, so a reaper stop and an admin
//   stop look the same (previewStackService.ts:307-308).

import type { ActivityLogRow, AiAgentRow } from '../records.ts';
import { newestFirst } from '../readSource.ts';
import type { Citation } from './orchestrationHealthWatch.ts';

export const REAPER = 'PreviewStackReaper';
export const PLATFORM_IDLE_MINUTES = 30;
const REAPER_INTERVAL_MINUTES = 5;
// A stack this long in a transitional status is reported as stuck.
const STUCK_MINUTES = 30;

// Fields as GET /api/admin/preview-stacks returns them (backend/src/routes/admin/previewStackRoutes.ts:20-55).
export interface PreviewStackRow {
  id: string;
  slug: string;
  status: 'provisioning' | 'running' | 'stopped' | 'failed' | 'tearing_down' | 'archived';
  last_accessed_at: string | null;
  last_started_at: string | null;
  last_stopped_at?: string | null;
  updated_at?: string | null;
}

export interface PreviewEventRow {
  id: string;
  preview_stack_id: string;
  event_type: string;
  created_at: string;
}

export interface PreviewSnapshot {
  captured_at: string;
  captured_by: string;
  preview_stacks: PreviewStackRow[];
  preview_events: PreviewEventRow[];
  ai_agents: AiAgentRow[];
  ai_agent_activity_logs: ActivityLogRow[];
}

export type IdleStatus = 'active' | 'idle' | 'unknown_idle';

export interface StackAnswer {
  slug: string;
  idle: IdleStatus;
  idle_minutes: number | null;
  reap_candidate: boolean;
  platform_would_stop: boolean;
  reason: string;
  citation: Citation;
}

export interface Attention {
  slug: string;
  status: PreviewStackRow['status'];
  reason: string;
  citation: Citation;
}

export interface ReapingReport {
  threshold: { minutes: number; source: 'platform_default' | 'given' };
  reaper: { status: 'ran' | 'overdue' | 'failed' | 'disabled' | 'never_run' | 'untracked'; at: string | null; reason: string };
  counts: Record<IdleStatus, number>;
  live: StackAnswer[];
  reap_candidates: string[];
  attention: Attention[];
  recent_stops: { count: number; window_hours: number; note: string; citations: Citation[] };
}

export interface ReapingOptions {
  now: Date;
  // The live value is PREVIEW_IDLE_TIMEOUT_MS on the server, which no export carries.
  idleMinutes?: number;
  stopWindowHours?: number;
}

export function reapingReport(snap: PreviewSnapshot, opts: ReapingOptions): ReapingReport {
  const minutes = opts.idleMinutes ?? PLATFORM_IDLE_MINUTES;
  const stacks = [...snap.preview_stacks].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const live = stacks.filter((s) => s.status === 'running').map((s) => judge(s, minutes, opts.now));
  const counts = { active: 0, idle: 0, unknown_idle: 0 };
  for (const s of live) counts[s.idle]++;
  return {
    threshold: { minutes, source: opts.idleMinutes === undefined ? 'platform_default' : 'given' },
    reaper: reaperStatus(snap, opts.now),
    counts,
    live,
    reap_candidates: live.filter((s) => s.reap_candidate).map((s) => s.slug),
    attention: stacks.flatMap((s) => attention(s, opts.now)),
    recent_stops: recentStops(snap, opts),
  };
}

function judge(s: PreviewStackRow, minutes: number, now: Date): StackAnswer {
  const citation: Citation = { table: 'preview_stacks', id: s.id, fields: ['status', 'last_accessed_at', 'last_started_at'] };
  const base = { slug: s.slug, citation };
  const startedAge = minutesSince(s.last_started_at, now);
  if (s.last_accessed_at === null) {
    const wouldStop = startedAge !== null && startedAge > minutes;
    const platform = s.last_started_at === null
      ? 'it also has no start time, so the platform reaper never selects it and it runs until someone stops it'
      : wouldStop
        ? `the platform reaper stops it anyway, by its age (started ${startedAge} minutes ago), not by activity`
        : 'the platform reaper will stop it by age once it is older than the threshold';
    return { ...base, idle: 'unknown_idle', idle_minutes: null, reap_candidate: false, platform_would_stop: wouldStop, reason: `no access has ever been recorded, so how idle it is cannot be known; ${platform}` };
  }
  const idle = minutesSince(s.last_accessed_at, now);
  if (idle === null || idle < 0) {
    return { ...base, idle: 'unknown_idle', idle_minutes: null, reap_candidate: false, platform_would_stop: false, reason: `last_accessed_at '${s.last_accessed_at}' is not a usable time` };
  }
  if (idle > minutes) {
    return { ...base, idle: 'idle', idle_minutes: idle, reap_candidate: true, platform_would_stop: true, reason: `last accessed ${idle} minutes ago, past the ${minutes}-minute threshold` };
  }
  return { ...base, idle: 'active', idle_minutes: idle, reap_candidate: false, platform_would_stop: false, reason: `last accessed ${idle} minutes ago` };
}

function attention(s: PreviewStackRow, now: Date): Attention[] {
  const citation: Citation = { table: 'preview_stacks', id: s.id, fields: ['status', 'updated_at'] };
  if (s.status === 'failed') return [{ slug: s.slug, status: s.status, reason: 'failed: its containers may still be partly running', citation }];
  if (s.status !== 'tearing_down' && s.status !== 'provisioning') return [];
  const age = minutesSince(s.updated_at ?? null, now);
  if (age !== null && age <= STUCK_MINUTES) return [];
  const since = age === null ? 'for an unknown time' : `for ${age} minutes`;
  return [{ slug: s.slug, status: s.status, reason: `${s.status} ${since}: a half-finished transition can leave orphaned containers`, citation }];
}

function reaperStatus(snap: PreviewSnapshot, now: Date): ReapingReport['reaper'] {
  const rows = snap.ai_agents.filter((a) => a.agent_name === REAPER);
  if (rows.length !== 1) return { status: 'untracked', at: null, reason: rows.length === 0 ? `no ai_agents row named ${REAPER}, so its runs are not recorded` : `${rows.length} rows named ${REAPER}; the records are inconsistent` };
  const agent = rows[0];
  if (!agent.enabled) return { status: 'disabled', at: agent.last_run_at, reason: 'the reaper is disabled, so idle stacks keep running' };
  const latest = snap.ai_agent_activity_logs.filter((r) => r.agent_id === agent.id).sort(newestFirst)[0];
  const at = latest?.created_at ?? agent.last_run_at;
  if (!at) return { status: 'never_run', at: null, reason: 'no reaper run is recorded' };
  if (latest?.result === 'failed') return { status: 'failed', at, reason: 'the latest reaper run failed' };
  const age = minutesSince(at, now);
  if (age === null || age > REAPER_INTERVAL_MINUTES * 2) return { status: 'overdue', at, reason: `last ran ${age ?? 'an unknown number of'} minutes ago; it should run every ${REAPER_INTERVAL_MINUTES}` };
  return { status: 'ran', at, reason: `last ran ${age} minutes ago` };
}

function recentStops(snap: PreviewSnapshot, opts: ReapingOptions): ReapingReport['recent_stops'] {
  const hours = opts.stopWindowHours ?? 24;
  const since = opts.now.getTime() - hours * 3_600_000;
  const stops = snap.preview_events.filter((e) => e.event_type === 'stop' && Date.parse(e.created_at) >= since).sort(newestFirst);
  return {
    count: stops.length,
    window_hours: hours,
    note: 'the platform records a stop without saying who stopped it, so reaper stops and admin stops are counted together',
    citations: stops.slice(0, 20).map((e) => ({ table: 'preview_events', id: e.id, fields: ['event_type', 'created_at'] })),
  };
}

function minutesSince(at: string | null, now: Date): number | null {
  if (at === null) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : Math.round((now.getTime() - t) / 60_000);
}
