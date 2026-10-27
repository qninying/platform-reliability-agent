// platform.cron_run_instrumentation, first release behaviour (R2):
// answers "did this job run, when, how long did it take, and did it fail" from what the cron wrappers
// recorded, and names the jobs it cannot answer for. A name with no ai_agents row is "not instrumented, no
// record exists", never "did not run": the wrapper runs that job and writes nothing, so the absence of a
// record says nothing about whether it ran. Ellis reads the instrumentation; it never becomes it. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bb1d3c3):
// - With no row, instrumentCronJob runs the job and returns with no log, warning or counter
//   (services/cronInstrumentation.ts:34-38); a failed registry lookup does the same (:26-32).
// - With a row: status 'running' (:60), then run_count, avg_duration_ms, last_run_at (the finish time),
//   error_count and last_error (:74-84), and one activity row with result, trace_id and duration_ms
//   (:88-100). Only err.message and err.stack are kept; the error's class is never recorded (:62-65).
// - A disabled or paused row is skipped with a log line and no activity row (:46-51), so a skip is never
//   persisted, although 'skipped' is in the activity log's vocabulary (models/AiAgentActivityLog.ts:4).
// - trackAgentRun keeps counters only: no activity row, and a failure sets last_error but never
//   error_count (services/agentRunTracker.ts:40-65).
// - A failure to set status 'running' is caught as the job's own failure (cronInstrumentation.ts:59-66),
//   so a failed record does not prove the job started.

import { GATES, type Gate, type TimerRow } from './agentEnableDisableControl.ts';
import type { Citation } from './orchestrationHealthWatch.ts';

export interface RunRow {
  id: string;
  agent_name: string;
  enabled: boolean;
  status: string;
  run_count: number;
  avg_duration_ms: number | null;
  last_run_at: string | null;
  error_count: number;
  last_error: string | null;
  last_error_at: string | null;
}
export interface RunLog { id: string; agent_id: string; action: string; result: string; trace_id: string | null; duration_ms: number | null; reason: string | null; created_at: string }

export interface RunSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: RunRow[];
  ai_agent_activity_logs: RunLog[];
  // The timer inventory (capability 13), and which files it covers, so "no timer" is said with its scope.
  timers: TimerRow[];
  timer_scope: string[];
}

// per_run: the wrapper writes one activity row per run. counters_only: only the row's counters move.
// unknown: no timer in the inventory decides under this row, or its wrapper's writes are not known.
export type Recording = 'per_run' | 'counters_only' | 'unknown';

export interface NotInstrumented {
  name: string;
  answer: 'not_instrumented';
  ran: null;
  timers: Array<{ timer: string; schedule: string; ref: string; note: string }>;
  statement: string;
  citations: Citation[];
}

export interface LastRun {
  finished_at: string;
  started_at: string | null;
  duration_ms: number | null;
  result: 'success' | 'failed' | null;
  error: string | null;
  error_class: null;
  trace_id: string | null;
  source: 'activity_log' | 'counters';
}

export interface Instrumented {
  name: string;
  answer: 'run_recorded' | 'no_run_recorded';
  row_id: string;
  enabled: boolean;
  status: string;
  recording: Recording;
  last_run: LastRun | null;
  failed: boolean | null;
  totals: { run_count: number; error_count: number; avg_duration_ms: number | null; activity_runs: number };
  cannot_say: string[];
  statement: string;
  citations: Citation[];
}

export interface Ambiguous { name: string; answer: 'ambiguous'; ran: null; row_ids: string[]; statement: string; citations: Citation[] }

export type RunAnswer = NotInstrumented | Instrumented | Ambiguous;

export const NOT_INSTRUMENTED = 'not instrumented, no record exists';

const PER_RUN: ReadonlySet<Gate> = new Set(['instrument_cron_job', 'run_agent']);
const byRef = (a: { ref: string }, b: { ref: string }) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);

// Both per-run wrappers write result, trace_id and duration_ms on every run row (cronInstrumentation.ts:88-100,
// aiOrchestrator.ts:265-271, :303-310); other activity rows for the same agent are its own actions, not runs.
const isRunRow = (l: RunLog) => (l.result === 'success' || l.result === 'failed') && typeof l.duration_ms === 'number' && l.trace_id !== null;

