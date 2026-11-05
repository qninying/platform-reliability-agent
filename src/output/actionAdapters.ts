// Adapters from the checks that recommend or rehearse an action (the disable recommendation, ticket resolution and
// orchestration repair in the sandbox) to the shared tool output. No check's logic changes: each adapter reads the
// answer the check already gives. Sandbox answers cite fixture rows, and say so in as_of.

import type { Recommendation } from '../capabilities/agentEnableDisableControl.ts';
import type { Verification } from '../capabilities/agentTicketAutoResolution.ts';
import type { RepairReport } from '../capabilities/orchestrationAutoRepair.ts';
import type { Rehearsal } from '../capabilities/staleRecoveryRehearsal.ts';
import type { Rehearsal as ReapRehearsal } from '../capabilities/previewReapRehearsal.ts';
import type { Rehearsal as SweepRehearsal } from '../capabilities/retentionSweepRehearsal.ts';
import type { Rehearsal as OverlapRehearsal } from '../capabilities/cronOverlapRehearsal.ts';
import type { Rehearsal as DefaultOnRehearsal } from '../capabilities/defaultOnRehearsal.ts';
import type { Rehearsal as LivenessRehearsal } from '../capabilities/livenessProbeRehearsal.ts';
import type { Rehearsal as DeadLetterRehearsal } from '../capabilities/deadLetterRehearsal.ts';
import type { Rehearsal as ReplayRehearsal } from '../capabilities/deadLetterReplayRehearsal.ts';
import type { Rehearsal as ClassRehearsal } from '../capabilities/errorClassRehearsal.ts';
import type { Rehearsal as AuditRehearsal } from '../capabilities/replayVerdicts.ts';
import type { Rehearsal as FixRehearsal } from '../capabilities/fixVerification.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, note: string | null = null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note });
const sandbox = (fixture: string, c: Capture): AsOf => at(c, `sandbox fixture ${fixture}, not production`);
const ticket = (id: string): Evidence => ({ table: 'sandbox_tickets', id, fields: ['status'] });

export function disableOutput(r: Recommendation, c: Capture, table: SeverityTable): ToolOutput<Recommendation> {
  const tool = 'platform.CAP.agent_enable_disable_control';
  if (r.recommendation === 'disable') {
    const given = r.evidence.map((e): Evidence => ({ table: e.source, id: e.ref, fields: ['summary'] }));
    return envelope({
      tool, as_of: at(c), verdict: 'problem', case: r.would_not_stop.length ? 'disable_leaves_timers_running' : 'disable_recommended', platform_signal: null,
      evidence: [...rows(r.citations), ...given], blind_spots: r.would_not_stop.map((t) => `${t.timer} (${t.ref}) keeps running: ${t.effect}`), detail: r,
    }, table);
  }
  // Already off is a settled answer; no row, or no evidence given, leaves nothing to judge.
  const off = r.flag.exists && !r.flag.enabled;
  return envelope({
    tool, as_of: at(c), verdict: off ? 'ok' : 'unknown', case: off ? 'already_disabled' : 'nothing_to_judge', platform_signal: null,
    evidence: rows(r.citations), blind_spots: off ? [] : [r.statement], detail: r,
  }, table);
}

export function ticketOutput(v: Verification, c: Capture, table: SeverityTable): ToolOutput<Verification> {
  const tool = 'platform.CAP.agent_ticket_auto_resolution';
  const errors = [...v.first_run, ...v.second_run].flatMap((r) => r.errors.map((e) => e.id));
  const twice = v.second_run_closed > 0 || v.second_run_comments > 0;
  const kase = v.closed_must_not.length ? 'closed_a_ticket_it_must_not' : twice ? 'second_run_changed_something' : v.left_open_should_close.length ? 'left_open_a_ticket_it_should_close' : errors.length ? 'resolver_error' : null;
  const bad = [...new Set([...v.closed_must_not, ...v.left_open_should_close, ...errors, ...(twice ? v.second_run.flatMap((r) => r.results.map((x) => x.id)) : [])])];
  const all = [...new Set(v.first_run.flatMap((r) => r.results.map((x) => x.id)))];
  const blind = v.coverage_gaps.map((g) => `resolver ${g}: no ticket in the fixture exercises it`);
  const evidence = (kase ? bad : all).map(ticket);
  const verdict = kase ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: sandbox(v.fixture_id, c), verdict, case: kase ?? verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' && !blind.length ? ['no ticket was checked, so nothing is cited'] : blind, detail: v,
  }, table);
}

