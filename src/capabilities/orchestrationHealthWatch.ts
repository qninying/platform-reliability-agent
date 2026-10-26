// platform.orchestration_health_watch, first release behaviour (R2):
// answers "is orchestration healthy right now, and when did it last change" from the ai_agents row
// and the activity log only. Every answer cites the rows it used; an agent name with no ai_agents
// row gets a refusal, never an answer.
//
// Platform behaviour this rests on (platform repo, commit c99021d):
// - runAgent skips a disabled or paused row with a console line only, so a skip writes no activity
//   row (backend/src/services/aiOrchestrator.ts:184, :189). Silence from a disabled row is expected.
// - OrchestrationHealthAgent catches its own failure into errors[] instead of throwing
//   (backend/src/services/agents/orchestrationHealthAgent.ts:114). runAgent then logs result
//   'failed' while the action text can read 'scan_completed_no_issues' (aiOrchestrator.ts:233, :238),
//   and the ai_agents row is set back to 'idle' (aiOrchestrator.ts:216). So `result` decides a
//   failed run; the action text and the row's status never do.
// - Each finding is logged as action `finding_<severity>` (orchestrationHealthAgent.ts:103), and the
//   platform's own rule is: any critical finding is critical, else any warning is degraded, else
//   healthy (backend/src/services/healthReportService.ts:155-157).

import type { ActivityLogRow, AiAgentRow } from '../records.ts';
import type { ReadSource } from '../readSource.ts';

export const ORCHESTRATION_AGENT = 'OrchestrationHealthAgent';

export type RunVerdict = 'healthy' | 'degraded' | 'critical' | 'run_failed' | 'unknown';
export type Verdict = RunVerdict | 'stalled' | 'not_running';

export interface Citation {
  table: 'ai_agents' | 'ai_agent_activity_logs' | 'department_events' | 'ai_system_events' | 'retention_policy' | 'preview_stacks' | 'preview_events' | 'scheduled_emails';
  id: string;
  fields: string[];
}

export interface HealthAnswer {
  kind: 'answer';
  agent_name: string;
  verdict: Verdict;
  reason: string;
  as_of: string;
  last_change: { at: string | null; from: RunVerdict | null; note: string };
  rows_read: number;
  citations: Citation[];
}

export interface Refusal {
  kind: 'refusal';
  agent_name: string;
  reason: string;
  citations: [];
}

export interface WatchOptions {
  now: Date;
  agentName?: string;
  activityLimit?: number;
  // A run is overdue when the newest activity row is older than this many schedule intervals.
  missedIntervals?: number;
}

export function classifyRun(row: ActivityLogRow): RunVerdict {
  if (row.result === 'failed' || row.action === 'agent_execution_failed') return 'run_failed';
  if (row.result !== 'success') return 'unknown';
  const actions = [row.action, ...(row.details?.actions ?? []).map((a) => a.action ?? '')].join(' ');
  if (actions.includes('finding_critical')) return 'critical';
  if (actions.includes('finding_warning')) return 'degraded';
  return 'healthy';
}

// Only the platform's "every N minutes" form is understood; anything else returns null and the
// overdue check is skipped and said so, rather than guessed.
export function scheduleIntervalMs(schedule: string | null): number | null {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec((schedule ?? '').trim());
  return m ? Number(m[1]) * 60_000 : null;
}

export function watchOrchestrationHealth(source: ReadSource, opts: WatchOptions): HealthAnswer | Refusal {
  const agentName = opts.agentName ?? ORCHESTRATION_AGENT;
  const rows = source.findAgentsByName(agentName);
  if (rows.length === 0) {
    return refuse(agentName, `no ai_agents row named ${agentName}; a verdict for an agent with no row cannot be recorded or checked, so none is given`);
  }
  if (rows.length > 1) {
    return refuse(agentName, `${rows.length} ai_agents rows named ${agentName} (${rows.map((r) => r.id).join(', ')}); agent_name is unique on the platform, so the records are inconsistent and no answer is given`);
  }
  const agent = rows[0];
  const activity = source.recentActivity(agent.id, opts.activityLimit ?? 50);
  return answerFor(agent, activity, opts);
}

