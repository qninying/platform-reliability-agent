// platform.cron_health_alerting, first release behaviour (R2):
// answers "which cron jobs are error-spiking or overdue right now, and which cannot be evaluated at all",
// using the live thresholds and the live check's own selection, so a job the check never looks at is listed
// as not evaluated instead of being left out. Ellis reproduces what the check would raise; it never raises
// an alert itself. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 4443087):
// - The check selects ai_agents rows with trigger_type 'cron' and enabled true, and nothing else
//   (services/cronHealthAlertService.ts:143-145). A timer with no row, a disabled row and any other
//   trigger_type produce no signal at all.
// - Error rate: the last 10 activity rows of any kind, newest first (:151-157), once there are 5 (:60);
//   'skipped' and 'pending' rows count in the denominator (:21, :61-63). Warning at 50%, critical at 80%.
// - Missed run: only with a schedule and a last_run_at (:90), against the gap between the schedule's next
//   two fires after now (:91, utils/cronNextRun.ts:21-31). Warning at 2x, critical at 4x. A row that has
//   never run cannot be overdue.
// - Thresholds are constants (:47-52), recorded as K.D.'s discretion (:44-45).
// - The check runs at 10, 25, 40 and 55 past each hour (schedulerService.ts:3400) and records no run of its
//   own (:3397-3399), so a quiet check and a check that is not running look the same.
// - What a run leaves behind depends on its wrapper: runAgent and instrumentCronJob write last_run_at and one
//   activity row per run; trackAgentRun writes last_run_at and run_count only, on failure too (agentRunTracker.ts:40-65); a
//   workforce director's gate never sets last_run_at (workforce/workforceAgentRuntime.ts:66-69) and writes an
//   activity row for a success or a skip but none for a failure (:164, :170-173), a gap the scheduler names
//   and closes for Dara only (aiOpsScheduler.ts:118-128).

import type { Citation } from './orchestrationHealthWatch.ts';
import { GATES, type Gate, type TimerRow } from './agentEnableDisableControl.ts';
import type { RunLog, RunRow } from './cronRunInstrumentation.ts';
import { gapRange, expectedIntervalMs, parseCron } from '../inventory/cronExpression.ts';

export interface HealthRow extends RunRow { trigger_type: string; schedule: string | null }
export interface HealthSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: HealthRow[];
  ai_agent_activity_logs: RunLog[];
  timers: TimerRow[];
  timer_scope: string[];
}

export interface Thresholds {
  RECENT_RUN_SAMPLE_SIZE: number;
  MIN_SAMPLE_SIZE: number;
  ERROR_RATE_WARNING_PERCENT: number;
  ERROR_RATE_CRITICAL_PERCENT: number;
  MISSED_RUN_WARNING_MULTIPLIER: number;
  MISSED_RUN_CRITICAL_MULTIPLIER: number;
}

export const PINNED_THRESHOLDS: Thresholds = {
  RECENT_RUN_SAMPLE_SIZE: 10, MIN_SAMPLE_SIZE: 5, ERROR_RATE_WARNING_PERCENT: 50,
  ERROR_RATE_CRITICAL_PERCENT: 80, MISSED_RUN_WARNING_MULTIPLIER: 2, MISSED_RUN_CRITICAL_MULTIPLIER: 4,
};
export const PINNED_AT = 'cronHealthAlertService.ts:47-52 at 4443087';
const FILTER = /where:\s*\{\s*trigger_type:\s*'cron',\s*enabled:\s*true\s*\}/;

// Reads the thresholds from the live source, and confirms the selection is still the one this answer
// assumes. A missing constant or a changed filter is an error, never a silent fall back to the pinned copy.
export function readLiveThresholds(source: string): Thresholds {
  const out: Partial<Thresholds> = {};
  for (const k of Object.keys(PINNED_THRESHOLDS) as Array<keyof Thresholds>) {
    const m = source.match(new RegExp(`const ${k} = (\\d+(?:\\.\\d+)?);`));
    if (!m) throw new Error(`${k} is not a numeric constant in cronHealthAlertService.ts; the thresholds have changed shape`);
    out[k] = Number(m[1]);
  }
  if (!FILTER.test(source)) throw new Error('the check no longer selects trigger_type cron and enabled true; this answer\'s list of what it cannot see would be wrong');
  return out as Thresholds;
}

// What one run leaves on the row the check reads, by the wrapper that decides the run.
type Recording = 'per_run' | 'counters_only' | 'nothing' | 'unknown';
const RECORDS: Record<Gate, Recording> = {
  run_agent: 'per_run', instrument_cron_job: 'per_run', own_check: 'per_run', // CampaignHealthScanner, aiOrchestrator.ts:131-150
  track_agent_run: 'counters_only', director_gate: 'nothing', none: 'nothing', unknown: 'unknown',
};