// Each seeded row is cited, with the run that recovered it; a failed check cites the rows it is about.
export function staleRehearsalOutput(r: Rehearsal, c: Capture, table: SeverityTable): ToolOutput<Rehearsal> {
  const tool = 'platform.CAP.stale_action_recovery';
  const row = (x: Rehearsal['rows'][number]): Evidence => ({ table: 'sandbox_scheduled_emails', id: x.id, fields: ['status', 'attempts_made', ...(x.recovered_by.length ? [`recovered by run ${x.recovered_by.join(', ')}`] : [])] });
  const wrong = r.rows.filter((x) => x.got !== x.expect || x.recovered_by.length > 1);
  const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  const kase = !r.checks.harness_catches_double_recovery ? 'harness_cannot_fail' : !r.checks.one_recovery_each ? 'recovered_twice_or_wrongly' : failed[0] ?? null;
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase ?? 'verified', platform_signal: null,
    evidence: (r.verified || !wrong.length ? r.rows : wrong).map(row), blind_spots: r.limits, detail: r,
  }, table);
}

// Each stack is cited with its end state; a failed rehearsal cites the stacks and containers it is about.
export function reapRehearsalOutput(r: ReapRehearsal, c: Capture, table: SeverityTable): ToolOutput<ReapRehearsal> {
  const tool = 'platform.CAP.preview_stack_reaping';
  const stack = (s: ReapRehearsal['stacks'][number]): Evidence => ({ table: 'sandbox_preview_stacks', id: s.slug, fields: ['status', `${s.containers_running} container(s) running`, `${s.stop_events} stop event(s)`] });
  const orphans: Evidence[] = r.after_rerun.orphans.map((id) => ({ table: 'sandbox_containers', id, fields: ['state'] }));
  const bad = [...orphans, ...r.stacks.filter((s) => s.expect === 'stopped' && (s.status !== 'stopped' || s.containers_running > 0)).map(stack)];
  const kase = !r.checks.control_order_leaves_orphans ? 'harness_cannot_fail' : !r.checks.rerun_ends_clean ? 'orphaned_resources' : Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? null;
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase ?? 'verified', platform_signal: null,
    evidence: r.verified || !bad.length ? r.stacks.map(stack) : bad,
    blind_spots: [...r.stops_not_recorded.map((s) => `${s}: stopped with no stop event, because a failed event write is only printed`), ...r.limits], detail: r,
  }, table);
}

// With no stated rule the sweep is not run, so the answer is unknown. What the platform's cycle lost on the seed
// is shown as a blind spot of the platform, not as Ellis's verdict: it is the control, not the subject.
export function sweepRehearsalOutput(r: SweepRehearsal, c: Capture, table: SeverityTable): ToolOutput<SweepRehearsal> {
  const tool = 'platform.CAP.data_retention_sweep';
  const pl = r.platform_control.losses;
  const control = [
    ...(pl.unarchived_deleted.length ? [`the platform's cycle, on the same seed, deleted rows it never archived: ${pl.unarchived_deleted.join(', ')}`] : []),
    ...(pl.references_broken.length ? [`the platform's cycle, on the same seed, removed rows other tables reference: ${pl.references_broken.join(', ')}`] : []),
  ];
  if (!r.stated_rule) {
    return envelope({ tool, as_of: sandbox(r.fixture_id, c), verdict: 'unknown', case: 'no_stated_rule', platform_signal: null, evidence: [], blind_spots: [r.statement, ...control, ...r.limits], detail: r }, table);
  }
  const row = (x: SweepRehearsal['rows'][number]): Evidence => ({ table: 'sandbox_intelligence_decisions', id: x.decision_id, fields: ['timestamp', x.got] });
  const wrong = r.rows.filter((x) => x.got !== x.expect);
  const kase = !r.checks.control_shows_a_loss ? 'seed_exercises_nothing' : Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !wrong.length ? r.rows : wrong).map(row), blind_spots: [...control, ...r.limits], detail: r,
  }, table);
}