function recordingFor(timers: TimerRow[]): Recording {
  const kinds = new Set(timers.map((t) => t.gates[0].gate));
  if (kinds.size === 0) return 'unknown';
  if ([...kinds].every((k) => PER_RUN.has(k))) return 'per_run';
  if (kinds.size === 1 && kinds.has('track_agent_run')) return 'counters_only';
  return 'unknown';
}

function notInstrumented(snap: RunSnapshot, name: string): NotInstrumented {
  const timers = snap.timers.filter((t) => t.timer === name).sort(byRef).map((t) => {
    const first = t.gates[0];
    const note = !first || first.flag === null ? 'it checks no row, so nothing is recorded for it'
      : first.flag !== name ? `it records under row ${first.flag}; ask about ${first.flag} for its runs`
      : `with no row, its wrapper ${GATES[first.gate].noRow}`;
    return { timer: t.timer, schedule: t.schedule, ref: t.ref, note };
  });
  const timerText = timers.length
    ? ` A timer by that name fires: ${timers.map((t) => `${t.timer} (${t.schedule}, ${t.ref}), ${t.note}`).join('; ')}.`
    : ` No timer by that name was found in ${snap.timer_scope.join(', ')}.`;
  return {
    name, answer: 'not_instrumented', ran: null, timers,
    statement: `${name}: ${NOT_INSTRUMENTED}. There is no ai_agents row, and a job with no row runs without leaving a record (cronInstrumentation.ts:34-38), so whether it ran, when, for how long and whether it failed cannot be answered from the platform's records.${timerText}`,
    citations: [],
  };
}

export function askRun(snap: RunSnapshot, name: string): RunAnswer {
  const rows = snap.ai_agents.filter((a) => a.agent_name === name).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (rows.length === 0) return notInstrumented(snap, name);
  if (rows.length > 1) {
    return {
      name, answer: 'ambiguous', ran: null, row_ids: rows.map((r) => r.id),
      statement: `${name} has ${rows.length} ai_agents rows; the wrapper reads whichever one the lookup returns first, so no single run history can be given.`,
      citations: rows.map((r) => ({ table: 'ai_agents' as const, id: r.id, fields: ['agent_name'] })),
    };
  }

  const row = rows[0];
  const deciding = snap.timers.filter((t) => t.gates[0]?.flag === name).sort(byRef);
  const recording = recordingFor(deciding);
  const runs = snap.ai_agent_activity_logs.filter((l) => l.agent_id === row.id && isRunRow(l))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const kinds = new Set(deciding.map((t) => t.gates[0].gate));
  const errorRef = recording === 'counters_only' ? 'agentRunTracker.ts:61' : kinds.has('run_agent') && !kinds.has('instrument_cron_job') ? 'aiOrchestrator.ts:298' : 'cronInstrumentation.ts:62-65';
  const cannot: string[] = [`the error class: it is never recorded, only the message (${errorRef})`];

  let last: LastRun | null = null;
  if (runs[0]) {
    const r = runs[0];
    const started = typeof r.duration_ms === 'number' ? new Date(Date.parse(r.created_at) - r.duration_ms).toISOString() : null;
    last = { finished_at: r.created_at, started_at: started, duration_ms: r.duration_ms, result: r.result as 'success' | 'failed', error: r.result === 'failed' ? r.reason : null, error_class: null, trace_id: r.trace_id, source: 'activity_log' };
  } else if (row.last_run_at) {
    // trackAgentRun sets last_run_at and last_error_at together on a failure (agentRunTracker.ts:57-63).
    const failedLast = row.last_error_at !== null && Math.abs(Date.parse(row.last_error_at) - Date.parse(row.last_run_at)) < 1000;
    last = { finished_at: row.last_run_at, started_at: null, duration_ms: null, result: failedLast ? 'failed' : null, error: failedLast ? row.last_error : null, error_class: null, trace_id: null, source: 'counters' };
    cannot.push(recording === 'counters_only'
      ? 'each run\'s duration and outcome: this wrapper records no activity row, only the average duration and the last error (agentRunTracker.ts:40-65)'
      : 'each run\'s duration and outcome: no run rows for this agent are in this export');
    if (!failedLast) cannot.push('whether the last run succeeded: with no run row, only a last error recorded at the same moment shows a failure');
  }

  if (recording === 'counters_only') cannot.push('a failure count: this wrapper never increments error_count, so 0 errors here does not mean no failures (agentRunTracker.ts:52-64)');
  if (recording === 'unknown') cannot.push(deciding.length === 0 ? `which timer records under this row: none in ${snap.timer_scope.join(', ')} does` : 'what this row\'s wrapper records per run');
  if (deciding.length > 1) cannot.push(`which timer a run came from: ${deciding.length} timers record under this one row (${deciding.map((t) => t.ref).join(', ')})`);
  if (!row.enabled || row.status === 'paused') cannot.push(`skipped ticks: a ${row.enabled ? 'paused' : 'disabled'} job is skipped with no activity row (cronInstrumentation.ts:46-51), so no record tells a skip from a tick that never fired`);
  if (row.status === 'running') cannot.push('the current run\'s start or outcome: status is running, its start time is not recorded (last_run_at is the previous run\'s finish), and if the process stopped mid-run no outcome will ever be written');
  if (last?.result === 'failed' && last.source === 'activity_log' && kinds.has('instrument_cron_job')) cannot.push('that the failed run started its job: a failure to mark the row running is recorded the same way (cronInstrumentation.ts:59-66)');
  if (recording === 'per_run' && row.run_count > runs.length) cannot.push(`${row.run_count - runs.length} of ${row.run_count} counted runs: they have no run row in this export (an activity write can fail without failing the run, cronInstrumentation.ts:101-103, or the export is windowed)`);

  const hasRun = runs.length > 0 || row.run_count > 0 || row.last_run_at !== null;
  const failed = last ? (last.result === 'failed' ? true : last.result === 'success' ? false : null) : null;
  const how = last?.duration_ms !== null && last?.duration_ms !== undefined ? `, took ${last.duration_ms} ms` : '';
  const outcome = failed === true ? `, and failed${last?.error ? `: ${last.error}` : ''}` : failed === false ? ', and succeeded' : ', outcome not recorded';
  const statement = hasRun
    ? `${name} last finished at ${last?.finished_at ?? 'an unrecorded time'}${how}${outcome}. ${row.run_count} run(s) and ${row.error_count} error(s) are counted on its row.`
    : `${name} has a row but no run is recorded on it${row.enabled ? '' : ' (it is disabled)'}${row.status === 'paused' ? ' (it is paused)' : ''}.`;

  return {
    name, answer: hasRun ? 'run_recorded' : 'no_run_recorded', row_id: row.id, enabled: row.enabled, status: row.status,
    recording, last_run: last, failed,
    totals: { run_count: row.run_count, error_count: row.error_count, avg_duration_ms: row.avg_duration_ms, activity_runs: runs.length },
    cannot_say: cannot,
    statement: `${statement} Cannot say: ${cannot.join('; ')}.`,
    citations: [
      { table: 'ai_agents', id: row.id, fields: ['enabled', 'status', 'run_count', 'avg_duration_ms', 'last_run_at', 'error_count', 'last_error', 'last_error_at'] },
      ...runs.slice(0, 1).map((r) => ({ table: 'ai_agent_activity_logs' as const, id: r.id, fields: ['result', 'trace_id', 'duration_ms', 'reason', 'created_at'] })),
    ],
  };
}

