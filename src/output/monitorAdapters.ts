// Adapters from K.D.'s five first monitors to the shared tool output (the fifth, the system health probe, folded
// into system resilience supervision on 2026-11-04, so it is two adapters there). No monitor's logic changes:
// each adapter only reads the answer it already gives and maps it onto the envelope.

import type { HealthAnswer as OrchestrationAnswer, Refusal, Citation } from '../capabilities/orchestrationHealthWatch.ts';
import type { HealthAnswer as CronAnswer } from '../capabilities/cronHealthAlerting.ts';
import type { ScoreAnswer } from '../capabilities/agentHealthScoring.ts';
import type { TraceAnswer } from '../capabilities/incidentTrace.ts';
import type { PostureReport } from '../capabilities/systemResilienceSupervision.ts';
import type { ProbeAnswer } from '../capabilities/platformHealthProbe.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';

export interface Capture { captured_at: string; captured_by: string }

const fromCitations = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const captured = (c: Capture): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: null });

export function orchestrationOutput(a: OrchestrationAnswer | Refusal, c: Capture, table: SeverityTable): ToolOutput<OrchestrationAnswer | Refusal> {
  const tool = 'platform.CAP.orchestration_health_watch';
  if (a.kind === 'refusal') {
    return envelope({ tool, as_of: captured(c), verdict: 'unknown', case: 'refusal', platform_signal: null, evidence: [], blind_spots: [a.reason], detail: a }, table);
  }
  const verdict = a.verdict === 'healthy' ? 'ok' : a.verdict === 'unknown' ? 'unknown' : 'problem';
  const platform_signal = a.verdict === 'degraded' || a.verdict === 'critical' ? `orchestration run verdict: ${a.verdict}` : null;
  return envelope({ tool, as_of: captured(c), verdict, case: a.verdict, platform_signal, evidence: fromCitations(a.citations), blind_spots: verdict === 'unknown' ? [a.reason] : [], detail: a }, table);
}

export function cronHealthOutput(a: CronAnswer, c: Capture, table: SeverityTable): ToolOutput<CronAnswer> {
  const tool = 'platform.CAP.cron_health_alerting';
  const verdict = a.answer === 'alerting' ? 'problem' : a.answer === 'clear' ? 'ok' : 'partly_unknown';
  const cited = a.answer === 'alerting' ? a.alerting : [...a.clear, ...a.partly_evaluated];
  const types = new Set(a.alerting.flatMap((e) => e.alerts.map((x) => x.type)));
  const platform_signal = types.has('critical') ? 'cron alert type: critical' : types.has('warning') ? 'cron alert type: warning' : null;
  const blind_spots = [
    ...a.cannot_say,
    ...a.not_evaluated.map((n) => `${n.name}: ${n.statement}`),
    ...a.partly_evaluated.map((e) => `${e.name}: only partly evaluated`),
  ];
  return envelope({ tool, as_of: captured(c), verdict, case: platform_signal ? platform_signal.replace('cron alert type: ', '') : a.answer, platform_signal, evidence: fromCitations(cited.flatMap((e) => e.citations)), blind_spots, detail: a }, table);
}

// The registry tab's own red band (under 60), quoted as the platform's signal, not as Ellis's severity.
const RED_BAND = 60;

export function agentHealthOutput(a: ScoreAnswer, c: Capture, table: SeverityTable): ToolOutput<ScoreAnswer> {
  const tool = 'platform.CAP.agent_health_scoring';
  const red = a.scored.filter((s) => s.score !== null && s.score < RED_BAND);
  const attention = [...a.scored, ...a.unscored, ...a.score_cannot_fall].filter((s) => s.attention);
  const problems = [...new Map([...red, ...attention].map((s) => [s.row_id, s])).values()];
  const unseen = [...a.unscored, ...a.score_cannot_fall];
  const blind_spots = [
    ...a.cannot_say,
    ...unseen.map((s) => `${s.name}: ${s.label}`),
    ...a.no_row.map((n) => `${n.name}: ${n.statement}`),
  ];
  const verdict = problems.length > 0 ? 'problem' : blind_spots.length > 0 ? 'partly_unknown' : 'ok';
  const cited = verdict === 'problem' ? problems : a.scored;
  const platform_signal = red.length > 0 ? `registry tab red band (under ${RED_BAND}): ${red.length} agent(s)` : null;
  return envelope({ tool, as_of: captured(c), verdict, case: red.length > 0 ? 'red_band' : attention.length > 0 ? 'failures_score_hides' : verdict, platform_signal, evidence: fromCitations(cited.flatMap((s) => s.citations)), blind_spots, detail: a }, table);
}