function answerFor(agent: AiAgentRow, activity: ActivityLogRow[], opts: WatchOptions): HealthAnswer {
  const agentCite: Citation = { table: 'ai_agents', id: agent.id, fields: ['agent_name', 'enabled', 'status', 'schedule', 'last_run_at'] };
  const base = { kind: 'answer' as const, agent_name: agent.agent_name, as_of: opts.now.toISOString(), rows_read: activity.length };
  const change = lastChange(activity);
  const cites = [agentCite, ...change.cited.map(activityCite)];

  if (!agent.enabled || agent.status === 'paused') {
    const why = !agent.enabled ? 'enabled is false' : "status is 'paused'";
    return { ...base, verdict: 'not_running', reason: `the ai_agents row is not running: ${why}. Skipped runs write no activity row, so no new verdict is being recorded`, last_change: change.summary, citations: cites };
  }
  if (activity.length === 0) {
    return { ...base, verdict: 'unknown', reason: 'no activity row has been recorded for this agent, so there is no verdict to report', last_change: change.summary, citations: cites };
  }

  const latest = activity[0];
  const interval = scheduleIntervalMs(agent.schedule);
  const missed = opts.missedIntervals ?? 3;
  if (interval !== null) {
    const ageMs = opts.now.getTime() - Date.parse(latest.created_at);
    if (ageMs > interval * missed) {
      return { ...base, verdict: 'stalled', reason: `newest activity row is ${Math.round(ageMs / 60_000)} minutes old; schedule '${agent.schedule}' expects a run every ${interval / 60_000} minutes (overdue after ${missed} missed runs)`, last_change: change.summary, citations: cites };
    }
  }
  const verdict = classifyRun(latest);
  const scheduleNote = interval === null ? ` Overdue check skipped: schedule '${agent.schedule}' is not in the '*/N * * * *' form.` : '';
  return { ...base, verdict, reason: `${reasonFor(verdict, latest)}.${scheduleNote}`, last_change: change.summary, citations: cites };
}

// Walks newest to oldest and stops at the first run whose verdict differs from the newest one.
function lastChange(activity: ActivityLogRow[]): { summary: HealthAnswer['last_change']; cited: ActivityLogRow[] } {
  if (activity.length === 0) {
    return { summary: { at: null, from: null, note: 'no activity rows to compare' }, cited: [] };
  }
  const current = classifyRun(activity[0]);
  for (let i = 1; i < activity.length; i++) {
    const before = classifyRun(activity[i]);
    if (before !== current) {
      return {
        summary: { at: activity[i - 1].created_at, from: before, note: `changed from ${before} to ${current} at run ${activity[i - 1].id}` },
        cited: i - 1 === 0 ? [activity[0], activity[i]] : [activity[0], activity[i - 1], activity[i]],
      };
    }
  }
  const oldest = activity[activity.length - 1];
  return {
    summary: { at: null, from: null, note: `${current} in all ${activity.length} rows read, back to ${oldest.created_at}; any earlier change is outside the rows read` },
    cited: activity.length === 1 ? [activity[0]] : [activity[0], oldest],
  };
}

function reasonFor(verdict: RunVerdict, row: ActivityLogRow): string {
  switch (verdict) {
    case 'run_failed':
      return `newest run has result 'failed' (action '${row.action}'); the run did not produce a verdict, whatever its action text says`;
    case 'critical':
      return 'newest run logged at least one finding_critical';
    case 'degraded':
      return 'newest run logged finding_warning and no finding_critical';
    case 'healthy':
      return 'newest run succeeded with no critical or warning finding';
    default:
      return `newest run has result '${row.result}', which carries no verdict`;
  }
}

function activityCite(row: ActivityLogRow): Citation {
  return { table: 'ai_agent_activity_logs', id: row.id, fields: ['action', 'result', 'created_at'] };
}

function refuse(agentName: string, reason: string): Refusal {
  return { kind: 'refusal', agent_name: agentName, reason, citations: [] };
}
