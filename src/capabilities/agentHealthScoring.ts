// platform.agent_health_scoring, first release behaviour (R2):
// reports each agent's health score the way the registry tab computes it, and states explicitly which scores
// rest on zero runs. A score derived from run_count 0 is labelled unscored, never 100; what a zero-run agent
// should score is K.D.'s decision, so Ellis does not invent a number for it. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 4443087):
// - healthScore = max(0, round(100 - (error_count / max(run_count, 1)) * 200 - (status 'error' ? 30 : 0)))
//   and error_rate = run_count > 0 ? error_count / run_count : 0 (services/aiOpsService.ts:466-484), from the
//   lifetime counters on the ai_agents row. With run_count 0 and error_count 0 that is 100.
// - The registry tab colours 80 and up green (AgentRegistryTab.tsx:67-71), shows 100 for any agent missing
//   from the health response (:241), and lists agents by category then name (aiOpsService.ts:245), not by score.
// - What moves the counters depends on the wrapper. runAgent adds to error_count but not run_count when the
//   agent throws (aiOrchestrator.ts:158-166, :300-306), so error_count can exceed run_count; instrumentCronJob
//   adds both and always writes status idle (cronInstrumentation.ts:68-81); trackAgentRun adds run_count on
//   success and failure and never touches error_count or status (agentRunTracker.ts:44-70); a director gate
//   records no run at all (workforceAgentRuntime.ts:66-69).

import type { Citation } from './orchestrationHealthWatch.ts';
import { GATES, type Gate, type TimerRow } from './agentEnableDisableControl.ts';

export interface ScoreRow {
  id: string;
  agent_name: string;
  enabled: boolean;
  status: string;
  run_count: number;
  error_count: number;
  category?: string | null;
}
export interface ScoreSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: ScoreRow[];
  timers: TimerRow[];
  timer_scope: string[];
}

export const PINNED_AT = 'aiOpsService.ts:466-484 at 4443087';
const FORMULA = /Math\.round\(100 - \(a\.error_count \/ Math\.max\(a\.run_count, 1\)\) \* 200 - \(a\.status === 'error' \? 30 : 0\)\)/;
const RATE = /const errorRate = a\.run_count > 0 \? a\.error_count \/ a\.run_count : 0;/;

// Confirms the live endpoint still computes the score this answer reproduces. A changed formula is an error,
// never a silent fall back to the pinned copy.
export function confirmLiveFormula(source: string): void {
  if (!FORMULA.test(source)) throw new Error('getAgentHealthScores no longer computes 100 - (error_count / max(run_count, 1)) * 200 - 30 on error; the scores this answer reproduces would be wrong');
  if (!RATE.test(source)) throw new Error('getAgentHealthScores no longer computes error_rate as error_count / run_count; the rates this answer reproduces would be wrong');
}

export const platformScore = (r: ScoreRow) => Math.max(0, Math.round(100 - (r.error_count / Math.max(r.run_count, 1)) * 200 - (r.status === 'error' ? 30 : 0)));
export const platformErrorRate = (r: ScoreRow) => (r.run_count > 0 ? Math.round((r.error_count / r.run_count) * 100) / 100 : 0);

export type ScoreState = 'scored' | 'unscored' | 'score_cannot_fall';
export interface AgentScore {
  name: string;
  row_id: string;
  category: string | null;
  enabled: boolean;
  status: string;
  run_count: number;
  error_count: number;
  // What the registry tab shows for this row today.
  platform_shows: { health_score: number; error_rate: number };
  state: ScoreState;
  // The platform's number where it means something; null when unscored or when it cannot fall.
  score: number | null;
  label: string;
  // Failures are on record although the score says nothing about them: triage these first.
  attention: boolean;
  wrappers: Gate[];
  timers: string[];
  notes: string[];
  citations: Citation[];
}
export interface NoRow { name: string; timers: string[]; statement: string }
export interface TriageEntry { name: string; row_id: string; why: string }
export interface FleetCounts {
  rows: number;
  scored: number;
  unscored: number;
  unscored_with_failures: number;
  score_cannot_fall: number;
  timers_with_no_row: number;
  platform_shows_100: number;
  platform_100_on_zero_runs: number;
  // getOverview's counts over the same rows (aiOpsService.ts:14-18).
  overview: { running: number; idle: number; paused: number; disabled: number; errored: number };
}
export interface ScoreAnswer {
  now: string;
  formula_source: string;
  triage: TriageEntry[];
  scored: AgentScore[];
  unscored: AgentScore[];
  score_cannot_fall: AgentScore[];
  no_row: NoRow[];
  fleet: FleetCounts;
  cannot_say: string[];
  statement: string;
}

