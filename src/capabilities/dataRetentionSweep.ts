// platform.data_retention_sweep, first release behaviour (R2):
// answers "what is each table's retention window, and when was it last swept?" from run records.
// A window counts only when it is stated somewhere a person can read it: a K.D.-approved policy entry,
// a run record that carries retention_days, or the job's registry description. A window that appears
// only in code is 'unknown', never a number of days. Read-only; Ellis deletes nothing.
//
// Platform behaviour this rests on: src/retention/sweepCatalogue.ts (pinned at 769ff4e).
// - instrumentCronJob records last_run_at and one activity row per run for a job with an ai_agents row,
//   and runs a job with no row untracked (backend/src/services/cronInstrumentation.ts:19-104).
// - IntelligenceRetention writes RETENTION_CYCLE (archived, deleted, retention_days) or RETENTION_ERROR
//   to ai_system_events (backend/src/services/cory/intelligenceRetention.ts:141-157).

import type { ActivityLogRow, AiAgentRow } from '../records.ts';
import { newestFirst } from '../readSource.ts';
import type { Citation } from './orchestrationHealthWatch.ts';
import { SWEEPS, type SweepAction, type SweepSpec } from '../retention/sweepCatalogue.ts';

export interface SystemEventRow {
  id: string;
  source: string;
  event_type: string;
  details?: Record<string, unknown> | null;
  created_at: string;
}

// A window a person has approved. Ellis keeps these; the platform has no such register.
export interface PolicyEntry {
  id: string;
  table: string;
  days: number;
  approved_by: string;
  approved_at: string;
}

export interface RetentionSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: AiAgentRow[];
  ai_agent_activity_logs: ActivityLogRow[];
  ai_system_events: SystemEventRow[];
  retention_policy?: PolicyEntry[];
}

export type WindowSource = 'approved_policy' | 'run_record' | 'registry_description';
export type SweepStatus = 'swept' | 'overdue' | 'failed' | 'disabled' | 'never_run' | 'untracked';

export interface StatedWindow {
  source: WindowSource;
  days: number;
  citation: Citation;
}

export interface TableAnswer {
  table: string;
  job: string;
  action: SweepAction;
  window: { status: 'stated' | 'conflicting' | 'unknown'; days: number | null; reason: string; stated: StatedWindow[] };
  code_check: { follows_stated_window: boolean | null; note: string };
  last_sweep: { status: SweepStatus; at: string | null; reason: string };
  rows_removed: { count: number | null; reason: string };
  risks: string[];
  code_ref: string;
  citations: Citation[];
}

export interface RetentionOptions {
  now: Date;
  sweeps?: SweepSpec[];
}

const DAYS_IN_TEXT = /older than (\d+) days?/i;

export function retentionReport(snap: RetentionSnapshot, opts: RetentionOptions): TableAnswer[] {
  return (opts.sweeps ?? SWEEPS).map((spec) => answer(snap, spec, opts));
}

function answer(snap: RetentionSnapshot, spec: SweepSpec, opts: RetentionOptions): TableAnswer {
  const rows = snap.ai_agents.filter((a) => a.agent_name === spec.job);
  const agent = rows.length === 1 ? rows[0] : undefined;
  const runs = agent ? snap.ai_agent_activity_logs.filter((r) => r.agent_id === agent.id).sort(newestFirst) : [];
  const events = spec.runRecordSource ? snap.ai_system_events.filter((e) => e.source === spec.runRecordSource).sort(newestFirst) : [];
  const latestCycle = events.find((e) => e.event_type === 'RETENTION_CYCLE');

  const stated = statedWindows(snap, spec, agent, latestCycle);
  const window = decideWindow(spec, stated);
  const citations: Citation[] = [];
  if (agent) citations.push({ table: 'ai_agents', id: agent.id, fields: ['enabled', 'last_run_at', 'description'] });

  const last_sweep = lastSweep(spec, rows.length, agent, runs, events, opts, citations);
  return {
    table: spec.table,
    job: spec.job,
    action: spec.action,
    window,
    code_check: codeCheck(spec, window),
    last_sweep,
    rows_removed: rowsRemoved(spec, latestCycle),
    risks: spec.risks,
    code_ref: spec.codeRef,
    citations,
  };
}