export function incidentTraceOutput(a: TraceAnswer, c: Capture, table: SeverityTable): ToolOutput<TraceAnswer> {
  const tool = 'platform.CAP.incident_trace_and_error_triage';
  const evidence: Evidence[] = a.steps.map((s) => ({ table: s.table, id: s.id, fields: ['id', 'created_at'] }));
  if (a.error_record) evidence.push({ table: 'campaign_errors', id: a.error_record.id, fields: ['error_message', 'component', 'severity', 'resolved'] });
  const answered = a.verdict === 'traced' || a.verdict === 'no_failure_recorded';
  // An answer with nothing to cite is reported as unknown rather than as ok.
  const verdict = !answered || evidence.length === 0 ? 'unknown' : a.failures.length > 0 ? 'problem' : 'ok';
  const blind_spots = verdict === 'unknown' ? [a.statement, ...a.cannot_say] : a.cannot_say;
  const platform_signal = a.error_record ? `campaign_errors severity: ${a.error_record.severity}` : null;
  return envelope({ tool, as_of: captured(c), verdict, case: verdict === 'problem' ? 'failure_traced' : a.verdict, platform_signal, evidence, blind_spots, detail: a }, table);
}

export function resilienceOutput(a: PostureReport, c: Capture, table: SeverityTable): ToolOutput<PostureReport> {
  const tool = 'platform.CAP.system_resilience_supervision';
  const degraded = a.subsystems.filter((x) => x.state === 'degraded');
  const unknown = a.subsystems.filter((x) => x.state === 'unknown');
  // A known problem is reported even while other parts are unknown; unknown parts never read as healthy.
  const verdict = degraded.length ? 'problem' : unknown.length === a.subsystems.length ? 'unknown' : unknown.length ? 'partly_unknown' : 'ok';
  const cited = verdict === 'problem' ? degraded : a.subsystems.filter((x) => x.state !== 'unknown');
  const sup = a.platform_supervisor;
  const platform_signal = sup.health ? `platform supervisor reads ${sup.health}${sup.disagrees ? ', which Ellis does not' : ''}` : null;
  return envelope({ tool, as_of: captured(c), verdict, case: verdict === 'problem' ? 'subsystem_degraded' : verdict, platform_signal, evidence: fromCitations(cited.flatMap((x) => x.citations)), blind_spots: unknown.map((x) => `${x.subsystem}: ${x.reason}`), detail: a }, table);
}

// The health probes read an export of GET /health/full, not table rows: the export itself is the evidence.
export function healthProbeOutput(a: ProbeAnswer, c: Capture, table: SeverityTable): ToolOutput<ProbeAnswer> {
  const tool = 'platform.CAP.system_resilience_supervision';
  const evidence: Evidence[] = a.report_at ? [{ table: 'health_full_export', id: a.report_at, fields: a.checks.filter((x) => x.platform_severity !== 'not_reported').map((x) => x.name) }] : [];
  const blind_spots = [...a.checks.filter((x) => x.state === 'unknown').map((x) => `${x.name}: ${x.why}`), ...a.cannot_see.map((b) => b.what)];
  const verdict = a.verdict !== 'unknown' && evidence.length === 0 ? 'unknown' : a.verdict;
  return envelope({ tool, as_of: captured(c), verdict, case: verdict === 'problem' ? 'health_check_failing' : verdict, platform_signal: a.platform_overall ? `GET /health/full overall_status: ${a.platform_overall}` : null, evidence, blind_spots, detail: a }, table);
}