interface Decider { ref: string; gate: Gate; schedule: string }

function assess(row: ScoreRow, ds: Decider[], scope: string[]): AgentScore {
  const shows = { health_score: platformScore(row), error_rate: platformErrorRate(row) };
  const gates = [...new Set(ds.map((d) => d.gate))].sort();
  const notes: string[] = [];
  let state: ScoreState = 'scored';
  let score: number | null = shows.health_score;
  let label = `scored ${shows.health_score}`;
  let attention = false;

  if (row.run_count === 0) {
    state = 'unscored';
    score = null;
    if (row.error_count > 0) {
      attention = true;
      label = `unscored: 0 runs counted, but ${row.error_count} failure(s) recorded`;
      notes.push(`every recorded attempt failed before it counted as a run: a thrown failure adds to error_count but not run_count (aiOrchestrator.ts:158-166, :300-306); the registry tab shows ${shows.health_score} with error rate ${shows.error_rate}`);
    } else {
      label = 'unscored: no run recorded';
      notes.push(`no run has been counted, so there is nothing to score; the registry tab shows ${shows.health_score}${shows.health_score >= 80 ? ', in green,' : ''} as if the agent were flawless`);
      if (row.status === 'error') attention = true;
    }
    if (gates.length === 1 && gates[0] === 'director_gate') notes.push(`its timer runs through a director gate that records no run (workforceAgentRuntime.ts:66-69), so run_count stays 0 however often it runs`);
    if (gates.length > 0 && gates.every((g) => g === 'track_agent_run')) notes.push('once it runs it still cannot fall: trackAgentRun counts a failed run as a run and never adds to error_count or sets status (agentRunTracker.ts:58-70)');
  } else if (row.error_count === 0 && gates.length > 0 && gates.every((g) => g === 'track_agent_run')) {
    state = 'score_cannot_fall';
    score = null;
    label = 'not scored: this agent\'s failures never reach the counters';
    notes.push(`trackAgentRun counts a failed run as a run and never adds to error_count or sets status (agentRunTracker.ts:58-70), so the registry tab shows ${shows.health_score} whether it succeeds or fails`);
  } else {
    if (row.error_count > row.run_count) notes.push(`error_count (${row.error_count}) exceeds run_count (${row.run_count}): thrown failures are counted as errors but not as runs (aiOrchestrator.ts:158-166, :300-306), so the error rate of ${shows.error_rate} is not a share of runs`);
    if (shows.health_score === 0) notes.push(`the score floors at 0 once errors reach half the run count (35% with status error), so agents in this band are ranked here by error rate, not by score`);
    if (row.error_count > 0 && gates.includes('instrument_cron_job')) notes.push(`instrumentCronJob always writes status idle (cronInstrumentation.ts:74), so this agent never takes the 30-point error penalty a runAgent agent would`);
  }
  if (ds.length === 0) notes.push(`no timer in ${scope.join(', ')} records under this row; a timer outside that scope, an event or a manual run may`);
  const schedules = [...new Set(ds.map((d) => d.schedule))];
  if (schedules.length > 1) notes.push(`${ds.length} timers on ${schedules.length} different schedules (${ds.map((d) => `${d.ref} ${d.schedule}`).join('; ')}) share this one row, so this is one score for all of them`);
  if (gates.includes('unknown')) notes.push('what one of its timers records per run is not known to Ellis');

  return {
    name: row.agent_name, row_id: row.id, category: row.category ?? null, enabled: row.enabled, status: row.status,
    run_count: row.run_count, error_count: row.error_count, platform_shows: shows, state, score, label, attention,
    wrappers: gates, timers: ds.map((d) => d.ref).sort(), notes,
    citations: [{ table: 'ai_agents', id: row.id, fields: ['run_count', 'error_count', 'status'] }],
  };
}

const byName = <T extends { name: string; row_id?: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.row_id ?? '') < (b.row_id ?? '') ? -1 : 1);
const rate = (a: AgentScore) => (a.run_count > 0 ? a.error_count / a.run_count : Infinity);