export interface Alert { detector: 'error_rate' | 'missed_run'; type: 'warning' | 'critical'; severity: 3 | 5; detail: string; caution: string | null }
export interface Evaluated {
  name: string;
  row_id: string;
  alerts: Alert[];
  error_rate: { evaluated: boolean; failed: number; sampled: number; rate: number | null; not_run_rows: number; why_not: string | null };
  missed_run: { evaluated: boolean; expected_interval_ms: number | null; overdue_ms: number | null; multiplier: number | null; why_not: string | null };
  // The row's schedule and the firing one give different intervals: normal gaps alert, or a stop is seen late.
  schedule_mismatch: 'false_alarms' | 'late_detection' | null;
  notes: string[];
  citations: Citation[];
}
export type ExclusionReason = 'no_row' | 'checks_no_row' | 'row_unknown' | 'disabled' | 'not_cron_trigger';
export interface NotEvaluated { name: string; row_id: string | null; reasons: ExclusionReason[]; timers: string[]; statement: string }

export interface HealthAnswer {
  now: string;
  thresholds: Thresholds;
  threshold_source: string;
  answer: 'alerting' | 'clear' | 'clear_with_blind_spots';
  alerting: Evaluated[];
  clear: Evaluated[];
  partly_evaluated: Evaluated[];
  not_evaluated: NotEvaluated[];
  unscheduled_rows_not_listed: number;
  cannot_say: string[];
  statement: string;
}

const H = 3_600_000;
const hours = (ms: number) => `${Math.round((ms / H) * 10) / 10}h`;
const byName = <T extends { name: string; row_id: string | null }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.row_id ?? '') < (b.row_id ?? '') ? -1 : 1);
// The two per-run wrappers write result, trace_id and duration_ms on each run row (capability 18).
const isRunRow = (l: RunLog) => (l.result === 'success' || l.result === 'failed') && typeof l.duration_ms === 'number' && l.trace_id !== null;

interface Decider { ref: string; gate: Gate; schedule: string }

