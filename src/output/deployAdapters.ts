// Adapters from the deploy and recovery checks (deploy readiness, release evidence, backup position, schema drift,
// preview stack reaping) to the shared tool output. No check's logic changes: each adapter reads the answer the
// check already gives. Several read no table: a git ref, a supplied evidence file or a log stamp is their evidence.

import type { ReadinessAnswer } from '../capabilities/deployReadiness.ts';
import type { ReleaseAnswer } from '../capabilities/deployVerificationEvidence.ts';
import type { PositionAnswer } from '../capabilities/backupRestoreVerification.ts';
import type { DriftAnswer } from '../capabilities/schemaDriftDetection.ts';
import { REAPER, type ReapingReport, type PreviewSnapshot } from '../capabilities/previewStackReaping.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, commit: string | null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: commit ? `platform commit ${commit}` : null });

export function readinessOutput(a: ReadinessAnswer, c: Capture, table: SeverityTable): ToolOutput<ReadinessAnswer> {
  const tool = 'platform.CAP.production_deploy_review_and_approval';
  const evidence: Evidence[] = [
    { table: 'git', id: a.head.sha, fields: ['HEAD', 'status --porcelain'] },
    ...(a.origin_main.sha ? [{ table: 'git', id: a.origin_main.sha, fields: ['origin/main'] }] : []),
  ];
  // Facts ready is never an approval, so what was not measured travels with every verdict.
  const verdict = a.readiness === 'not_ready' ? 'problem' : a.readiness === 'facts_ready' ? 'ok' : 'unknown';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: a.readiness, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? [a.statement, ...a.not_measured] : a.not_measured, detail: a,
  }, table);
}

export function releaseOutput(a: ReleaseAnswer, c: Capture, table: SeverityTable): ToolOutput<ReleaseAnswer> {
  const tool = 'platform.CAP.deploy_verification_evidence';
  const named = (status: string) => a.checks.filter((x) => x.status === status).map((x) => x.check);
  const bad = named('disagrees'), good = named('agrees');
  const verdict = a.verdict === 'disagrees' ? 'problem' : a.verdict === 'evidence_agrees' ? 'ok' : good.length ? 'partly_unknown' : 'unknown';
  // The release evidence a person captured is the record; its checks are the fields read from it.
  const fields = verdict === 'problem' ? bad : good;
  const evidence: Evidence[] = fields.length ? [{ table: 'release_evidence', id: a.intended_sha ?? 'no intended sha', fields }] : [];
  const missing = a.checks.filter((x) => x.status === 'missing').map((x) => `${x.check}: ${x.detail}`);
  return envelope({
    tool, as_of: at(c, null), verdict, case: a.verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' && !missing.length ? [a.statement] : missing, detail: a,
  }, table);
}

// The check's position is unknown by design: no backup age or restore exercise is ever read, only searched for.
export function backupOutput(a: PositionAnswer, c: Capture, table: SeverityTable): ToolOutput<PositionAnswer> {
  const tool = 'platform.CAP.backup_and_restore_verification';
  const lines = [...a.candidates, ...a.verifying_hits].map((h): Evidence => ({ table: 'platform_source', id: h.where, fields: [h.term] }));
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict: 'unknown', case: a.basis, platform_signal: null,
    evidence: [...new Map(lines.map((e) => [e.id, e])).values()], blind_spots: [a.statement, ...a.policy.to_agree], detail: a,
  }, table);
}

export function driftOutput(a: DriftAnswer, c: Capture, table: SeverityTable): ToolOutput<DriftAnswer> {
  const tool = 'platform.CAP.schema_drift_detection';
  const run = a.last_completed;
  const verdict = a.verdict === 'drift_reported' ? 'problem' : a.verdict === 'no_drift_reported' ? 'ok' : 'unknown';
  const evidence: Evidence[] = run ? [{ table: 'schema_drift_log', id: run.stamp, fields: ['outcome', 'enums', 'tables', 'columns'] }] : [];
  const unmeasured = a.axes_not_measured.map((x) => `${x.axis}: ${x.why}`);
  return envelope({
    tool, as_of: { captured_at: a.captured_at, captured_by: c.captured_by, note: a.source_commit ? `platform commit ${a.source_commit}` : null },
    verdict, case: verdict === 'unknown' ? a.unknown_because ?? 'unknown' : a.verdict,
    platform_signal: a.alert === 'sent' ? 'the drift script sent its alert' : null, evidence,
    blind_spots: verdict === 'unknown' ? [a.statement, ...unmeasured] : unmeasured, detail: a,
  }, table);
}

// The report keeps the reaper's status but not its row, so the snapshot supplies the row it read.
export function previewOutput(r: ReapingReport, s: PreviewSnapshot, table: SeverityTable): ToolOutput<ReapingReport> {
  const tool = 'platform.CAP.preview_stack_reaping';
  const reaperRows = s.ai_agents.filter((x) => x.agent_name === REAPER).map((x): Evidence => ({ table: 'ai_agents', id: x.id, fields: ['enabled', 'last_run_at'] }));
  const down = ['failed', 'disabled', 'overdue', 'never_run'].includes(r.reaper.status);
  const kase = r.attention.length ? 'stack_needs_attention' : down ? 'reaper_not_running' : null;
  const blind = [
    ...r.live.filter((x) => x.idle === 'unknown_idle').map((x) => `${x.slug}: ${x.reason}`),
    ...(r.reaper.status === 'untracked' ? [`${REAPER}: ${r.reaper.reason}`] : []),
  ];
  const evidence = kase ? [...rows(r.attention.map((x) => x.citation)), ...(down ? reaperRows : [])] : [...rows(r.live.map((x) => x.citation)), ...reaperRows];
  const verdict = kase ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: { captured_at: s.captured_at, captured_by: s.captured_by, note: null }, verdict, case: kase ?? verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? [...blind, 'no stack is running and no reaper row was read, so nothing is cited'] : blind, detail: r,
  }, table);
}
