// platform.system_resilience_supervision, first release behaviour (R2):
// reports the platform's resilience posture with each contributing subsystem's state and the age of
// its last signal. A subsystem with no signal, or a signal too old to trust, is 'unknown', and any
// unknown subsystem keeps the overall verdict off 'healthy'. Read-only.
//
// Platform behaviour this rests on (platform repo, commit a284987):
// - Eight department super agents report every 30 minutes (backend/src/services/aiOpsScheduler.ts:347-354),
//   each writing a department_reports row whose metrics carry health and collection_ok
//   (agents/departments/superAgents/superAgentBase.ts:138-158).
// - SystemResilienceSuperAgent supervises only the system_resilience group, which holds three
//   course-content agents (agentRegistrySeed.ts:3411-3413), not the agents its header names
//   (systemResilienceSuperAgent.ts:4). Its staleness rule is one hour for every agent
//   (superAgentHealth.ts:99, :197), so a one-minute timer can be silent for 59 minutes unnoticed.
//   Ellis measures each timer against its own schedule instead.
// - The wrapper always returns errors: [] (systemResilienceSuperAgent.ts:17), so a blind cycle never
//   counts as a failed run (aiOrchestrator.ts:231).
// - Dara has three timers writing one ai_agents row (aiOpsScheduler.ts:367, :369, :375), so a
//   failure cannot be attributed to a timer and a recent run shows only that one of them ran.
// - Circuit breaker state lives in server memory only (agents/openclaw/openclawCircuitBreaker.ts:42-43),
//   and a breaker with fewer than 5 tasks in the hour reads CLOSED (:61-63), so CLOSED is not evidence.

import type { Citation } from './orchestrationHealthWatch.ts';

export type SubsystemState = 'healthy' | 'degraded' | 'unknown';
type Kind = 'supervisor' | 'timer' | 'circuit_breakers';

interface SubsystemSpec {
  name: string;
  kind: Kind;
  everyMinutes: number;
  timersSharingRow?: number;
}

export const SUBSYSTEMS: SubsystemSpec[] = [
  ...['CampaignOpsSuperAgent', 'LeadIntelligenceSuperAgent', 'ContentEngineSuperAgent', 'AnalyticsEngineSuperAgent',
    'SystemResilienceSuperAgent', 'AdmissionsSuperAgent', 'PartnershipSuperAgent', 'FinanceSuperAgent']
    .map((name): SubsystemSpec => ({ name, kind: 'supervisor', everyMinutes: 30 })),
  { name: 'PromptMonitorAgent', kind: 'timer', everyMinutes: 1 },
  { name: 'OrchestrationHealthAgent', kind: 'timer', everyMinutes: 5 },
  { name: 'OrchestrationAutoRepairAgent', kind: 'timer', everyMinutes: 5 },
  { name: 'Dara', kind: 'timer', everyMinutes: 24 * 60, timersSharingRow: 3 },
  { name: 'openclaw_circuit_breakers', kind: 'circuit_breakers', everyMinutes: 30 },
];

const PLATFORM_SUPERVISOR = 'SystemResilienceSuperAgent';
const KNOWN_STATUSES = ['idle', 'running', 'error', 'paused'];
const CIRCUIT_MIN_SAMPLE = 5;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface ResilienceAgentRow {
  id: string;
  agent_name: string;
  enabled: boolean;
  status: string;
  last_run_at: string | null;
  run_count: number;
  error_count: number;
  last_error?: string | null;
}

export interface DepartmentReportRow {
  id: string;
  department: string;
  source_agent: string | null;
  created_at: string;
  metrics?: Record<string, unknown> | null;
}

export interface CircuitRow {
  platform: string;
  state: string;
  error_count: number;
  total_count: number;
}

export interface ResilienceSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: ResilienceAgentRow[];
  department_reports: DepartmentReportRow[];
  // An export of GET /api/admin/openclaw/circuit-status with the time it was taken, or null.
  circuit_status: { captured_at: string; statuses: CircuitRow[] } | null;
}

export interface SubsystemAnswer {
  subsystem: string;
  kind: Kind;
  state: SubsystemState;
  reason: string;
  last_signal_at: string | null;
  signal_age_minutes: number | null;
  expected_every_minutes: number;
  attribution: 'available' | 'unavailable';
  notes: string[];
  citations: Citation[];
}

export interface PostureReport {
  verdict: SubsystemState;
  reason: string;
  counts: Record<SubsystemState, number>;
  unknown: string[];
  degraded: string[];
  subsystems: SubsystemAnswer[];
  platform_supervisor: { health: string | null; at: string | null; disagrees: boolean; citation: Citation | null };
}

