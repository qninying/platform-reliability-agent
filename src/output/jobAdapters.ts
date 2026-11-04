// Adapters from the job checks (overlap, run records, dead letters, stale actions) to the shared tool output.
// No check's logic changes: each adapter reads the answer the check already gives. None of these checks reads a
// severity the platform attached, so platform_signal is null throughout.

import type { OverlapAnswer, TimerAnswer } from '../capabilities/cronOverlapGuard.ts';
import type { RunAnswer } from '../capabilities/cronRunInstrumentation.ts';
import type { DeadLetterAnswer, FamilyReport } from '../capabilities/deadLetterCapture.ts';
import type { TriageAnswer } from '../capabilities/deadLetterTriage.ts';
import { RECOVERY_TIMER, type StaleReport, type StaleSnapshot } from '../capabilities/staleActionRecovery.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, commit: string | null = null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: commit ? `platform commit ${commit}` : null });
const run = (id: string): Evidence => ({ table: 'ai_agent_activity_logs', id, fields: ['created_at', 'duration_ms'] });
// The families that cannot reach the dead-letter queue, or that Ellis cannot place: what an empty queue cannot see.
const unreached = (fams: FamilyReport[]): string[] => fams.filter((f) => f.can_dead_letter !== true && f.count).map((f) => `${f.family} (${f.count} jobs): ${f.why}`);

// A timer flagged on its average alone has no run row behind it; its place in the inventory is the evidence.
function overlapEvidence(t: TimerAnswer): Evidence[] {
  if (t.observed_overlaps.row_ids.length) return t.observed_overlaps.row_ids.map(run);
  if (t.duration.worst_row_id && t.basis !== 'average') return [run(t.duration.worst_row_id)];
  return [{ table: 'timer_inventory', id: t.timer, fields: ['schedule', 'avg_duration_ms'] }];
}

export function overlapOutput(a: OverlapAnswer, c: Capture, table: SeverityTable): ToolOutput<OverlapAnswer> {
  const tool = 'platform.CAP.cron_overlap_guard';
  const seen = a.not_seen_to_overlap.filter((t) => t.duration.worst_row_id).map((t) => run(t.duration.worst_row_id!));
  const verdict = a.can_overlap.length ? 'problem' : !a.unassessable.length ? 'ok' : seen.length ? 'partly_unknown' : 'unknown';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict,
    case: verdict !== 'problem' ? verdict : a.can_overlap.some((t) => t.observed_overlaps.count) ? 'observed_overlap' : 'can_overlap',
    platform_signal: null, evidence: verdict === 'problem' ? a.can_overlap.flatMap(overlapEvidence) : seen,
    blind_spots: a.unassessable.map((t) => `${t.timer}: ${t.unassessable_because}`), detail: a,
  }, table);
}

export function runRecordOutput(a: RunAnswer, c: Capture, table: SeverityTable): ToolOutput<RunAnswer> {
  const tool = 'platform.CAP.cron_run_instrumentation';
  // A name with no row, or with several, has no single run history: the statement says why.
  if (a.answer === 'not_instrumented' || a.answer === 'ambiguous') {
    return envelope({ tool, as_of: at(c), verdict: 'unknown', case: a.answer, platform_signal: null, evidence: rows(a.citations), blind_spots: [a.statement], detail: a }, table);
  }
  const verdict = a.failed === true ? 'problem' : a.failed === false ? 'ok' : a.answer === 'run_recorded' ? 'partly_unknown' : 'unknown';
  return envelope({
    tool, as_of: at(c), verdict, case: verdict === 'problem' ? 'last_run_failed' : a.answer, platform_signal: null,
    evidence: rows(a.citations), blind_spots: verdict === 'unknown' ? [a.statement, ...a.cannot_say] : a.cannot_say, detail: a,
  }, table);
}

export function deadLetterOutput(a: DeadLetterAnswer, c: Capture, table: SeverityTable): ToolOutput<DeadLetterAnswer> {
  const tool = 'platform.CAP.dead_letter_capture';
  const evidence: Evidence[] = [
    ...a.dead_letter_jobs.by_class.flatMap((k) => k.row_ids.map((id) => ({ table: 'dead_letter_jobs', id, fields: ['job_name', 'error_class', 'consecutive_failures'] }))),
    ...a.publishing_jobs.by_class.flatMap((k) => k.row_ids.map((id) => ({ table: 'publishing_jobs', id, fields: ['state', 'last_error_class', 'dead_lettered_at'] }))),
  ];
  const blind = unreached(a.coverage.families);
  // An empty queue is never ok: it cites no row, and most jobs could not have reached it.
  const verdict = a.verdict === 'dead_lettered' ? 'problem' : blind.length ? 'partly_unknown' : 'unknown';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: verdict === 'problem' ? 'dead_lettered' : 'queue_empty', platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? ['an empty queue cites no row, so it is not reported as ok'] : blind, detail: a,
  }, table);
}

export function triageOutput(a: TriageAnswer, c: Capture, table: SeverityTable): ToolOutput<TriageAnswer> {
  const tool = 'platform.CAP.dead_letter_triage';
  const evidence: Evidence[] = a.queue.flatMap((g) => g.entries.flatMap((e) => e.row_ids.map((id) => ({ table: e.store, id, fields: e.store === 'dead_letter_jobs' ? ['job_name', 'error_class', 'created_at'] : ['state', 'last_error_class', 'dead_lettered_at'] }))));
  const blind = [...unreached(a.could_not_have_reached.families), ...a.could_not_have_reached.conditions];
  const verdict = a.verdict === 'queue_open' ? 'problem' : 'partly_unknown';
  return envelope({ tool, as_of: at(c, a.source_commit), verdict, case: a.verdict, platform_signal: null, evidence, blind_spots: blind, detail: a }, table);
}

// The report keeps the recovery timer's status but not its row, so the snapshot supplies the row it read.
export function staleOutput(r: StaleReport, s: StaleSnapshot, table: SeverityTable): ToolOutput<StaleReport> {
  const tool = 'platform.CAP.stale_action_recovery';
  const timerRows = s.ai_agents.filter((x) => x.agent_name === RECOVERY_TIMER).map((x): Evidence => ({ table: 'ai_agents', id: x.id, fields: ['enabled', 'last_run_at'] }));
  const timerDown = ['failed', 'disabled', 'overdue', 'never_run'].includes(r.timer.status);
  const kase = r.counts.past_attempt_cap ? 'past_attempt_cap' : timerDown ? 'recovery_timer_not_running' : r.counts.past_threshold ? 'stuck_past_threshold' : null;
  const stuck = r.actions.filter((x) => x.state === 'past_attempt_cap' || x.state === 'past_threshold').map((x) => x.citation);
  const blind = [
    ...r.actions.filter((x) => x.state === 'unknown').map((x) => `${x.id}: ${x.reason}`),
    ...(r.timer.status === 'untracked' ? [`${RECOVERY_TIMER}: ${r.timer.reason}`] : []),
    ...(r.counts.past_threshold ? [r.slow_or_stuck] : []),
  ];
  const evidence = kase ? [...rows(stuck), ...(timerDown ? timerRows : [])] : [...rows(r.actions.filter((x) => x.state === 'in_flight').map((x) => x.citation)), ...timerRows];
  const verdict = kase ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: at(s), verdict, case: kase ?? verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? [...blind, 'no row is in processing and no recovery timer row was read, so nothing is cited'] : blind, detail: r,
  }, table);
}
