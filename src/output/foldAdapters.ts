// Adapters from the checks A.M.'s 4 November ruling added (the folds and the merged manager-access check) to the
// shared tool output. No check's logic changes: each adapter reads the answer the check already gives.

import type { FleetStopAnswer } from '../capabilities/fleetStopLevers.ts';
import type { DiscoveryPreview } from '../capabilities/discoveryPreview.ts';
import type { ProposalSet } from '../capabilities/registrationProposal.ts';
import type { ReconAnswer } from '../capabilities/registryReconciliation.ts';
import type { AccessAnswer } from '../capabilities/managerAccess.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';
import { envelope, type AsOf, type Evidence, type SeverityTable, type ToolOutput } from './toolOutput.ts';
import type { Capture } from './monitorAdapters.ts';

const rows = (cs: Citation[]): Evidence[] => cs.map((c) => ({ table: c.table, id: c.id, fields: c.fields }));
const captured = (c: Capture): AsOf => ({ captured_at: c.captured_at, captured_by: c.captured_by, note: null });
// A timer with no row has nothing in a table to cite; the inventory entry read from source is its evidence.
const timer = (name: string): Evidence => ({ table: 'timer_inventory', id: name, fields: ['gates'] });

export function fleetStopOutput(a: FleetStopAnswer, c: Capture, table: SeverityTable): ToolOutput<FleetStopAnswer> {
  const tool = 'platform.CAP.agent_enable_disable_control';
  const out = a.emergency_stop.timers_not_reached;
  const verdict = out.length || a.resume_undoes.length ? 'problem' : 'ok';
  const evidence = verdict === 'problem'
    ? [...out.map((t) => timer(t.timer)), ...a.resume_undoes.map((r): Evidence => ({ table: 'ai_agents', id: r.row_id, fields: ['enabled', 'status'] }))]
    : rows(a.citations);
  return envelope({
    tool, as_of: captured(c), verdict, case: out.length ? 'timers_out_of_reach' : a.resume_undoes.length ? 'resume_undoes_a_choice' : 'ok',
    platform_signal: null, evidence,
    blind_spots: ['Which jobs send through the send check is not read, so what the kill switch and scheduler pause block is stated, not measured', 'Production may hold rows the code does not create'],
    detail: a,
  }, table);
}

export function discoveryOutput(a: DiscoveryPreview, c: Capture, table: SeverityTable): ToolOutput<DiscoveryPreview> {
  const tool = 'platform.CAP.agent_registry_read_surface';
  const starts = a.would_create.filter((w) => w.arrives_enabled && w.timers.some((t) => /starts running/.test(t.change)));
  const verdict = starts.length || a.never_discovered.length ? 'problem' : 'ok';
  const evidence = verdict === 'problem'
    ? [...starts.map((w): Evidence => ({ table: 'platform_source', id: `seed:${w.agent_name}`, fields: ['enabled'] })), ...a.never_discovered.map((n) => timer(n.timer))]
    : rows(a.citations);
  return envelope({
    tool, as_of: captured(c), verdict, case: starts.length ? 'discover_would_start_timers' : a.never_discovered.length ? 'timers_never_discovered' : 'ok',
    platform_signal: null, evidence, blind_spots: a.cannot_see, detail: a,
  }, table);
}

export function proposalsOutput(p: ProposalSet, recon: ReconAnswer, table: SeverityTable): ToolOutput<ProposalSet> {
  const tool = 'platform.CAP.registry_runtime_reconciliation';
  const needed = p.proposals.filter((x) => x.proposed_row !== null);
  const verdict = needed.length ? 'problem' : 'ok';
  const cited = verdict === 'problem' ? needed : p.proposals;
  const evidence: Evidence[] = cited.flatMap((x) => x.call_sites.map((ref) => ({ table: 'platform_source', id: ref, fields: ['cron.schedule', 'instrumentCronJob'] })));
  // An ok with no untracked name has no call site to cite; the measurement itself stands behind it.
  const behind = evidence.length ? evidence : [{ table: 'platform_source', id: p.source_commit ?? 'unknown commit', fields: ['measured', 'scheduledNamesWithNoSeedRow'] }];
  return envelope({
    tool, as_of: { captured_at: p.measured_at, captured_by: 'measured from platform source', note: p.source_commit ? `platform commit ${p.source_commit}` : 'commit not known' },
    verdict, case: verdict === 'problem' ? 'untracked_timers_need_rows' : 'ok', platform_signal: null, evidence: behind, blind_spots: recon.cannot_say, detail: p,
  }, table);
}

export function managerAccessOutput(a: AccessAnswer, c: Capture, table: SeverityTable): ToolOutput<AccessAnswer> {
  const tool = 'platform.CAP.manager_scoped_authorization';
  const missed = a.directives.filter((d) => d.effect === 'missed_by_own_replies');
  const cutOff = a.accountable !== null && !a.accountable.passes_the_gate;
  const verdict = a.agent === null ? 'unknown' : cutOff || missed.length ? 'problem' : 'ok';
  return envelope({
    tool, as_of: captured(c), verdict,
    case: cutOff ? 'manager_cannot_reach_agent' : missed.length ? 'directive_missed_by_own_replies' : verdict,
    platform_signal: null, evidence: verdict === 'unknown' ? [] : rows(a.citations),
    blind_spots: verdict === 'unknown' ? [a.statement, ...a.cannot_see] : a.cannot_see, detail: a,
  }, table);
}