type Judged = Pick<SubsystemAnswer, 'state' | 'reason'> & { at: string | null; notes?: string[]; citations: Citation[]; attribution?: 'unavailable' };

export function resiliencePosture(snap: ResilienceSnapshot, opts: { now: string }): PostureReport {
  const now = Date.parse(opts.now);
  if (!Number.isFinite(now)) throw new RangeError(`now '${opts.now}' is not a readable time`);
  const subsystems = SUBSYSTEMS.map((spec) => answer(spec, judge(spec, snap, now), now));
  const counts = { healthy: 0, degraded: 0, unknown: 0 };
  for (const s of subsystems) counts[s.state]++;
  const unknown = subsystems.filter((s) => s.state === 'unknown').map((s) => s.subsystem);
  const degraded = subsystems.filter((s) => s.state === 'degraded').map((s) => s.subsystem);
  const verdict: SubsystemState = unknown.length > 0 ? 'unknown' : degraded.length > 0 ? 'degraded' : 'healthy';
  const reason = verdict === 'healthy'
    ? `all ${subsystems.length} subsystems have a recent signal and report healthy`
    : verdict === 'unknown'
      ? `${unknown.length} subsystem(s) have no usable signal, so the posture cannot be called healthy${degraded.length ? `; ${degraded.length} also report a problem` : ''}`
      : `${degraded.length} subsystem(s) report a problem`;
  return { verdict, reason, counts, unknown, degraded, subsystems, platform_supervisor: platformSupervisor(snap, verdict) };
}

function judge(spec: SubsystemSpec, snap: ResilienceSnapshot, now: number): Judged {
  if (spec.kind === 'supervisor') return judgeSupervisor(spec, latestReport(snap, spec.name), now);
  if (spec.kind === 'timer') return judgeTimer(spec, snap.ai_agents.filter((a) => a.agent_name === spec.name).sort(byId)[0], now);
  return judgeCircuits(spec, snap.circuit_status, now);
}

function answer(spec: SubsystemSpec, j: Judged, now: number): SubsystemAnswer {
  const at = j.at !== null && Number.isFinite(Date.parse(j.at)) ? j.at : null;
  return {
    subsystem: spec.name, kind: spec.kind, state: j.state, reason: j.reason,
    last_signal_at: at, signal_age_minutes: at === null ? null : Math.floor((now - Date.parse(at)) / 60000),
    expected_every_minutes: spec.everyMinutes, attribution: j.attribution ?? 'available', notes: j.notes ?? [], citations: j.citations,
  };
}

// A signal's time decides whether it can be trusted at all: unreadable, in the future or older than two
// of its intervals reads as no signal.
function timeProblem(at: string | null, everyMinutes: number, now: number): string | null {
  if (at === null) return 'no signal has ever been recorded';
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return `the signal time '${at}' is not readable`;
  if (t - now > FUTURE_SKEW_MS) return `the signal time ${at} is in the future`;
  const age = Math.floor((now - t) / 60000);
  if (age > 2 * everyMinutes) return `the last signal is ${age} minutes old; it is expected every ${everyMinutes} minutes`;
  return null;
}

function judgeSupervisor(spec: SubsystemSpec, r: DepartmentReportRow | undefined, now: number): Judged {
  if (!r) return { state: 'unknown', reason: 'this supervisor has never written a department report', at: null, citations: [] };
  const citations: Citation[] = [{ table: 'department_reports', id: r.id, fields: ['source_agent', 'created_at', 'metrics'] }];
  const late = timeProblem(r.created_at, spec.everyMinutes, now);
  if (late) return { state: 'unknown', reason: late, at: r.created_at, citations };
  const m = r.metrics ?? {};
  if (m.collection_ok !== true) return { state: 'unknown', reason: 'the supervisor could not read its own agents, or did not say whether it could', at: r.created_at, citations };
  if (m.total === 0) return { state: 'unknown', reason: 'the supervisor reports on 0 agents, so it certifies nothing', at: r.created_at, citations };
  if (m.health === 'healthy') return { state: 'healthy', reason: 'its latest report is healthy', at: r.created_at, citations };
  if (m.health === 'degraded') return { state: 'degraded', reason: 'its latest report is degraded', at: r.created_at, citations };
  return { state: 'unknown', reason: `its latest report gives health '${String(m.health ?? 'none')}'`, at: r.created_at, citations };
}