function evaluate(row: HealthRow, logs: RunLog[], now: Date, t: Thresholds, deciders: Decider[], scope: string[]): Evaluated {
  const sample = logs.filter((l) => l.agent_id === row.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, t.RECENT_RUN_SAMPLE_SIZE);
  const alerts: Alert[] = [];
  const notes: string[] = [];
  const failed = sample.filter((l) => l.result === 'failed').length;
  const notRun = sample.filter((l) => !isRunRow(l)).length;
  const er: Evaluated['error_rate'] = { evaluated: false, failed, sampled: sample.length, rate: null, not_run_rows: notRun, why_not: null };
  if (sample.length >= t.MIN_SAMPLE_SIZE) {
    er.evaluated = true;
    er.rate = Math.round((failed / sample.length) * 100);
    const type = er.rate >= t.ERROR_RATE_CRITICAL_PERCENT ? 'critical' : er.rate >= t.ERROR_RATE_WARNING_PERCENT ? 'warning' : null;
    if (type) alerts.push({ detector: 'error_rate', type, severity: type === 'critical' ? 5 : 3, detail: `failed ${failed} of its last ${sample.length} recorded rows (${er.rate}%)${row.last_error ? `; last error: ${row.last_error}` : ''}`, caution: null });
    if (notRun > 0) notes.push(`${notRun} of the ${sample.length} sampled rows are not run results (skipped, pending or the agent's own action rows), and the check counts them as runs (cronHealthAlertService.ts:61-63)`);
  } else {
    er.why_not = `only ${sample.length} recorded row(s); the check needs ${t.MIN_SAMPLE_SIZE} before it judges an error rate (cronHealthAlertService.ts:60), so a job failing from its first run stays quiet until then`;
  }

  const mr: Evaluated['missed_run'] = { evaluated: false, expected_interval_ms: null, overdue_ms: null, multiplier: null, why_not: null };
  const cron = row.schedule ? parseCron(row.schedule) : null;
  if (!row.schedule) mr.why_not = 'no schedule on the row (cronHealthAlertService.ts:90)';
  else if (!row.last_run_at) mr.why_not = 'it has never recorded a run (last_run_at is empty), and a job that has never run cannot be overdue (cronHealthAlertService.ts:90)';
  else if (!cron) mr.why_not = `Ellis cannot read the schedule ${row.schedule}; the live check may or may not`;
  else {
    const interval = expectedIntervalMs(cron, now);
    if (!interval) mr.why_not = `the schedule ${row.schedule} has no two upcoming fires`;
    else {
      const overdue = now.getTime() - Date.parse(row.last_run_at);
      const mult = overdue / interval;
      Object.assign(mr, { evaluated: true, expected_interval_ms: interval, overdue_ms: overdue, multiplier: Number(mult.toFixed(2)) });
      const gaps = gapRange(cron, now);
      const uneven = gaps !== null && gaps.longest > gaps.shortest;
      if (uneven) notes.push(`its schedule ${row.schedule} has gaps from ${hours(gaps!.shortest)} to ${hours(gaps!.longest)}, and the check judges it against the next gap only (${hours(interval)}, utils/cronNextRun.ts:21-31)`);
      const type = mult >= t.MISSED_RUN_CRITICAL_MULTIPLIER ? 'critical' : mult >= t.MISSED_RUN_WARNING_MULTIPLIER ? 'warning' : null;
      if (type) {
        const caution = uneven && overdue <= gaps!.longest ? `possibly not a miss: ${hours(overdue)} is within this schedule's longest normal gap of ${hours(gaps!.longest)}` : null;
        alerts.push({ detector: 'missed_run', type, severity: type === 'critical' ? 5 : 3, detail: `expected about every ${hours(interval)}, last ran ${hours(overdue)} ago (${mult.toFixed(1)}x)`, caution });
      }
    }
  }

  // The check reads the row's schedule, not the one that fires. Only a different interval matters.
  const own = cron ? expectedIntervalMs(cron, now) : null;
  let mismatch: Evaluated['schedule_mismatch'] = null;
  for (const s of [...new Set(deciders.map((d) => d.schedule))].filter((x) => x !== row.schedule)) {
    const c = parseCron(s);
    const g = c && gapRange(c, now);
    if (!own || !g) continue;
    const warnAfter = own * t.MISSED_RUN_WARNING_MULTIPLIER;
    if (g.longest > warnAfter) {
      mismatch = 'false_alarms';
      notes.push(`its row says ${row.schedule} (about every ${hours(own)}) but its timer fires ${s}, with gaps up to ${hours(g.longest)}: the check warns after ${hours(warnAfter)} and goes critical after ${hours(own * t.MISSED_RUN_CRITICAL_MULTIPLIER)}, so normal gaps between runs can read as missed runs`);
    } else if (g.longest * t.MISSED_RUN_WARNING_MULTIPLIER < warnAfter / 2) {
      mismatch ??= 'late_detection';
      notes.push(`its row says ${row.schedule} (about every ${hours(own)}) but its timer fires ${s} (gaps up to ${hours(g.longest)}): a stopped job is flagged only after ${hours(warnAfter)}, not ${hours(g.longest * t.MISSED_RUN_WARNING_MULTIPLIER)}`);
    }
  }
  const recordings = new Set(deciders.map((d) => RECORDS[d.gate]));
  const refs = deciders.map((d) => d.ref).join(', ');
  if (deciders.length === 0) notes.push(`no timer in ${scope.join(', ')} records under this row; a timer outside that scope may`);
  else if (recordings.size === 1 && recordings.has('nothing')) notes.push(`its timer (${refs}) runs through a director gate that records no run on the row: last_run_at never changes, and a failure writes no activity row while a success or skip does, so a run that fails or stops is invisible to both checks (workforceAgentRuntime.ts:66-69, :164-173; the scheduler closes this gap for Dara only, aiOpsScheduler.ts:118-128)`);
  else if (recordings.has('counters_only')) notes.push(`its timer (${refs}) writes no activity row per run (agentRunTracker.ts:40-65), so its failures never enter the error-rate sample`);
  else if (recordings.has('unknown')) notes.push(`what its timer (${refs}) records per run is not known to Ellis`);
  return {
    name: row.agent_name, row_id: row.id, alerts, error_rate: er, missed_run: mr, schedule_mismatch: mismatch, notes,
    citations: [
      { table: 'ai_agents', id: row.id, fields: ['trigger_type', 'enabled', 'schedule', 'last_run_at', 'last_error'] },
      ...sample.slice(0, 1).map((l) => ({ table: 'ai_agent_activity_logs' as const, id: l.id, fields: ['result', 'created_at'] })),
    ],
  };
}

const EXCLUDED: Record<Exclude<ExclusionReason, 'no_row'>, string> = {
  checks_no_row: 'its timer checks no row at all',
  row_unknown: 'Ellis cannot tell which row its runner reads, so whether the check sees it is not known',
  disabled: 'its row is disabled',
  not_cron_trigger: 'its row is not trigger_type cron',
};