function statedWindows(snap: RetentionSnapshot, spec: SweepSpec, agent: AiAgentRow | undefined, cycle: SystemEventRow | undefined): StatedWindow[] {
  const out: StatedWindow[] = [];
  for (const p of snap.retention_policy ?? []) {
    if (p.table === spec.table && validDays(p.days)) out.push({ source: 'approved_policy', days: p.days, citation: { table: 'retention_policy', id: p.id, fields: ['days', 'approved_by', 'approved_at'] } });
  }
  const recorded = cycle?.details?.retention_days;
  if (cycle && validDays(recorded)) out.push({ source: 'run_record', days: recorded, citation: { table: 'ai_system_events', id: cycle.id, fields: ['details.retention_days'] } });
  const m = agent?.description?.match(DAYS_IN_TEXT);
  if (agent && m && validDays(Number(m[1]))) out.push({ source: 'registry_description', days: Number(m[1]), citation: { table: 'ai_agents', id: agent.id, fields: ['description'] } });
  return out;
}

function decideWindow(spec: SweepSpec, stated: StatedWindow[]): TableAnswer['window'] {
  if (stated.length === 0) {
    return { status: 'unknown', days: null, stated, reason: `no approved policy, run record or registry description states a window for ${spec.table}; a window that appears only in code (${spec.codeRef}) is not a stated policy` };
  }
  const distinct = [...new Set(stated.map((s) => s.days))];
  if (distinct.length > 1) {
    return { status: 'conflicting', days: null, stated, reason: `the stated windows disagree (${stated.map((s) => `${s.source} ${s.days} days`).join(', ')}); a person has to decide which is the policy` };
  }
  return { status: 'stated', days: distinct[0], stated, reason: `stated by ${stated.map((s) => s.source).join(' and ')}` };
}

function codeCheck(spec: SweepSpec, window: TableAnswer['window']): TableAnswer['code_check'] {
  if (window.days === null) return { follows_stated_window: null, note: 'no single stated window to compare the code with' };
  if (spec.codeDays === null) return { follows_stated_window: null, note: 'the code does not fix a number of days (see risks), so it cannot be compared' };
  const follows = spec.codeDays === window.days;
  return { follows_stated_window: follows, note: follows ? 'the code uses the stated window' : `the code uses a different window from the stated one (${spec.codeRef})` };
}

function lastSweep(spec: SweepSpec, rowCount: number, agent: AiAgentRow | undefined, runs: ActivityLogRow[], events: SystemEventRow[], opts: RetentionOptions, citations: Citation[]): TableAnswer['last_sweep'] {
  if (!agent) {
    const why = rowCount === 0 ? `no ai_agents row named ${spec.job}, so its runs are not recorded` : `${rowCount} ai_agents rows named ${spec.job}; the records are inconsistent`;
    return { status: 'untracked', at: null, reason: why };
  }
  if (!agent.enabled) return { status: 'disabled', at: agent.last_run_at, reason: 'the job is disabled, so the table is not being swept' };
  const latest = runs[0];
  if (!latest && !agent.last_run_at) return { status: 'never_run', at: null, reason: 'no run is recorded for this job' };
  if (latest) citations.push({ table: 'ai_agent_activity_logs', id: latest.id, fields: ['result', 'created_at'] });
  if (latest?.result === 'failed') return { status: 'failed', at: latest.created_at, reason: 'the latest run failed' };
  // The job catches its own errors, so a failed cycle shows only as a newer RETENTION_ERROR.
  const newestEvent = events[0];
  if (newestEvent?.event_type === 'RETENTION_ERROR') {
    citations.push({ table: 'ai_system_events', id: newestEvent.id, fields: ['event_type', 'created_at'] });
    return { status: 'failed', at: newestEvent.created_at, reason: 'the run was recorded as a success, but the job logged RETENTION_ERROR' };
  }
  const at = latest?.created_at ?? agent.last_run_at!;
  const ageHours = (opts.now.getTime() - Date.parse(at)) / 3_600_000;
  if (ageHours > spec.cadenceHours * 2) return { status: 'overdue', at, reason: `last swept ${Math.round(ageHours)} hours ago; it should run every ${spec.cadenceHours} hours` };
  return { status: 'swept', at, reason: `last swept ${Math.round(ageHours)} hours ago` };
}

function rowsRemoved(spec: SweepSpec, cycle: SystemEventRow | undefined): TableAnswer['rows_removed'] {
  if (!spec.runRecordSource) return { count: null, reason: 'not recorded: this job keeps no count in any record' };
  const deleted = cycle?.details?.deleted;
  if (!cycle || typeof deleted !== 'number') return { count: null, reason: 'no RETENTION_CYCLE record with a deleted count' };
  return { count: deleted, reason: `from RETENTION_CYCLE at ${cycle.created_at}` };
}

function validDays(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}
