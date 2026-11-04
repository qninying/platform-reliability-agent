// platform.registry_runtime_reconciliation, extended with registration proposals (A.M., 2026-11-04: runtime cron
// drift detection and untracked timer registration proposal fold into reconciliation). For every name a timer
// fires that has no seed row, measured just now, it proposes a registry row and states the enabled value it
// would arrive with. Creating the rows, and choosing to govern or retire each timer, stay with a person: Ellis
// writes nothing.
//
// Why each proposal states enabled (platform repo, commit cc1ebc5): a new row defaults to enabled
// (models/AiAgent.ts:423-427), and every wrapper that reads a row honours it (agents/agentControlGate.ts:38-44).
// What a row changes depends on which row the timer's runner reads, which is not always its own name: a timer that
// goes through instrumentCronJob runs today untracked and reads its own name; a registry entry whose runner calls
// runAgent('<Row>') or trackAgentRun('<Row>') reads that row, and runAgent finding none returns without running
// (aiOrchestrator.ts:184-188). So the proposed row is the one the runner reads, and none when it already exists.

import { ContractViolation } from '../output/toolOutput.ts';
import type { Measurement, ReconAnswer } from './registryReconciliation.ts';

export interface ProposedRow { agent_name: string; trigger_type: 'cron'; schedule: string | null; enabled: boolean }
export type RunsToday = 'yes_untracked' | 'yes_on_another_row' | 'no_row_to_run_on' | 'cannot_say';
export interface Proposal {
  name: string;
  runs_today: RunsToday;
  // The row the timer's runner reads: its own name unless the runner names another.
  governed_by: string;
  measured_at: string;
  source_commit: string | null;
  call_sites: string[];
  schedules: string[];
  // null when the row the runner reads already exists: no new row is needed.
  proposed_row: ProposedRow | null;
  enabled_because: string;
  // Facts that bear on govern or retire. Ellis does not choose: purpose is not in the source it reads.
  govern_or_retire: 'a person decides';
  notes: string[];
}
export interface ProposalSet { measured_at: string; source_commit: string | null; count: number; proposals: Proposal[]; statement: string }

// A literal five-field cron expression, as opposed to a variable or an expression the source builds.
const LITERAL_CRON = /^[\d*,/\-A-Za-z]+( [\d*,/\-A-Za-z?]+){4}$/;

export function proposeRegistrations(m: Measurement, a: ReconAnswer): ProposalSet {
  const untracked = a.classes.scheduledNamesWithNoSeedRow.entries;
  const hasRow = new Map(a.beyond_the_platform_reconciler.untracked_names_that_have_a_row.map((x) => [x.name, x.row_source]));
  const recordsOn = new Map(a.beyond_the_platform_reconciler.untracked_names_that_record_on_a_row.map((x) => [x.registry_name, x.row]));
  const codeRows = new Set(m.codeRows.map((r) => r.agentName));
  const runner = new Map(m.recordedUnder.map((x) => [x.agentName, x]));
  const proposals = untracked.map((name): Proposal => {
    const sites = m.nameSites.filter((s) => s.name === name);
    // A count with no name and no call site behind it is not published (the story's acceptance).
    if (sites.length === 0) throw new ContractViolation(`${name} is measured as untracked but no call site was recorded for it`);
    const schedules = [...new Set(sites.map((s) => s.schedule).filter((x): x is string => x !== null))].sort();
    const literal = schedules.filter((x) => LITERAL_CRON.test(x));
    const notes: string[] = [];
    if (schedules.length !== literal.length || sites.some((s) => s.schedule === null)) notes.push('at least one call site\'s schedule is not a literal cron expression in the source; the proposed schedule needs a person to read it');
    if (literal.length > 1) notes.push(`registered on ${literal.length} schedules (${literal.join('; ')}); one row would pool their runs`);
    if (hasRow.has(name)) notes.push(`a ${hasRow.get(name)} row already carries this name outside the seed; the proposal is to add it to the seed, not a second row`);
    const r = runner.get(name);
    const governed_by = r?.row ?? name;
    let runs_today: RunsToday;
    let enabled_because: string;
    if (r && (r.how === 'director_gate' || r.how === 'unknown' || r.row === null)) {
      runs_today = 'cannot_say';
      enabled_because = 'whether it runs today cannot be read from its runner; a person checks before choosing enabled';
    } else if (governed_by !== name && codeRows.has(governed_by)) {
      runs_today = 'yes_on_another_row';
      enabled_because = `no new row is needed: its runner reads row ${governed_by}, which exists and already gates it`;
    } else if (governed_by !== name) {
      runs_today = 'no_row_to_run_on';
      enabled_because = `today it does nothing: its runner reads row ${governed_by}, which does not exist. A row arriving enabled would start it; disabled, it stays off. A person chooses which.`;
    } else {
      runs_today = 'yes_untracked';
      enabled_because = 'it runs today untracked; a row arriving enabled keeps it running and makes it governable, a row arriving disabled would stop it. A person chooses which.';
    }
    if (recordsOn.has(name)) notes.push(`its runs are recorded today on row ${recordsOn.get(name)}; a row under its own name would not gate it`);
    const needed = runs_today !== 'yes_on_another_row';
    return {
      name, runs_today, governed_by, measured_at: m.measured_at, source_commit: m.source_commit,
      call_sites: sites.map((s) => s.ref),
      schedules,
      proposed_row: needed ? { agent_name: governed_by, trigger_type: 'cron', schedule: literal.length === 1 && literal.length === schedules.length && sites.every((x) => x.schedule !== null) ? literal[0] : null, enabled: runs_today !== 'no_row_to_run_on' } : null,
      enabled_because,
      govern_or_retire: 'a person decides',
      notes,
    };
  });
  return {
    measured_at: m.measured_at, source_commit: m.source_commit, count: proposals.length, proposals,
    statement: `${proposals.length} untracked timer name(s) measured ${m.measured_at}${m.source_commit ? ` at platform commit ${m.source_commit}` : ''}: `
      + `${proposals.filter((p) => p.runs_today === 'yes_untracked').length} run today untracked, ${proposals.filter((p) => p.runs_today === 'no_row_to_run_on').length} do nothing for want of a row, `
      + `${proposals.filter((p) => p.runs_today === 'yes_on_another_row').length} are already gated by another row and need none, and ${proposals.filter((p) => p.runs_today === 'cannot_say').length} cannot be said. `
      + `Each proposal names its call sites and the enabled value the row would arrive with; ${proposals.filter((p) => p.proposed_row && p.notes.length).length} proposed row(s) need a person to read a note first. Govern or retire is a person's decision for every one.`,
  };
}
