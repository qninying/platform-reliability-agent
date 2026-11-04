// Adapters from the checks that recommend or rehearse an action (the disable recommendation, ticket resolution and
// orchestration repair in the sandbox) to the shared tool output. No check's logic changes: each adapter reads the
// answer the check already gives. Sandbox answers cite fixture rows, and say so in as_of.

import type { Recommendation } from '../capabilities/agentEnableDisableControl.ts';
import type { Verification } from '../capabilities/agentTicketAutoResolution.ts';
import type { RepairReport } from '../capabilities/orchestrationAutoRepair.ts';
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