function judgeTimer(spec: SubsystemSpec, a: ResilienceAgentRow | undefined, now: number): Judged {
  if (!a) return { state: 'unknown', reason: 'no ai_agents row exists, so no run is recorded', at: null, citations: [] };
  const citations: Citation[] = [{ table: 'ai_agents', id: a.id, fields: ['enabled', 'status', 'last_run_at', 'run_count', 'error_count'] }];
  const shared = (spec.timersSharingRow ?? 1) > 1;
  const base = { at: a.last_run_at, citations, ...(shared ? { attribution: 'unavailable' as const, notes: [`${spec.timersSharingRow} timers write to this one row, so a failure cannot be attributed to a timer`] } : {}) };
  if (!a.enabled) return { ...base, state: 'degraded', reason: 'it is switched off' };
  if (!KNOWN_STATUSES.includes(a.status)) return { ...base, state: 'unknown', reason: `status '${a.status}' is not a known agent status` };
  if (a.status === 'error') return { ...base, state: 'degraded', reason: `it is in error${a.last_error ? `: ${a.last_error}` : ''}` };
  if (a.status === 'paused') return { ...base, state: 'degraded', reason: 'it is enabled but paused' };
  if (a.run_count === 0) return { ...base, state: 'unknown', reason: 'it has never recorded a run' };
  const late = timeProblem(a.last_run_at, spec.everyMinutes, now);
  if (late) return { ...base, state: 'unknown', reason: late };
  if (a.error_count >= a.run_count) return { ...base, state: 'degraded', reason: `every recorded run failed (${a.error_count} of ${a.run_count})` };
  // A shared row is judged on its own signal: if every timer stops, it goes stale and reads unknown. What
  // it cannot say is which timer ran, so the reason says so instead of claiming all of them did.
  if (shared) return { ...base, state: 'healthy', reason: `at least one of the ${spec.timersSharingRow} timers on this row ran on schedule; which ones cannot be told` };
  return { ...base, state: 'healthy', reason: 'it ran on schedule and is not in error' };
}

function judgeCircuits(spec: SubsystemSpec, cs: ResilienceSnapshot['circuit_status'], now: number): Judged {
  if (!cs) return { state: 'unknown', reason: 'breaker state is held in server memory only and no circuit-status export was supplied', at: null, citations: [] };
  const citations: Citation[] = [{ table: 'circuit_status_export', id: cs.captured_at, fields: ['platform', 'state', 'total_count'] }];
  const late = timeProblem(cs.captured_at, spec.everyMinutes, now);
  if (late) return { state: 'unknown', reason: late, at: cs.captured_at, citations };
  const rows = [...cs.statuses].sort((a, b) => (a.platform < b.platform ? -1 : 1));
  const odd = rows.filter((r) => !['CLOSED', 'OPEN', 'HALF_OPEN'].includes(r.state)).map((r) => r.platform);
  const open = rows.filter((r) => r.state === 'OPEN' || r.state === 'HALF_OPEN').map((r) => `${r.platform} ${r.state}`);
  const thin = rows.filter((r) => r.state === 'CLOSED' && r.total_count < CIRCUIT_MIN_SAMPLE).map((r) => r.platform);
  const notes = thin.length ? [`CLOSED on fewer than ${CIRCUIT_MIN_SAMPLE} tasks is not evidence: ${thin.join(', ')}`] : [];
  if (odd.length) return { state: 'unknown', reason: `unrecognised breaker state for ${odd.join(', ')}`, at: cs.captured_at, notes, citations };
  if (open.length) return { state: 'degraded', reason: `breakers open: ${open.join(', ')}`, at: cs.captured_at, notes, citations };
  if (rows.length === thin.length) return { state: 'unknown', reason: 'no breaker had enough tasks in the hour to be judged', at: cs.captured_at, notes, citations };
  return { state: 'healthy', reason: 'every breaker with enough tasks to judge is closed', at: cs.captured_at, notes, citations };
}

function latestReport(snap: ResilienceSnapshot, agent: string): DepartmentReportRow | undefined {
  return snap.department_reports
    .filter((r) => r.source_agent === agent)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))[0];
}

function platformSupervisor(snap: ResilienceSnapshot, verdict: SubsystemState): PostureReport['platform_supervisor'] {
  const r = latestReport(snap, PLATFORM_SUPERVISOR);
  if (!r) return { health: null, at: null, disagrees: false, citation: null };
  const health = typeof r.metrics?.health === 'string' ? r.metrics.health : null;
  return { health, at: r.created_at, disagrees: health === 'healthy' && verdict !== 'healthy', citation: { table: 'department_reports', id: r.id, fields: ['metrics'] } };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
