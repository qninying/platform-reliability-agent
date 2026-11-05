// platform.untracked_timer_registration_proposal, rung R3 (A.M. folded the capability into registry reconciliation on
// 2026-11-04; its rung story stands): on an operator's request, generates the proposed row set from a sandbox
// checkout, validates it, applies it to a sandbox registry and ticks every timer's gate. Each proposed row must name
// its enabled value, and applying the set must start no timer the proposal marked disabled. The same rows applied
// without enabled run beside it as the positive control: the column's default starts the timer the proposal kept off.
// Sandbox only: nothing runs on the platform, and no production row is created.
//
// Platform facts this rests on (platform repo, commit a29dfb245):
// - A row created without enabled arrives enabled (backend/src/models/AiAgent.ts:423-427).
// - Every wrapper runs a row only when it is enabled and not paused (agents/agentControlGate.ts:38-44).
// - With no row, instrumentCronJob runs the job untracked (cronInstrumentation.ts:35-39), and runAgent returns
//   without running it (aiOrchestrator.ts:184-188).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { sandboxDir } from '../sandbox/schemaDatabases.ts';
import { applyRows, createRegistry, readGate } from '../sandbox/sandboxRegistry.ts';
import { measure, reconcileAnswer } from './registryReconciliation.ts';
import { proposeRegistrations, type ProposalSet, type RunsToday } from './registrationProposal.ts';
import { reader } from './ratchetRehearsal.ts';

export const PINNED_AT = 'a29dfb245';
export const LIMITS: readonly string[] = [
  'The checkout is a small one shaped like the platform\'s. The proposal set over the real checkout is the R2 answer.',
  'The sandbox registry starts with every row created in code, enabled. A production registry also holds rows earlier seeds and agentFactory created, with whatever enabled values operators set.',
  'A timer whose runner Ellis cannot read, or that runs through a director gate, is not ticked: what it does with a row is not known.',
  'Creating the rows in production, and choosing per timer to govern or retire it and with which enabled value, are K.D.\'s decisions and a person\'s action.',
];

const MEASURED_AT = new Date('2026-11-05T00:00:00Z');

// Problems with a proposal set as data, whoever produced it. An empty list means every proposed row names enabled.
export function validateProposalSet(set: ProposalSet): string[] {
  const out: string[] = [];
  const names = new Map<string, number>();
  for (const p of set.proposals) {
    const r = p.proposed_row as (ProposalSet['proposals'][number]['proposed_row'] & Record<string, unknown>) | null;
    if (!r) {
      if (p.runs_today !== 'yes_on_another_row' && p.runs_today !== 'yes_on_its_own_row') out.push(`${p.name}: no row is proposed, but its runner's row is not known to exist`);
      continue;
    }
    if (typeof r.enabled !== 'boolean') out.push(`${p.name}: the proposed row ${String(r.agent_name)} does not name its enabled value`);
    if (r.agent_name !== p.governed_by) out.push(`${p.name}: the proposed row is ${String(r.agent_name)}, but its runner reads ${p.governed_by}`);
    names.set(String(r.agent_name), (names.get(String(r.agent_name)) ?? 0) + 1);
  }
  for (const [n, c] of names) if (c > 1) out.push(`${n}: proposed ${c} times`);
  return out;
}

export interface TimerResult { name: string; governed_by: string; runs_today: RunsToday; marked_enabled: boolean | null; before: boolean; after: boolean; after_without_enabled: boolean }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  initiated_by: string;
  proposals: ProposalSet;
  problems: string[];
  applied: string[];
  refused: Array<{ agent_name: string; why: string }>;
  timers: TimerResult[];
  not_ticked: string[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export interface ProposalFixture { fixture_id: string; description: string; files: Record<string, string> }

export function rehearse(fx: ProposalFixture, sandboxRoot: string, operator: string, generate: (s: ProposalSet) => ProposalSet = (s) => s): Rehearsal {
  if (!operator.trim()) throw new SandboxError('ContractViolation', 'a proposal run is started by a named operator');
  const m = measure(reader(fx.files), MEASURED_AT, 'sandbox');
  const set = generate(proposeRegistrations(m, reconcileAnswer(m)));
  const problems = validateProposalSet(set);
  const dir = sandboxDir(sandboxRoot);
  const seed = m.codeRows.map((r) => ({ agent_name: r.agentName, trigger_type: r.triggerType, schedule: r.schedule || null }));
  const before = createRegistry(dir, 'registry-before', seed);
  const explicit = createRegistry(dir, 'registry-applied', seed);
  const implicit = createRegistry(dir, 'registry-applied-without-enabled', seed);
  const rows = set.proposals.flatMap((p) => (p.proposed_row ? [p.proposed_row] : []));
  const { inserted, refused } = applyRows(explicit, rows, true);
  applyRows(implicit, rows, false);
  // A tick: the row the runner reads decides; with no row, only a runner that runs untracked runs.
  const tick = (path: string, p: ProposalSet['proposals'][number]) => {
    return readGate(path, p.governed_by) ?? p.runs_today === 'yes_untracked';
  };
  const ticked = set.proposals.filter((p) => p.runs_today !== 'cannot_say');
  const timers = ticked.map((p): TimerResult => ({
    name: p.name, governed_by: p.governed_by, runs_today: p.runs_today,
    marked_enabled: p.proposed_row ? (typeof p.proposed_row.enabled === 'boolean' ? p.proposed_row.enabled : null) : null,
    before: tick(before, p), after: tick(explicit, p), after_without_enabled: tick(implicit, p),
  }));
  const off = timers.filter((t) => t.marked_enabled === false);
  const checks: Record<string, boolean> = {
    every_row_names_enabled: problems.length === 0,
    // Without a row marked disabled, "starts no disabled timer" says nothing.
    a_row_is_marked_disabled: off.length > 0,
    every_row_applied: refused.length === 0,
    no_disabled_timer_started: off.every((t) => !t.after),
    enabled_timers_run: timers.filter((t) => t.marked_enabled !== false).every((t) => t.after),
    // The positive control: the same rows without enabled start a timer the proposal kept off.
    default_enabled_starts_a_disabled_timer: off.some((t) => t.after_without_enabled),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const on = timers.filter((t) => t.marked_enabled !== false);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, initiated_by: operator, proposals: set, problems, applied: inserted, refused, timers,
    not_ticked: set.proposals.filter((p) => p.runs_today === 'cannot_say').map((p) => p.name), checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}, started by ${operator}: ${set.count} untracked names measured, ${rows.length} rows proposed, each naming its enabled value. Applied to a sandbox registry, the ${on.length} timers meant to run (marked enabled, or gated by a row that exists) all run, and the ${off.length} marked disabled (${off.map((t) => `${t.name} via ${t.governed_by}`).join(', ')}) does not start. Applied without enabled, the column's default starts ${off.filter((t) => t.after_without_enabled).map((t) => t.name).join(', ')}. ${set.proposals.filter((p) => p.runs_today === 'cannot_say').length} timer(s) could not be ticked. Creating the rows is a person's action. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

export function loadProposalFixture(path: string): ProposalFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: ProposalFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof fx?.fixture_id !== 'string' || !fx.files || typeof fx.files !== 'object' || !Object.values(fx.files).every((v) => typeof v === 'string')) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id and files { path: text }`);
  }
  return fx;
}
