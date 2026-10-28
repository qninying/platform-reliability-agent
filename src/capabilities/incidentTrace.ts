// platform.incident_trace_and_error_triage, first release behaviour (R2):
// assembles the full trace for a trace id, an activity row, an error record or a job name, and states the
// probable cause with the rows that support it. Where no trace exists the answer is "not traceable: this job is
// untracked" (or the exact reason the record links to no run), never a narrative pieced together from nearby
// rows. Ellis never marks an error resolved. Read-only.
//
// Platform behaviour this rests on (platform repo, commit c96f6a6):
// - A trace is the activity rows sharing one trace_id, in time order (services/aiOpsService.ts:317-329). Only the
//   wrapper's own summary row carries it: logAgentActivity stamps a trace id only when the caller passes one
//   (aiEventService.ts:49-76), runAgent hands the agent no trace (aiOrchestrator.ts:198, :213), and only
//   instrumentCronJob seeds the trace into the request context that AI events read (cronInstrumentation.ts:23-24;
//   runAgent, trackAgentRun and the director gate never do). The trace endpoint does not read ai_events.
// - The errors surface lists campaign_errors rows. Their one writer is CampaignRepairAgent's stalled-campaign
//   check (agents/campaignRepairAgent.ts:129), and their only link to a run, repair_attempt_id
//   (models/CampaignError.ts:94), is never written. So no error record leads to a run.
// - The same agent marks every unresolved error older than 7 days resolved, by "auto:CampaignRepairAgent"
//   (campaignRepairAgent.ts:161-169); a person marks one resolved as "admin" (aiOpsService.ts:198-203). Neither
//   checks that the cause is fixed.
// - The cron path's run row stores the error message and stack, but no error class (cronInstrumentation.ts:89-101).

import { type TimerRow, type Gate } from './agentEnableDisableControl.ts';

export interface TraceRow {
  id: string;
  agent_id: string | null;
  action: string;
  result: string | null;
  reason: string | null;
  trace_id: string | null;
  created_at: string;
  stack_trace?: string | null;
  details?: { errors?: string[] } | null;
}
export interface ErrorRow {
  id: string;
  campaign_id: string;
  component: string;
  severity: string;
  error_message: string;
  resolved: boolean;
  resolved_by: string | null;
  repair_attempt_id: string | null;
  created_at: string;
}
export interface EventRow { id: string; trace_id: string | null; event_type: string; created_at: string }
export interface TraceSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: Array<{ id: string; agent_name: string }>;
  ai_agent_activity_logs: TraceRow[];
  campaign_errors: ErrorRow[];
  ai_events: EventRow[];
  timers: TimerRow[];
  timer_scope: string[];
}
export type Query = { trace_id: string } | { activity_id: string } | { error_id: string } | { job: string };

export type Verdict = 'traced' | 'not_traceable' | 'not_found' | 'no_failure_recorded';
export type Reason = 'no_row' | 'wrapper_records_no_run' | 'row_has_no_trace' | 'error_links_to_no_run' | 'events_without_run';
export interface Step { table: 'ai_agent_activity_logs' | 'ai_events'; id: string; at: string; agent: string | null; what: string; result: string | null }
export interface Failure { row_id: string; kind: 'thrown' | 'reported' | 'failed'; message: string }

export interface TraceAnswer {
  query: Query;
  verdict: Verdict;
  reason: Reason | null;
  trace_id: string | null;
  steps: Step[];
  failures: Failure[];
  probable_cause: { statement: string; supporting_rows: string[] } | null;
  error_class: null;
  severity: null;
  error_record: { id: string; message: string; component: string; severity: string; resolved: string } | null;
  row_ids: string[];
  notes: string[];
  cannot_say: string[];
  statement: string;
}

export const UNTRACKED = 'Not traceable: this job is untracked';

// Whether a wrapper leaves a failed run as an activity row with a trace id. Only runAgent and instrumentCronJob do.
const RECORDS_RUN: Record<Gate, boolean | null> = {
  run_agent: true, instrument_cron_job: true, own_check: false, track_agent_run: false, director_gate: false, none: false, unknown: null,
};
const WHY_NOT: Partial<Record<Gate, string>> = {
  own_check: 'its failures are written as a health_scan_error system event, not an activity row (aiOrchestrator.ts:168-172); only its successful runs reach the activity log',
  track_agent_run: 'trackAgentRun updates counters and writes no activity row (agentRunTracker.ts:44-70)',
  director_gate: 'a workforce director\'s gate writes an activity row for a success or a skip, each with a fresh trace id, but none for a failure (workforce/workforceAgentRuntime.ts:150-180)',
  none: 'its timer never reads a row and records nothing',
};

