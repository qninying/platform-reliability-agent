// platform.security_oversight_rollup, first release behaviour (R2):
// one security verdict a person can act on, with every contributing scanner listed as clean, dirty or
// unknown. The rollup is 'green' only when every contribution is clean; any unknown makes it 'unknown'
// and asks for escalation, because a rollup over scanners that did not run is not a verdict. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 769ff4e):
// - SecurityDirectorAgent rolls up every ten minutes (backend/src/services/aiOpsScheduler.ts:328) over
//   seven security timers (:329-335). It calls a subordinate healthy when `status !== 'error' && enabled`
//   (backend/src/services/agents/security/securityDirectorAgent.ts:63) and its verdict is 'normal' when
//   no threat or alert event arrived in the window (:119-123). It never reads last_run_at, so a scanner
//   that never ran, or stopped, leaves the platform verdict 'normal'. This module does the opposite.
// - A run with errors is logged as a success by runAgent, so details.errors is checked here as well as
//   result (backend/src/services/aiOrchestrator.ts:814-816 wraps the director the same way).
// - The secret, code and dependency answers come from security_posture_scan, which already treats a
//   scan of 0 files, a skipped scan and a stale scan as unknown.

import type { AiAgentRow, ActivityLogRow, DepartmentEventRow } from '../records.ts';
import type { ReadSource } from '../readSource.ts';
import type { Citation } from './orchestrationHealthWatch.ts';
import { answerScan, SCANNERS, type ScanKind, type ScanStatus } from './securityPostureScan.ts';

export type Contribution = 'clean' | 'dirty' | 'unknown';
export type RollupVerdict = 'green' | 'red' | 'unknown';

interface TimerSpec {
  agentName: string;
  intervalMinutes: number;
  scan?: ScanKind;
}

// The director's seven subordinates, in scheduler order (aiOpsScheduler.ts:329-335 at 769ff4e).
export const CONTRIBUTORS: TimerSpec[] = [
  { agentName: SCANNERS.secret.agentName, intervalMinutes: 4 * 60, scan: 'secret' },
  { agentName: SCANNERS.code.agentName, intervalMinutes: 24 * 60, scan: 'code' },
  { agentName: SCANNERS.dependency.agentName, intervalMinutes: 24 * 60, scan: 'dependency' },
  { agentName: 'RuntimeThreatMonitorAgent', intervalMinutes: 5 },
  { agentName: 'AccessControlGuardianAgent', intervalMinutes: 24 * 60 },
  { agentName: 'AISafetyMonitorAgent', intervalMinutes: 5 },
  { agentName: 'AgentBehaviorMonitorAgent', intervalMinutes: 10 },
];

const DIRECTOR = 'SecurityDirectorAgent';
const DIRTY_EVENT_TYPES = ['threat_detected', 'security_alert'];
const DIRTY_SEVERITIES = ['high', 'critical'];

export interface ContributionAnswer {
  agent_name: string;
  contribution: Contribution;
  reason: string;
  last_run_at: string | null;
  citations: Citation[];
}

export interface Rollup {
  verdict: RollupVerdict;
  reason: string;
  escalate: boolean;
  counts: Record<Contribution, number>;
  contributions: ContributionAnswer[];
  platform_director: { verdict: string | null; at: string | null; disagrees: boolean; citation: Citation | null };
}

export interface RollupOptions {
  now: Date;
  // A contribution is stale, so unknown, once its last run is older than this many of its intervals.
  missedIntervals?: number;
  contributors?: TimerSpec[];
}

export function securityRollup(source: ReadSource, opts: RollupOptions): Rollup {
  const contributions = (opts.contributors ?? CONTRIBUTORS).map((spec) => contribute(source, spec, opts));
  const counts = { clean: 0, dirty: 0, unknown: 0 };
  for (const c of contributions) counts[c.contribution]++;
  const { verdict, reason } = decide(counts, contributions.length);
  // A red rollup with unknowns is still incomplete: whatever the silent scanners would add is missing.
  const escalate = verdict === 'unknown' || counts.unknown > 0;
  return { verdict, reason, escalate, counts, contributions, platform_director: director(source, verdict) };
}

function decide(counts: Record<Contribution, number>, total: number): { verdict: RollupVerdict; reason: string } {
  const unknownNote = counts.unknown > 0 ? ` ${counts.unknown} more could not be checked.` : '';
  if (counts.dirty > 0) return { verdict: 'red', reason: `${counts.dirty} of ${total} scanners report a problem.${unknownNote}` };
  if (total === 0) return { verdict: 'unknown', reason: 'no scanners contribute, so there is nothing to vouch for the platform' };
  if (counts.unknown > 0) return { verdict: 'unknown', reason: `${counts.unknown} of ${total} scanners cannot be checked, so the rollup is not trustworthy and is never green` };
  return { verdict: 'green', reason: `all ${total} scanners ran inside their interval and report clean` };
}