// Worst first: failures on record behind no score, then scored agents from the lowest score, ties broken by
// the higher error rate. Agents with no failures and no score are not ranked: there is nothing to rank them by.
function triage(all: AgentScore[]): TriageEntry[] {
  const flagged = all.filter((a) => a.state !== 'scored' && a.attention).sort((a, b) => b.error_count - a.error_count || byName(a, b));
  const scored = all.filter((a) => a.state === 'scored').sort((a, b) => a.score! - b.score! || rate(b) - rate(a) || b.error_count - a.error_count || byName(a, b));
  return [
    ...flagged.map((a) => ({ name: a.name, row_id: a.row_id, why: a.label })),
    ...scored.map((a) => ({ name: a.name, row_id: a.row_id, why: `score ${a.score}, ${a.error_count} error(s) over ${a.run_count} run(s)` })),
  ];
}

export function agentHealth(snap: ScoreSnapshot, source = PINNED_AT): ScoreAnswer {
  const rowNames = new Set(snap.ai_agents.map((a) => a.agent_name));
  const deciders = new Map<string, Decider[]>();
  const noRowTimers = new Map<string, Decider[]>();
  for (const tm of snap.timers) {
    const first = tm.gates[0];
    if (!first || first.flag === null) continue;
    const map = rowNames.has(first.flag) ? deciders : noRowTimers;
    map.set(first.flag, [...(map.get(first.flag) ?? []), { ref: tm.ref, gate: first.gate, schedule: tm.schedule }]);
  }
  const all = snap.ai_agents.map((r) => assess(r, (deciders.get(r.agent_name) ?? []).sort((a, b) => (a.ref < b.ref ? -1 : 1)), snap.timer_scope));
  const noRow: NoRow[] = [...noRowTimers].map(([name, ds]) => {
    const timers = ds.map((d) => d.ref).sort();
    return { name, timers, statement: `${name}: no score at all, because no ai_agents row carries this name and the score is read only from rows (aiOpsService.ts:466-467); with no row its wrapper ${[...new Set(ds.map((d) => GATES[d.gate].noRow))].join('; ')}. Timer: ${timers.join(', ')}.` };
  }).sort(byName);

  const scored = all.filter((a) => a.state === 'scored').sort(byName);
  const unscored = all.filter((a) => a.state === 'unscored').sort(byName);
  const cannotFall = all.filter((a) => a.state === 'score_cannot_fall').sort(byName);
  const rows = snap.ai_agents;
  const fleet: FleetCounts = {
    rows: rows.length, scored: scored.length, unscored: unscored.length,
    unscored_with_failures: unscored.filter((a) => a.attention).length, score_cannot_fall: cannotFall.length,
    timers_with_no_row: noRow.length,
    platform_shows_100: all.filter((a) => a.platform_shows.health_score === 100).length,
    platform_100_on_zero_runs: unscored.filter((a) => a.platform_shows.health_score === 100).length,
    overview: {
      running: rows.filter((a) => a.status === 'running').length,
      idle: rows.filter((a) => a.status === 'idle' && a.enabled).length,
      paused: rows.filter((a) => a.status === 'paused').length,
      disabled: rows.filter((a) => !a.enabled).length,
      errored: rows.filter((a) => a.status === 'error').length,
    },
  };
  const cannot = [
    'how an agent is doing now: run_count and error_count are lifetime totals, so an old failure streak keeps a recovered agent low and a new one barely moves a long-running agent',
    'whether a score of 100 after a repair reflects a run: the planner\'s default repair sets error_count to 0 and status idle without running the agent (ActionPlannerAgent.ts:43, ExecutionAgent.ts:45-48)',
    `agents outside ${snap.timer_scope.join(', ')}: a timer elsewhere with no row would not be listed here`,
  ];
  const statement = `${fleet.scored} of ${fleet.rows} agents scored, ${fleet.unscored} unscored because no run has been counted`
    + (fleet.unscored_with_failures ? ` (${fleet.unscored_with_failures} of them with failures on record)` : '')
    + `, ${fleet.score_cannot_fall} whose failures never reach the score, and ${fleet.timers_with_no_row} timer(s) with no row and so no score.`
    + ` The registry tab shows 100 for ${fleet.platform_shows_100} agents; ${fleet.platform_100_on_zero_runs} of those rest on zero runs.`
    + ` Formula from ${source}.`;
  return { now: snap.captured_at, formula_source: source, triage: triage(all), scored, unscored, score_cannot_fall: cannotFall, no_row: noRow, fleet, cannot_say: cannot, statement };
}