const byTime = <T extends { at: string; id: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);

function failureOf(r: TraceRow): Failure | null {
  const errs = r.details?.errors ?? [];
  if (r.action === 'agent_execution_failed') return { row_id: r.id, kind: 'thrown', message: r.reason ?? 'no message recorded' };
  if (errs.length) return { row_id: r.id, kind: 'reported', message: errs[0] };
  if (r.result === 'failed') return { row_id: r.id, kind: 'failed', message: r.reason ?? 'no message recorded' };
  return null;
}

const CANNOT_SAY = [
  'whether a failure was ever fixed: a resolved error is marked resolved by a person or by a 7-day timer, and neither checks the cause (campaignRepairAgent.ts:161-169, aiOpsService.ts:198-203)',
  'the error class of a failure: the cron path records none (cronInstrumentation.ts:89-101); only the dead-letter writer captures one',
  'what an agent did inside a run: its own activity rows and, under runAgent, its AI calls carry no trace id',
];

export function trace(snap: TraceSnapshot, query: Query): TraceAnswer {
  const name = new Map(snap.ai_agents.map((a) => [a.id, a.agent_name]));
  const base = { query, reason: null, trace_id: null, steps: [], failures: [], probable_cause: null, error_class: null, severity: null, error_record: null, notes: [] as string[], cannot_say: CANNOT_SAY } as const;
  const answer = (a: Partial<TraceAnswer> & { verdict: Verdict; statement: string }): TraceAnswer => {
    const out = { ...base, notes: [...base.notes], ...a } as TraceAnswer;
    out.row_ids = [...new Set([...out.steps.map((s) => s.id), ...out.failures.map((f) => f.row_id), ...(out.error_record ? [out.error_record.id] : [])])];
    return out;
  };

  const assemble = (traceId: string, via: string): TraceAnswer => {
    const rows = snap.ai_agent_activity_logs.filter((r) => r.trace_id === traceId);
    const events = snap.ai_events.filter((e) => e.trace_id === traceId);
    if (!rows.length && !events.length) return answer({ verdict: 'not_found', trace_id: traceId, statement: `No record carries trace ${traceId}.` });
    if (!rows.length) {
      return answer({
        verdict: 'not_traceable', reason: 'events_without_run', trace_id: traceId,
        steps: events.map((e) => ({ table: 'ai_events' as const, id: e.id, at: e.created_at, agent: null, what: e.event_type, result: null })).sort(byTime),
        statement: `Not traceable: AI calls carry trace ${traceId}, but no run row does. Either a job with no ai_agents row made them (instrumentCronJob seeds the trace and then runs it untracked, cronInstrumentation.ts:23-24) or a web request did (middlewares/traceMiddleware.ts:20-24); the records do not say which.`,
      });
    }
    const steps: Step[] = [
      ...rows.map((r) => ({ table: 'ai_agent_activity_logs' as const, id: r.id, at: r.created_at, agent: r.agent_id ? name.get(r.agent_id) ?? null : null, what: r.action, result: r.result })),
      ...events.map((e) => ({ table: 'ai_events' as const, id: e.id, at: e.created_at, agent: null, what: e.event_type, result: null })),
    ].sort(byTime);
    const failures = rows.map(failureOf).filter((f): f is Failure => f !== null);
    const notes: string[] = [];
    if (events.length) notes.push(`${events.length} AI call(s) share this trace; the platform's trace view leaves them out, because it reads only activity rows (aiOpsService.ts:317-329)`);
    if (failures.some((f) => f.kind === 'thrown' || f.kind === 'failed')) notes.push('no error class is recorded for this failure (cronInstrumentation.ts:89-101); group it by message, not class');
    const cause = failures.length
      ? { statement: failures.map((f) => `the run ${f.kind === 'thrown' ? 'threw' : f.kind === 'reported' ? 'reported an error' : 'failed'}: "${f.message}" (row ${f.row_id})`).join('; '), supporting_rows: failures.map((f) => f.row_id) }
      : null;
    return answer({
      verdict: 'traced', trace_id: traceId, steps, failures, probable_cause: cause, notes,
      statement: `Trace ${traceId} (${via}): ${steps.length} record(s). ${cause ? `Probable cause, in the run's own words: ${cause.statement}.` : 'This trace records no failure.'}`,
    });
  };

  if ('trace_id' in query) return assemble(query.trace_id, 'as asked');

  if ('activity_id' in query) {
    const r = snap.ai_agent_activity_logs.find((x) => x.id === query.activity_id);
    if (!r) return answer({ verdict: 'not_found', statement: `No activity row ${query.activity_id} is in this export.` });
    if (!r.trace_id) {
      const f = failureOf(r);
      return answer({
        verdict: 'not_traceable', reason: 'row_has_no_trace', failures: f ? [f] : [],
        steps: [{ table: 'ai_agent_activity_logs', id: r.id, at: r.created_at, agent: r.agent_id ? name.get(r.agent_id) ?? null : null, what: r.action, result: r.result }],
        statement: `Not traceable: row ${r.id} carries no trace id. An agent's own rows get none, because the wrapper does not pass its trace to the agent (aiEventService.ts:49-76, aiOrchestrator.ts:213), so this row cannot be tied to the run that wrote it.`,
      });
    }
    return assemble(r.trace_id, `from activity row ${r.id}`);
  }

  if ('error_id' in query) {
    const e = snap.campaign_errors.find((x) => x.id === query.error_id);
    if (!e) return answer({ verdict: 'not_found', statement: `No error record ${query.error_id} is in this export.` });
    const resolved = !e.resolved ? 'unresolved'
      : e.resolved_by?.startsWith('auto:') ? `marked resolved by ${e.resolved_by.slice(5)} because it was over 7 days old, not because the cause was fixed (campaignRepairAgent.ts:161-169)`
      : `marked resolved by ${e.resolved_by ?? 'someone'}: a claim, not evidence that the cause is fixed`;
    const record = { id: e.id, message: e.error_message, component: e.component, severity: e.severity, resolved };
    const linked = e.repair_attempt_id ? snap.ai_agent_activity_logs.find((r) => r.id === e.repair_attempt_id) : null;
    if (!linked?.trace_id) {
      return answer({
        verdict: 'not_traceable', reason: 'error_links_to_no_run', error_record: record,
        statement: `Not traceable: error ${e.id} links to no run. Its only link, repair_attempt_id, is ${e.repair_attempt_id ? 'set to a row with no trace id' : 'empty, and nothing in the platform writes it'} (models/CampaignError.ts:94). The error itself says: "${e.error_message}".`,
      });
    }
    const t = assemble(linked.trace_id, `from error ${e.id}`);
    return { ...t, error_record: record, row_ids: [...new Set([...t.row_ids, e.id])] };
  }

  // A job by name: the newest failure under its row, or why there is none to follow.
  const job = query.job;
  const row = snap.ai_agents.find((a) => a.agent_name === job);
  const deciders = snap.timers.filter((t) => t.gates[0]?.flag === job);
  if (!row) {
    const how = deciders.length ? ` Its timer (${deciders.map((t) => t.ref).join(', ')}) finds no row and records nothing.` : ` No timer in ${snap.timer_scope.join(', ')} records under this name either.`;
    return answer({ verdict: 'not_traceable', reason: 'no_row', statement: `${UNTRACKED}. No ai_agents row carries ${job}.${how}` });
  }
  const recording = deciders.map((t) => RECORDS_RUN[t.gates[0].gate]);
  if (deciders.length && recording.every((x) => x === false)) {
    const why = [...new Set(deciders.map((t) => WHY_NOT[t.gates[0].gate]).filter(Boolean))].join('; ');
    const lead = deciders.every((t) => t.gates[0].gate === 'own_check') ? `Not traceable: ${job}'s failures leave no activity row` : UNTRACKED;
    return answer({ verdict: 'not_traceable', reason: 'wrapper_records_no_run', statement: `${lead}. ${job} has a row, but ${why}, so its failures cannot be followed in the activity log.` });
  }
  const failed = snap.ai_agent_activity_logs
    .filter((r) => r.agent_id === row.id && failureOf(r))
    .sort((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : a.id < b.id ? -1 : 1));
  if (!failed.length) {
    const notes = recording.includes(null) ? ['what one of its timers records is not known to Ellis'] : [];
    return answer({ verdict: 'no_failure_recorded', notes, statement: `No failure is recorded for ${job} in this export (captured ${snap.captured_at}).` });
  }
  const latest = failed[0];
  if (!latest.trace_id) {
    return answer({
      verdict: 'not_traceable', reason: 'row_has_no_trace', failures: [failureOf(latest)!],
      steps: [{ table: 'ai_agent_activity_logs', id: latest.id, at: latest.created_at, agent: job, what: latest.action, result: latest.result }],
      statement: `Not traceable: ${job}'s latest failure (row ${latest.id}) carries no trace id, so it cannot be tied to the run that wrote it.`,
    });
  }
  return assemble(latest.trace_id, `${job}'s latest failure, row ${latest.id}`);
}