function contribute(source: ReadSource, spec: TimerSpec, opts: RollupOptions): ContributionAnswer {
  const base = { agent_name: spec.agentName, last_run_at: null, citations: [] as Citation[] };
  const rows = source.findAgentsByName(spec.agentName);
  if (rows.length !== 1) {
    const why = rows.length === 0 ? 'no ai_agents row, so its timer records no last_run_at' : `${rows.length} ai_agents rows share this name; the records are inconsistent`;
    return { ...base, contribution: 'unknown', reason: why };
  }
  const agent = rows[0];
  const citations: Citation[] = [{ table: 'ai_agents', id: agent.id, fields: ['enabled', 'status', 'last_run_at'] }];
  const known = { ...base, last_run_at: agent.last_run_at, citations };
  const gate = runGate(agent, spec, opts);
  if (gate) return { ...known, contribution: 'unknown', reason: gate };

  const latest = source.recentActivity(agent.id, 1)[0];
  if (latest && runFailed(latest)) {
    citations.push(activityCite(latest));
    return { ...known, contribution: 'unknown', reason: `its latest run ${latest.result === 'failed' ? 'failed' : 'reported errors'}, so its silence is not a clean result` };
  }
  if (spec.scan) return fromScan(source, spec.scan, opts, known);

  const since = opts.now.getTime() - spec.intervalMinutes * 60_000 * (opts.missedIntervals ?? 2);
  const bad = source.departmentEvents(spec.agentName, 50).filter((e) => Date.parse(e.created_at) >= since && isDirty(e));
  if (bad.length > 0) {
    citations.push(...bad.slice(0, 5).map(eventCite));
    return { ...known, contribution: 'dirty', reason: `${bad.length} threat or alert event(s) at high or critical severity since its last expected run` };
  }
  return { ...known, contribution: 'clean', reason: `ran ${minutesAgo(agent.last_run_at!, opts.now)} minutes ago with no threat or alert event` };
}

// Every reason a scanner's silence cannot be read as clean, checked before any result is looked at.
function runGate(agent: AiAgentRow, spec: TimerSpec, opts: RollupOptions): string | null {
  if (!agent.enabled) return 'disabled: a scanner that is switched off is silent, not clean';
  if (agent.status === 'error' || agent.status === 'paused') return `status is '${agent.status}', so it is not scanning`;
  if (agent.last_run_at === null) return 'no last_run_at: there is no record that this scanner has ever run';
  const limit = spec.intervalMinutes * (opts.missedIntervals ?? 2);
  const age = minutesAgo(agent.last_run_at, opts.now);
  if (Number.isNaN(age)) return `last_run_at '${agent.last_run_at}' is not a time`;
  if (age > limit) return `last ran ${age} minutes ago; it runs every ${spec.intervalMinutes} minutes, so it has missed its interval`;
  return null;
}

function fromScan(source: ReadSource, kind: ScanKind, opts: RollupOptions, known: Omit<ContributionAnswer, 'contribution' | 'reason'>): ContributionAnswer {
  const scan = answerScan(source, kind, opts);
  const map: Record<ScanStatus, Contribution> = { findings: 'dirty', clean: 'clean', unknown: 'unknown' };
  const citations = [...known.citations, ...scan.citations.filter((c) => c.table !== 'ai_agents')];
  return { ...known, citations, contribution: map[scan.status], reason: scan.reason };
}

// The platform's own rollup, for comparison: the latest event the director wrote.
function director(source: ReadSource, ours: RollupVerdict): Rollup['platform_director'] {
  const e = source.departmentEvents(DIRECTOR, 1)[0];
  if (!e) return { verdict: null, at: null, disagrees: false, citation: null };
  const verdict = e.severity ?? null;
  const theirsGreen = verdict === 'normal';
  return { verdict, at: e.created_at, disagrees: theirsGreen !== (ours === 'green'), citation: eventCite(e) };
}

function isDirty(e: DepartmentEventRow): boolean {
  return DIRTY_EVENT_TYPES.includes(e.event_type) || DIRTY_SEVERITIES.includes(e.severity ?? '');
}

function runFailed(r: ActivityLogRow): boolean {
  return r.result === 'failed' || (r.details?.errors?.length ?? 0) > 0;
}

function minutesAgo(at: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(at)) / 60_000);
}

function activityCite(r: ActivityLogRow): Citation {
  return { table: 'ai_agent_activity_logs', id: r.id, fields: ['result', 'created_at', 'details'] };
}

function eventCite(e: DepartmentEventRow): Citation {
  return { table: 'department_events', id: e.id, fields: ['event_type', 'severity', 'created_at'] };
}
