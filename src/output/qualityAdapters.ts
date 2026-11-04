// Adapters from the code-quality and data checks (error-class coverage, the idempotency harness, retention sweeps,
// the bug baseline, prompt performance) to the shared tool output. No check's logic changes: each adapter reads the
// answer the check already gives.

import type { CoverageAnswer } from '../capabilities/errorClassCoverage.ts';
import type { AuditAnswer } from '../capabilities/idempotencyAudit.ts';
import type { TableAnswer } from '../capabilities/dataRetentionSweep.ts';
import type { BaselineRecord } from '../capabilities/bugBaseline.ts';
import type { PromptPerformanceReport } from '../capabilities/promptPerformance.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, commit: string | null = null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: commit ? `platform commit ${commit}` : null });
const source = (ref: string, fields: string[]): Evidence => ({ table: 'platform_source', id: ref, fields });

export function errorCoverageOutput(a: CoverageAnswer, c: Capture, table: SeverityTable): ToolOutput<CoverageAnswer> {
  const tool = 'platform.CAP.error_class_coverage';
  const s = a.by_store;
  const unclassified: Evidence[] = [
    ...s.ai_agent_activity_logs.unclassified_ids.map((id) => ({ table: 'ai_agent_activity_logs', id, fields: ['result', 'details.error_class'] })),
    ...s.dead_letter_jobs.unclassified_ids.map((id) => ({ table: 'dead_letter_jobs', id, fields: ['error_class'] })),
  ];
  const sites = a.catch_sites.records_no_class.map((x) => source(`${x.file}:${x.line}`, [x.kind]));
  const verdict = unclassified.length || sites.length ? 'problem' : a.verdict === 'measured' ? 'ok' : 'unknown';
  // With every failure classified and every catch site recording a class, the files read stand behind the answer.
  const evidence = verdict === 'problem' ? [...unclassified, ...sites] : verdict === 'ok' ? a.catch_sites.files_read.map((f) => source(f, ['catch sites'])) : [];
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: unclassified.length ? 'unclassified_failures' : sites.length ? 'catch_site_records_no_class' : verdict,
    platform_signal: null, evidence, blind_spots: verdict === 'unknown' ? [a.statement, a.vocabulary.note] : [a.vocabulary.note], detail: a,
  }, table);
}

// The harness proves itself on fixture models; no platform job has a verdict yet, so the answer is unknown.
export function idempotencyOutput(a: AuditAnswer, c: Capture, table: SeverityTable): ToolOutput<AuditAnswer> {
  const tool = 'platform.CAP.idempotency_and_replay_audit';
  const claim = source(`${a.claim_in_source.file}:${a.claim_in_source.line}`, ['conditional claim']);
  const broken = a.verdict === 'harness_cannot_fail';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict: broken ? 'problem' : 'unknown', case: a.verdict, platform_signal: null,
    evidence: [claim], blind_spots: broken ? [a.statement] : [a.platform_jobs.why], detail: a,
  }, table);
}

export function retentionOutput(tables: TableAnswer[], c: Capture, table: SeverityTable): ToolOutput<TableAnswer[]> {
  const tool = 'platform.CAP.data_retention_sweep';
  const outside = tables.filter((t) => t.code_check.follows_stated_window === false);
  const stopped = tables.filter((t) => ['failed', 'disabled', 'overdue', 'never_run'].includes(t.last_sweep.status));
  const conflicting = tables.filter((t) => t.window.status === 'conflicting');
  const flagged = [...new Set([...outside, ...stopped, ...conflicting])];
  const kase = outside.length ? 'deletes_outside_window' : stopped.length ? 'sweep_not_running' : conflicting.length ? 'conflicting_windows' : null;
  const blind = tables.flatMap((t) => [
    ...(t.window.status === 'unknown' ? [`${t.table}: ${t.window.reason}`] : []),
    ...(t.last_sweep.status === 'untracked' ? [`${t.table}: ${t.last_sweep.reason}`] : []),
    ...(t.code_check.follows_stated_window === null ? [`${t.table}: ${t.code_check.note}`] : []),
  ]);
  const cite = (ts: TableAnswer[]) => ts.flatMap((t) => [...rows(t.citations), source(t.code_ref, [t.action])]);
  const evidence = cite(kase ? flagged : tables);
  const verdict = kase ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({ tool, as_of: at(c), verdict, case: kase ?? verdict, platform_signal: null, evidence, blind_spots: blind, detail: tables }, table);
}

// A reproduced defect, or a test that broke out of its sandbox, is a problem; a run that cannot settle it is unknown.
export function baselineOutput(b: BaselineRecord, c: Capture, table: SeverityTable): ToolOutput<BaselineRecord> {
  const tool = 'platform.CAP.platform_bug_fix_dispatch';
  const verdict = b.verdict === 'baseline_confirmed' || b.verdict === 'sandbox_violation' ? 'problem' : b.verdict === 'passes_before_fix' ? 'ok' : 'unknown';
  const evidence: Evidence[] = [{ table: 'bug_ticket', id: b.ticket_id, fields: ['type', 'title'] }, ...rows(b.citations)];
  return envelope({
    tool, as_of: at(c), verdict, case: b.verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? [b.statement] : [], detail: b,
  }, table);
}

// A proposed prompt change with no measurement before it cannot be judged afterwards: that is the problem case.
export function promptOutput(r: PromptPerformanceReport, c: Capture, table: SeverityTable): ToolOutput<PromptPerformanceReport> {
  const tool = 'platform.CAP.prompt_and_performance_optimization';
  const guesses = r.prompts.flatMap((p) => (p.open_proposals ?? []).filter((x) => !x.measured_before).map((x): Evidence => ({ table: 'prompt_proposals', id: x.id, fields: ['before'] })));
  const blind = [
    ...r.prompts.flatMap((p) => [
      ...(p.cost.state !== 'measured' ? [`${p.prompt} cost: ${p.cost.reason}`] : []),
      ...(p.latency.state !== 'measured' ? [`${p.prompt} latency: ${p.latency.reason}`] : []),
    ]),
    ...(r.coverage.untagged ? [`${r.coverage.untagged} of ${r.coverage.calls} call(s) name no prompt version, so they are in no prompt's figures`] : []),
    ...(r.proposals_state === 'no_record' ? ['no proposal record was exported, so whether a change was measured first is unknown'] : []),
  ];
  const evidence = guesses.length ? [...guesses, ...rows(r.citations)] : rows(r.citations);
  const verdict = guesses.length ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: { captured_at: r.window.end, captured_by: c.captured_by, note: `window ${r.window.start} to ${r.window.end}` }, verdict,
    case: guesses.length ? 'proposal_without_measurement' : verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' && !blind.length ? [r.statement] : blind, detail: r,
  }, table);
}