export interface Coverage {
  per_run: Array<{ timer: string; ref: string; row: string }>;
  counters_only: Array<{ timer: string; ref: string; row: string }>;
  not_instrumented: Array<{ timer: string; schedule: string; ref: string }>;
  unknown: Array<{ timer: string; ref: string; row: string | null; why: string }>;
  scope: string[];
}

// Every timer in the inventory, grouped by what Ellis can answer for it.
export function coverage(snap: RunSnapshot): Coverage {
  const names = new Set(snap.ai_agents.map((a) => a.agent_name));
  const out: Coverage = { per_run: [], counters_only: [], not_instrumented: [], unknown: [], scope: snap.timer_scope };
  for (const t of [...snap.timers].sort(byRef)) {
    const first = t.gates[0];
    if (!first || first.flag === null) { out.unknown.push({ timer: t.timer, ref: t.ref, row: null, why: 'it checks no row, so nothing is recorded for it' }); continue; }
    if (!names.has(first.flag)) { out.not_instrumented.push({ timer: t.timer, schedule: t.schedule, ref: t.ref }); continue; }
    const r = recordingFor([t]);
    if (r === 'per_run') out.per_run.push({ timer: t.timer, ref: t.ref, row: first.flag });
    else if (r === 'counters_only') out.counters_only.push({ timer: t.timer, ref: t.ref, row: first.flag });
    else out.unknown.push({ timer: t.timer, ref: t.ref, row: first.flag, why: `what its wrapper (${first.gate}) records per run is not known` });
  }
  return out;
}