// Each run is cited; a failure cites the overlapping runs or the ticks that left no record.
export function overlapRehearsalOutput(r: OverlapRehearsal, c: Capture, table: SeverityTable): ToolOutput<OverlapRehearsal> {
  const tool = 'platform.CAP.cron_overlap_guard';
  const runs: Evidence[] = r.runs.map((x) => ({ table: 'sandbox_activity_log', id: x.id, fields: ['started', 'ended'] }));
  const bad: Evidence[] = [
    ...r.overlaps.flat().map((id) => ({ table: 'sandbox_activity_log', id, fields: ['overlaps another run'] })),
    ...r.silent_skips.map((id) => ({ table: 'sandbox_ticks', id, fields: ['no record'] })),
  ];
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: r.verified || !bad.length ? runs : [...new Map(bad.map((e) => [e.id, e])).values()], blind_spots: r.limits, detail: r,
  }, table);
}

// Each registry name is cited with its row and whether the guard started it; a failure cites the names it is about.
export function defaultOnRehearsalOutput(r: DefaultOnRehearsal, c: Capture, table: SeverityTable): ToolOutput<DefaultOnRehearsal> {
  const tool = 'platform.CAP.default_on_timer_guard';
  const name = (x: DefaultOnRehearsal['names'][number]): Evidence => ({ table: 'sandbox_cron_schedule_configs', id: x.name, fields: [`row ${x.row}`, x.guard ? 'started' : 'not started'] });
  const bad = r.names.filter((x) => x.guard !== (x.row === 'enabled'));
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.names : bad).map(name), blind_spots: r.limits, detail: r,
  }, table);
}

// Each case is cited with what both probes returned; a failure cites the cases where Ellis's probe answered wrongly.
export function livenessRehearsalOutput(r: LivenessRehearsal, c: Capture, table: SeverityTable): ToolOutput<LivenessRehearsal> {
  const tool = 'platform.CAP.scheduler_registration_liveness_probe';
  const row = (x: LivenessRehearsal['cases'][number]): Evidence => ({ table: 'sandbox_probe_responses', id: x.id, fields: [`${x.registered} registered`, `probe ${x.ellis.status}`, `GET /health ${x.platform.status}`] });
  const bad = r.cases.filter((x) => x.ellis.status !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.cases : bad).map(row), blind_spots: r.limits, detail: r,
  }, table);
}

// Each case is cited with the rows it wrote; a failure cites the cases that wrote the wrong number.
export function deadLetterRehearsalOutput(r: DeadLetterRehearsal, c: Capture, table: SeverityTable): ToolOutput<DeadLetterRehearsal> {
  const tool = 'platform.CAP.dead_letter_capture';
  const row = (x: DeadLetterRehearsal['cases'][number]): Evidence => ({ table: 'sandbox_dead_letter_jobs', id: x.id, fields: [`${x.rows.length} row(s), ${x.expect} expected`, `${x.contrast_rows} with a durable counter`] });
  const bad = r.cases.filter((x) => x.rows.length !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.cases : bad).map(row), blind_spots: r.limits, detail: r,
  }, table);
}

// Each entry is cited with its trial and its verdict; a failure cites the entries judged wrongly.
export function replayRehearsalOutput(r: ReplayRehearsal, c: Capture, table: SeverityTable): ToolOutput<ReplayRehearsal> {
  const tool = 'platform.CAP.dead_letter_triage';
  const entry = (x: ReplayRehearsal['entries'][number]): Evidence => ({ table: 'sandbox_publishing_jobs', id: x.id, fields: [`${x.trial_posts} post(s) after two trial replays`, x.verdict, x.replayed ? 'replayed once' : 'not replayed'] });
  const bad = r.entries.filter((x) => x.verdict !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.entries : bad).map(entry), blind_spots: r.limits, detail: r,
  }, table);
}

