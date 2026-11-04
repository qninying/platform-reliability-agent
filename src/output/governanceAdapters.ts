// Adapters from the governance checks (evolution proposals, promotion evidence, reliability thresholds, the manager
// briefing, technology direction) to the shared tool output. No check's logic changes: each adapter reads the answer
// the check already gives. Every decision these checks inform stays with a person.

import type { ProposalReport } from '../capabilities/evolutionProposals.ts';
import type { PromotionAnswer } from '../capabilities/promotionEvidence.ts';
import type { ThresholdAnswer } from '../capabilities/reliabilityThresholds.ts';
import type { Briefing } from '../capabilities/reliabilityReport.ts';
import type { DirectionReport } from '../capabilities/workforceTechnologyDirection.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, commit: string | null = null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: commit ? `platform commit ${commit}` : null });

// A proposal made again after the same idea was rejected is the problem case: the platform checks only live initiatives.
export function evolutionOutput(r: ProposalReport, c: Capture, table: SeverityTable): ToolOutput<ProposalReport> {
  const tool = 'platform.CAP.infrastructure_evolution_proposals';
  const again = new Set(r.reproposed_after_rejection.flatMap((x) => [x.id, ...x.earlier_rejected]));
  const evidence = rows(r.proposals.filter((p) => !again.size || again.has(p.id)).flatMap((p) => p.citations));
  const verdict = again.size ? 'problem' : evidence.length ? 'ok' : 'unknown';
  return envelope({
    tool, as_of: at(c), verdict, case: again.size ? 'reproposed_after_rejection' : verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? ['no proposal was in the record, so nothing is cited'] : [], detail: r,
  }, table);
}

export function promotionOutput(a: PromotionAnswer, c: Capture, table: SeverityTable): ToolOutput<PromotionAnswer> {
  const tool = 'platform.CAP.agent_promotion_and_approval_decision';
  const evidence: Evidence[] = a.criteria.flatMap((k) => [...k.run_records, ...k.supporting].map((x) => ({ table: x.source, id: x.cite, fields: [`criterion ${k.number}`, x.kind] })));
  const met = a.criteria.some((k) => k.state === 'met');
  // Meeting the criteria is not a promotion: the level stays where a person set it.
  const verdict = a.verdict === 'meets_criteria' ? 'ok' : a.verdict === 'unmet' || a.verdict === 'above_ceiling' ? 'problem' : met && evidence.length ? 'partly_unknown' : 'unknown';
  const blind = [
    ...a.blockers,
    ...a.criteria.filter((k) => k.state === 'unproven').map((k) => `criterion ${k.number} unproven: ${k.text}`),
    ...a.not_counted.map((n) => `${n.kind} ${n.cite} not counted: ${n.why}`),
  ];
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict: evidence.length || verdict === 'unknown' ? verdict : 'unknown', case: a.verdict, platform_signal: null, evidence,
    blind_spots: blind.length ? blind : verdict === 'ok' ? [] : [a.statement], detail: a,
  }, table);
}

export function thresholdsOutput(a: ThresholdAnswer, c: Capture, table: SeverityTable): ToolOutput<ThresholdAnswer> {
  const tool = 'platform.CAP.reliability_threshold_ownership';
  const cite = (where: string | null, name: string): Evidence[] => (where ? [{ table: 'platform_source', id: where, fields: [name] }] : []);
  const clash = a.same_concept_different_numbers.flatMap((s) => s.values.flatMap((v) => cite(v.where, v.name)));
  const located = a.thresholds.filter((t) => t.located === 'read').flatMap((t) => cite(t.where, t.name));
  const blind = [
    ...(a.counts.unmeasured ? [`${a.counts.unmeasured} of ${a.counts.thresholds} thresholds have no outcome record, so whether they are well set is unknown`] : []),
    ...a.thresholds.filter((t) => t.located !== 'read').map((t) => `${t.name} in ${t.file}: ${t.located}`),
    ...a.outside_the_inventory.map((o) => `${o.where}: ${o.name} is threshold-shaped and outside the inventory`),
    ...(a.alert_record.read ? [] : ['no alert record was read, so no threshold\'s outcomes are known']),
  ];
  const evidence = clash.length ? clash : located;
  const verdict = clash.length ? 'problem' : !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: clash.length ? 'same_concept_different_numbers' : verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' && !blind.length ? [a.statement] : blind, detail: a,
  }, table);
}

// The briefing judges nothing itself; it is ok only when every item it reports was measured.
export function briefingOutput(b: Briefing, table: SeverityTable): ToolOutput<Briefing> {
  const tool = 'platform.CAP.reliability_briefing_for_manager';
  const evidence: Evidence[] = b.measured.filter((f) => f.value !== null).map((f) => ({ table: 'ellis_tool_output', id: f.source, fields: [f.label] }));
  const blind = b.unmeasured.map((u) => `${u.item}: ${u.why}`);
  const verdict = !evidence.length ? 'unknown' : blind.length ? 'partly_unknown' : 'ok';
  return envelope({
    tool, as_of: { captured_at: b.records_captured_at, captured_by: `briefing produced ${b.produced_at}`, note: b.source_commit ? `platform commit ${b.source_commit}` : null },
    verdict, case: verdict, platform_signal: null, evidence, blind_spots: verdict === 'unknown' && !blind.length ? [b.headline] : blind, detail: b,
  }, table);
}

export function directionOutput(r: DirectionReport, c: Capture, table: SeverityTable): ToolOutput<DirectionReport> {
  const tool = 'platform.CAP.workforce_technology_direction';
  const verdict = r.verdict === 'divergent' ? 'problem' : r.verdict === 'no_divergence' ? 'ok' : 'unknown';
  const blind = [
    ...(verdict === 'unknown' ? [r.direction.reason] : []),
    ...r.agents.filter((x) => x.state === 'not_recorded').map((x) => `${x.agent_name}: its tools are not recorded, so the tool rules cannot be checked`),
  ];
  const evidence = rows(r.citations);
  return envelope({
    tool, as_of: at(c), verdict: evidence.length || verdict === 'unknown' ? verdict : 'unknown', case: r.escalations.length ? 'divergence_needs_escalation' : r.verdict,
    platform_signal: null, evidence, blind_spots: blind.length ? blind : evidence.length ? [] : ['nothing was cited'], detail: r,
  }, table);
}
