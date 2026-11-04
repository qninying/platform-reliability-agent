// Adapters from the scheduler and registry checks (liveness, default-on timers, schedule governance, registry
// reconciliation, registry ask) to the shared tool output. No check's logic changes: each adapter reads the answer
// the check already gives. Most of these read platform source, so a file:line at a named commit is their evidence.

import type { LivenessAnswer } from '../capabilities/schedulerLiveness.ts';
import type { GuardAnswer } from '../capabilities/defaultOnTimerGuard.ts';
import type { GovernanceAnswer } from '../capabilities/scheduleGovernance.ts';
import { CLASS_KEYS, type ReconAnswer } from '../capabilities/registryReconciliation.ts';
import type { RegistryAnswer } from '../capabilities/registryReadSurface.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const at = (c: Capture, commit: string | null): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: commit ? `platform commit ${commit}` : 'commit not known' });
const source = (ref: string, fields: string[]): Evidence => ({ table: 'platform_source', id: ref, fields });
const snap = (c: Capture): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: null });

export function livenessOutput(a: LivenessAnswer, c: Capture, table: SeverityTable): ToolOutput<LivenessAnswer> {
  const tool = 'platform.CAP.scheduler_registration_liveness_probe';
  const probe = a.public_probe.at ? [source(`${a.public_probe.at.file}:${a.public_probe.at.line}`, ['GET /health'])] : [];
  const gate = a.gate.call_sites.map((s) => source(`${s.file}:${s.line}`, ['startScheduler', s.env_var ?? 'unguarded']));
  const none = a.registered.scheduled === 0;
  const blind = a.public_probe.detects_zero_timers === false;
  const verdict = none || blind ? 'problem' : a.public_probe.detects_zero_timers === null || !probe.length ? 'unknown' : 'ok';
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: none ? 'no_timer_registered' : blind ? 'probe_blind_to_zero_timers' : verdict,
    platform_signal: null, evidence: verdict === 'unknown' ? gate : [...probe, ...gate], blind_spots: a.blind_spots, detail: a,
  }, table);
}

export function defaultOnOutput(a: GuardAnswer, c: Capture, table: SeverityTable): ToolOutput<GuardAnswer> {
  const tool = 'platform.CAP.default_on_timer_guard';
  const sites = a.default_sites.map((s) => source(`${s.file}:${s.line}`, ['enabled ?? true']));
  const verdict = a.ungoverned.length ? 'problem' : sites.length ? 'ok' : 'unknown';
  const evidence = verdict === 'problem' ? [...a.ungoverned.flatMap((u) => u.at.map((ref) => source(ref, ['agentName', 'hardcodedSchedule']))), ...sites] : sites;
  const as_of = a.rows_from === 'records' ? { ...at(c, a.source_commit), captured_at: a.rows_captured_at } : at(c, a.source_commit);
  return envelope({
    tool, as_of, verdict, case: verdict === 'problem' ? 'ungoverned_on_by_default' : verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? ['no default site was found in the scheduler source', ...a.blind_spots] : a.blind_spots, detail: a,
  }, table);
}

export function governanceOutput(a: GovernanceAnswer, c: Capture, table: SeverityTable): ToolOutput<GovernanceAnswer> {
  const tool = 'platform.CAP.schedule_governance_live_reload';
  const sweep = a.proposals.filter((p) => p.origin === 'sweep');
  // Run rows come first in row_ids, then the AI calls traced to them.
  const cite = (ps: typeof a.proposals): Evidence[] => ps.flatMap((p) => p.evidence.row_ids.map((id, i): Evidence => (i < (p.evidence.runs ?? 0)
    ? { table: 'ai_agent_activity_logs', id, fields: ['result', 'duration_ms', 'created_at'] }
    : { table: 'ai_events', id, fields: ['trace_id', 'cost_usd'] })));
  const evidence = cite(sweep.length ? sweep : a.proposals);
  const verdict = sweep.length ? 'problem' : evidence.length ? 'ok' : 'unknown';
  const blind = a.proposals.flatMap((p) => p.evidence.blind_spots.map((b) => `${p.target}: ${b}`));
  return envelope({
    tool, as_of: at(c, a.source_commit), verdict, case: verdict === 'problem' ? 'job_failing_every_run' : verdict, platform_signal: null, evidence,
    blind_spots: verdict === 'unknown' ? [a.statement, ...blind] : blind, detail: a,
  }, table);
}

export function reconOutput(a: ReconAnswer, table: SeverityTable): ToolOutput<ReconAnswer> {
  const tool = 'platform.CAP.registry_runtime_reconciliation';
  const commit = a.source_commit ?? 'unknown commit';
  const fresh = CLASS_KEYS.flatMap((k) => (a.classes[k].new_since_baseline ?? []).map((e) => source(`${commit}#${k}/${e}`, [k])));
  const verdict = fresh.length ? 'problem' : a.verdict === 'no_baseline' ? 'partly_unknown' : 'ok';
  // Without new drift, each class's measured count stands behind the answer.
  const evidence = fresh.length ? fresh : CLASS_KEYS.map((k) => source(`${commit}#${k}`, ['count', 'entries']));
  return envelope({
    tool, as_of: { captured_at: a.measured_at, captured_by: 'measured from platform source', note: a.source_commit ? `platform commit ${a.source_commit}` : 'commit not known' },
    verdict, case: verdict === 'problem' ? 'new_drift' : a.verdict, platform_signal: null, evidence,
    blind_spots: a.verdict === 'no_baseline' ? ['no baseline was read, so nothing is said about what is new', ...a.cannot_say] : a.cannot_say, detail: a,
  }, table);
}

export function registryAskOutput(a: RegistryAnswer, c: Capture, table: SeverityTable): ToolOutput<RegistryAnswer> {
  const tool = 'platform.CAP.agent_registry_read_surface';
  if (a.registration === 'ambiguous') {
    return envelope({ tool, as_of: snap(c), verdict: 'problem', case: 'more_than_one_row', platform_signal: null, evidence: rows(a.citations), blind_spots: [a.statement], detail: a }, table);
  }
  if (a.registration === 'not_registered') {
    // A timer gated on this very name, which has no row, runs untracked. One that checks another row records there.
    const firing = a.timers_with_this_name.filter((t) => t.note.startsWith('with no row')).map((t): Evidence => ({ table: 'timer_inventory', id: t.timer, fields: ['schedule', 'ref'] }));
    return envelope({ tool, as_of: snap(c), verdict: firing.length ? 'problem' : 'unknown', case: firing.length ? 'fires_with_no_row' : 'not_registered', platform_signal: null, evidence: firing, blind_spots: [a.statement], detail: a }, table);
  }
  return envelope({ tool, as_of: snap(c), verdict: 'ok', case: 'registered', platform_signal: null, evidence: rows(a.citations), blind_spots: [...a.schedule.notes, ...a.runs.notes], detail: a }, table);
}