// Each seed is cited with the class each rule gave it; a failure cites the seeds classified wrongly.
export function classRehearsalOutput(r: ClassRehearsal, c: Capture, table: SeverityTable): ToolOutput<ClassRehearsal> {
  const tool = 'platform.CAP.error_class_coverage';
  const seed = (x: ClassRehearsal['seeds'][number]): Evidence => ({ table: 'sandbox_ai_agent_activity_logs', id: x.id, fields: [`error_class ${x.ellis}`, `platform rule ${x.platform}`] });
  const bad = r.seeds.filter((x) => x.ellis !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.seeds : bad).map(seed), blind_spots: r.limits, detail: r,
  }, table);
}

// Each job is cited with its verdict and reason; a failure cites the jobs whose verdict was not the one expected.
// Untestable jobs are blind spots as well as rows: nothing was compared for them.
export function auditRehearsalOutput(r: AuditRehearsal, c: Capture, table: SeverityTable): ToolOutput<AuditRehearsal> {
  const tool = 'platform.CAP.idempotency_and_replay_audit';
  const job = (x: AuditRehearsal['jobs'][number]): Evidence => ({ table: 'sandbox_job_models', id: x.job, fields: [x.verdict, x.reason] });
  const bad = r.jobs.filter((x) => x.verdict !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  const untested = r.jobs.filter((x) => x.verdict === 'untestable_in_sandbox').map((x) => `${x.job}: untestable in a sandbox, because ${x.reason}`);
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: (r.verified || !bad.length ? r.jobs : bad).map(job), blind_spots: [...untested, ...r.limits], detail: r,
  }, table);
}

// Each fix attempt is cited with its verdict and reason, beside the hashed lines and tests it ran against; a failure
// cites the attempts whose verdict was not the one expected.
export function fixRehearsalOutput(r: FixRehearsal, c: Capture, table: SeverityTable): ToolOutput<FixRehearsal> {
  const tool = 'platform.CAP.platform_bug_fix_dispatch';
  const attempt = (x: FixRehearsal['attempts'][number]): Evidence => ({ table: 'sandbox_fix_attempts', id: x.id, fields: [x.verdict, x.reason] });
  const bad = r.attempts.filter((x) => x.verdict !== x.expect);
  const kase = Object.entries(r.checks).find(([, v]) => !v)?.[0] ?? 'verified';
  const cited = r.baseline.citations.map((x): Evidence => ({ table: x.table, id: x.id, fields: x.fields }));
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict: r.verified ? 'ok' : 'problem', case: kase, platform_signal: null,
    evidence: [...(r.verified || !bad.length ? r.attempts : bad).map(attempt), ...cited], blind_spots: r.limits, detail: r,
  }, table);
}

export function repairOutput(r: RepairReport, c: Capture, table: SeverityTable): ToolOutput<RepairReport> {
  const tool = 'platform.CAP.orchestration_auto_repair';
  const changed = r.applied.map((x): Evidence => ({ table: x.table, id: x.row_id, fields: [x.column] }));
  const touched = r.no_op.flatMap((x) => (x.row_id ? [{ table: 'sandbox_rows', id: x.row_id, fields: [x.event_type] }] : []));
  const kase = r.outcome === 'failed' ? 'repair_failed' : r.applied.length && !r.verified ? 'repair_not_verified' : null;
  const blind = [
    ...r.deferred.map((x) => `${x.fault_id}: ${x.action} on ${x.table} ${x.row_id} deferred past the repair limit`),
    ...r.left_alone.map((x) => `${x.fault_id}: ${x.reason}`),
    ...(r.error ? [`${r.error.error_class}: ${r.error.message}`] : []),
  ];
  const evidence = [...changed, ...touched];
  const verdict = kase ? (evidence.length ? 'problem' : 'unknown') : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: sandbox(r.fixture_id, c), verdict, case: kase ?? verdict, platform_signal: null, evidence,
    blind_spots: !blind.length && verdict === 'unknown' ? [`outcome ${r.outcome} with no row changed or examined, so nothing is cited`] : blind, detail: r,
  }, table);
}
