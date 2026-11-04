// Adapters from the security checks (posture scans, access watch, behaviour watch, the security rollup, autonomy
// authority) to the shared tool output. No check's logic changes: each adapter reads the answer the check already
// gives. A scanner's own finding severity, or the platform director's verdict, travels as platform_signal only.

import type { ScanAnswer } from '../capabilities/securityPostureScan.ts';
import type { AccessReport } from '../capabilities/runtimeThreatAccessWatch.ts';
import type { BehaviorReport } from '../capabilities/agentBehaviorSafetyWatch.ts';
import type { Rollup } from '../capabilities/securityOversightRollup.ts';
import type { AuthorityAnswer } from '../capabilities/autonomyAuthority.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, note: string | null = null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note });
const RANK = ['critical', 'high', 'medium', 'low'];

export function postureOutput(scans: ScanAnswer[], c: Capture, table: SeverityTable): ToolOutput<ScanAnswer[]> {
  const tool = 'platform.CAP.security_posture_scan';
  const found = scans.filter((s) => s.status === 'findings');
  const clean = scans.filter((s) => s.status === 'clean');
  const unknown = scans.filter((s) => s.status === 'unknown');
  const verdict = found.length ? 'problem' : !unknown.length && clean.length ? 'ok' : clean.length ? 'partly_unknown' : 'unknown';
  const severities = new Set(found.flatMap((s) => s.findings.map((f) => String(f.severity ?? '').toLowerCase())));
  const top = RANK.find((r) => severities.has(r));
  return envelope({
    tool, as_of: at(c), verdict, case: verdict === 'problem' ? 'findings' : verdict,
    platform_signal: top ? `highest scanner finding severity: ${top}` : null,
    evidence: rows((verdict === 'problem' ? found : clean).flatMap((s) => s.citations)),
    blind_spots: unknown.map((s) => `${s.scan} scan: ${s.reason}`), detail: scans,
  }, table);
}

// A login gained, or sections reached only through a staff management role, is for a person to review.
export function accessOutput(r: AccessReport, c: Capture, table: SeverityTable): ToolOutput<AccessReport> {
  const tool = 'platform.CAP.runtime_threat_and_access_watch';
  const gained = (r.changes ?? []).filter((x) => x.kind === 'added' || x.kind === 'sections_gained' || x.kind === 'status_changed');
  const bridge = r.sweep.identities.filter((i) => i.status === 'bridge_only');
  const flagged = new Set([...gained.map((x) => x.email), ...bridge.map((i) => i.email)]);
  const cite = (emails: Set<string> | null): Evidence[] => r.sweep.identities.filter((i) => !emails || emails.has(i.email)).flatMap((i) => i.citations.map((x) => ({ table: x.table, id: x.id, fields: ['email', 'role'] })));
  const audit: Evidence[] = r.access_audit_rows.map((x) => ({ table: 'audit_logs', id: x.id, fields: ['actor', 'entity_id', 'new_values'] }));
  const verdict = flagged.size ? 'problem' : r.changes === null ? 'partly_unknown' : 'ok';
  const evidence = verdict === 'problem' ? [...cite(flagged), ...audit] : cite(null);
  const final = evidence.length ? verdict : 'unknown';
  const blind = [...(r.changes === null ? ['no previous sweep was given, so what changed is unknown, not nothing'] : []), ...r.limits];
  return envelope({
    tool, as_of: at(c, `section rules at platform commit ${r.sweep.section_rules_commit}`), verdict: final,
    case: gained.length ? 'access_gained' : bridge.length ? 'bridge_only_access' : final, platform_signal: null, evidence,
    blind_spots: evidence.length ? blind : ['no identity was in the sweep, so nothing is cited', ...blind], detail: r,
  }, table);
}

export function behaviorOutput(r: BehaviorReport, c: Capture, table: SeverityTable): ToolOutput<BehaviorReport> {
  const tool = 'platform.CAP.agent_behavior_safety_watch';
  const allowed = r.findings.some((f) => f.platform_verdict === 'allowed');
  const blind = [
    ...r.unattributable.map((u) => `${u.source} ${u.row_id}: ${u.reason}`),
    ...r.not_emitted.map((n) => `${n.source} ${n.row_id}: ${n.reason}`),
  ];
  if (r.findings.length) {
    return envelope({
      tool, as_of: at(c, `grants at commit ${r.grants_commit}`), verdict: 'problem', case: allowed ? 'write_outside_grant_allowed' : 'write_outside_grant',
      platform_signal: null, evidence: r.findings.map((f) => ({ table: f.citation.table, id: f.citation.id, fields: ['agent', f.missing_grant.kind] })), blind_spots: blind, detail: r,
    }, table);
  }
  // The report keeps counts of the rows it examined, not their ids, so a clean window has nothing to cite.
  const n = r.rows_examined.write_audits + r.rows_examined.state_changes + r.rows_examined.authorization_events;
  return envelope({
    tool, as_of: at(c, `grants at commit ${r.grants_commit}`), verdict: 'unknown', case: 'no_finding', platform_signal: null, evidence: [],
    blind_spots: [`${n} row(s) examined in ${r.window_hours} hours and none outside its grant, but the report keeps no row ids, so nothing is cited`, ...blind], detail: r,
  }, table);
}

export function rollupOutput(r: Rollup, c: Capture, table: SeverityTable): ToolOutput<Rollup> {
  const tool = 'platform.CAP.security_oversight_rollup';
  const pick = (k: string) => r.contributions.filter((x) => x.contribution === k);
  const dirty = pick('dirty'), clean = pick('clean'), unknown = pick('unknown');
  const verdict = r.verdict === 'red' ? 'problem' : r.verdict === 'green' ? 'ok' : clean.length ? 'partly_unknown' : 'unknown';
  const d = r.platform_director;
  return envelope({
    tool, as_of: at(c), verdict, case: verdict === 'problem' ? 'scanner_reports_problem' : verdict,
    platform_signal: d.verdict ? `security director reads ${d.verdict}${d.disagrees ? ', which Ellis does not' : ''}` : null,
    evidence: rows((verdict === 'problem' ? dirty : clean).flatMap((x) => x.citations)),
    blind_spots: verdict === 'unknown' && !unknown.length ? [r.reason] : unknown.map((x) => `${x.agent_name}: ${x.reason}`), detail: r,
  }, table);
}

// The first two limits say where the levels and grants come from; they apply to every answer.
export function authorityOutput(a: AuthorityAnswer, c: Capture, table: SeverityTable): ToolOutput<AuthorityAnswer> {
  const tool = 'platform.CAP.capability_autonomy_authority_resolution';
  const evidence: Evidence[] = a.authorities.map((x) => ({ table: 'capability_record', id: x.capability_id, fields: ['approved_autonomy', 'max_permitted_autonomy', 'granted_tools'] }));
  // A copy of the rules that does not match the platform's module cannot vouch for any level.
  const verdict = !a.rules_match || !evidence.length ? 'unknown' : 'ok';
  return envelope({
    tool, as_of: at(c, a.source_commit ? `platform commit ${a.source_commit}` : null), verdict, case: a.rules_match ? verdict : 'rules_unconfirmed',
    platform_signal: null, evidence, blind_spots: verdict === 'unknown' ? [a.statement, ...a.limits.slice(0, 2)] : a.limits.slice(0, 2), detail: a,
  }, table);
}