export function cronHealth(snap: HealthSnapshot, t: Thresholds = PINNED_THRESHOLDS, source = PINNED_AT): HealthAnswer {
  const now = new Date(snap.captured_at);
  const rowNames = new Set(snap.ai_agents.map((a) => a.agent_name));
  const deciders = new Map<string, Decider[]>();
  const noRow = new Map<string, Decider[]>();
  const notEvaluated: NotEvaluated[] = [];
  for (const tm of snap.timers) {
    const first = tm.gates[0];
    if (!first || first.flag === null) {
      const reason: ExclusionReason = first?.gate === 'unknown' ? 'row_unknown' : 'checks_no_row';
      notEvaluated.push({ name: tm.timer, row_id: null, reasons: [reason], timers: [tm.ref], statement: `${tm.timer}: not evaluated, because ${EXCLUDED[reason as 'checks_no_row']}.` });
      continue;
    }
    const map = rowNames.has(first.flag) ? deciders : noRow;
    map.set(first.flag, [...(map.get(first.flag) ?? []), { ref: tm.ref, gate: first.gate, schedule: tm.schedule }]);
  }
  for (const [name, ds] of noRow) {
    const what = [...new Set(ds.map((d) => GATES[d.gate].noRow))].join('; ');
    notEvaluated.push({ name, row_id: null, reasons: ['no_row'], timers: ds.map((d) => d.ref).sort(),
      statement: `${name}: not evaluated, because no ai_agents row carries this name, and with no row its wrapper ${what}. The check selects only enabled cron rows (cronHealthAlertService.ts:143-145), so no alert can ever come from it. Timer: ${ds.map((d) => d.ref).sort().join(', ')}.` });
  }

  const evaluated: Evaluated[] = [];
  let unscheduled = 0;
  for (const row of snap.ai_agents) {
    const ds = (deciders.get(row.agent_name) ?? []).sort((a, b) => (a.ref < b.ref ? -1 : 1));
    if (row.trigger_type === 'cron' && row.enabled) { evaluated.push(evaluate(row, snap.ai_agent_activity_logs, now, t, ds, snap.timer_scope)); continue; }
    if (row.trigger_type !== 'cron' && row.schedule === null && ds.length === 0) { unscheduled++; continue; }
    const reasons: ExclusionReason[] = [];
    if (row.trigger_type !== 'cron') reasons.push('not_cron_trigger');
    if (!row.enabled) reasons.push('disabled');
    const timers = ds.map((d) => d.ref);
    notEvaluated.push({ name: row.agent_name, row_id: row.id, reasons, timers,
      statement: `${row.agent_name}: not evaluated, because ${reasons.map((r) => EXCLUDED[r as Exclude<ExclusionReason, 'no_row'>]).join(' and ')}. The check selects only enabled cron rows (cronHealthAlertService.ts:143-145), so no alert can ever come from it.${timers.length ? ` Timer: ${timers.join(', ')}.` : ''}` });
  }

  const alerting = evaluated.filter((e) => e.alerts.length > 0).sort(byName);
  const partly = evaluated.filter((e) => e.alerts.length === 0 && (!e.error_rate.evaluated || !e.missed_run.evaluated)).sort(byName);
  const clear = evaluated.filter((e) => e.alerts.length === 0 && e.error_rate.evaluated && e.missed_run.evaluated).sort(byName);
  notEvaluated.sort(byName);
  const answer = alerting.length ? 'alerting' : partly.length + notEvaluated.length ? 'clear_with_blind_spots' : 'clear';
  const cannot = [
    'whether the live check itself is running: it records no run of its own (schedulerService.ts:3397-3399)',
    `jobs outside ${snap.timer_scope.join(', ')}: a timer elsewhere with no row would not be listed here`,
  ];
  const statement = `${alerting.length} job(s) alerting, ${clear.length} clear on both checks, ${partly.length} evaluated only in part, ${notEvaluated.length} not evaluated at all.`
    + (answer === 'alerting' ? '' : answer === 'clear' ? ' Every scheduled job was evaluated on both checks.' : ' No alert is not the same as healthy: the jobs listed as not evaluated, or evaluated in part, could be failing without any alert.')
    + ` Thresholds from ${source}.`;
  return { now: snap.captured_at, thresholds: t, threshold_source: source, answer, alerting, clear, partly_evaluated: partly, not_evaluated: notEvaluated, unscheduled_rows_not_listed: unscheduled, cannot_say: cannot, statement };
}
