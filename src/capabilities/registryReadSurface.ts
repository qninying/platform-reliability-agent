// platform.agent_registry_read_surface, first release behaviour (R2):
// answers questions about any agent's registration, state, schedule and run history from ai_agents, the
// activity log and the timer inventory. Three facts are kept apart and never stand in for each other:
// "not registered" (no ai_agents row), "disabled" (a row with enabled false) and "no recorded runs" (a row
// with no runs). A name with no row gets no enabled state and no run count at all. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bb1d3c3):
// - The registry listing returns only names that have a row (services/aiOpsService.ts:239-255), and the
//   detail view looks agents up by id, never by name (:257-260), so a timer with no row is simply absent.
// - The listing's next run is computed from the row's own schedule field (:248-251), not from the timer that
//   fires, which can differ: a governance row overrides the timer (aiOpsScheduler.ts:647-652).
// - Dara's three timers count against one row (aiOpsScheduler.ts:367-375), so its run count is pooled.

import { GATES, type TimerRow } from './agentEnableDisableControl.ts';
import type { Citation } from './orchestrationHealthWatch.ts';

export interface RegistryRow {
  id: string;
  agent_name: string;
  enabled: boolean;
  status: string;
  schedule: string | null;
  run_count: number;
  error_count: number;
  last_run_at: string | null;
}
export interface ActivityRow { id: string; agent_id: string; result: string; created_at: string }
export interface GovernanceRow { agent_name: string; enabled: boolean; schedule: string | null }

export interface RegistrySnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: RegistryRow[];
  ai_agent_activity_logs: ActivityRow[];
  // The timer inventory (capability 13), and which files it covers, so "no timer" is said with its scope.
  timers: TimerRow[];
  timer_scope: string[];
  cron_schedule_configs: GovernanceRow[];
}

export interface LiveTimer { timer: string; schedule: string; ref: string; role: 'decides_the_run' | 'inner_gate'; governance: string | null }

export interface NotRegistered {
  name: string;
  registration: 'not_registered';
  facts: ['not registered'];
  enabled: null;
  runs: null;
  timers_with_this_name: Array<{ timer: string; schedule: string; ref: string; note: string }>;
  similar_registered_names: string[];
  statement: string;
  citations: Citation[];
}

export interface Registered {
  name: string;
  registration: 'registered';
  facts: string[];
  row_id: string;
  enabled: boolean;
  status: string;
  schedule: { declared: string | null; live: LiveTimer[]; notes: string[] };
  runs: {
    run_count: number;
    error_count: number;
    last_run_at: string | null;
    activity_rows: number;
    last_activity_at: string | null;
    attribution: 'this_agent' | 'pooled' | 'counted_under_another_row' | 'not_from_a_scheduled_timer';
    notes: string[];
  };
  statement: string;
  citations: Citation[];
}

export interface Ambiguous { name: string; registration: 'ambiguous'; facts: ['more than one row']; row_ids: string[]; statement: string; citations: Citation[] }

export type RegistryAnswer = NotRegistered | Registered | Ambiguous;

const byTime = (a: { created_at: string }, b: { created_at: string }) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);

function liveTimers(snap: RegistrySnapshot, name: string): LiveTimer[] {
  const gov = new Map(snap.cron_schedule_configs.map((g) => [g.agent_name, g]));
  return snap.timers
    .map((t) => ({ t, i: t.gates.findIndex((g) => g.flag === name) }))
    .filter(({ i }) => i !== -1)
    .sort((a, b) => (a.t.ref < b.t.ref ? -1 : 1))
    .map(({ t, i }) => {
      const g = gov.get(t.timer);
      const governance = !g ? null : !g.enabled ? 'turned off by its governance row' : g.schedule && g.schedule !== t.schedule ? `the governance row overrides it to ${g.schedule}` : null;
      return { timer: t.timer, schedule: g?.enabled && g.schedule ? g.schedule : t.schedule, ref: t.ref, role: i === 0 ? 'decides_the_run' : 'inner_gate', governance };
    });
}

export function askRegistry(snap: RegistrySnapshot, name: string): RegistryAnswer {
  const rows = snap.ai_agents.filter((a) => a.agent_name === name).sort((a, b) => (a.id < b.id ? -1 : 1));
  const scope = snap.timer_scope.join(', ');

  if (rows.length > 1) {
    return {
      name, registration: 'ambiguous', facts: ['more than one row'], row_ids: rows.map((r) => r.id),
      statement: `${name} has ${rows.length} ai_agents rows; agent_name should be unique, so no single answer can be given.`,
      citations: rows.map((r) => ({ table: 'ai_agents' as const, id: r.id, fields: ['agent_name'] })),
    };
  }

  if (rows.length === 0) {
    const named = snap.timers.filter((t) => t.timer === name).sort((a, b) => (a.ref < b.ref ? -1 : 1)).map((t) => {
      const first = t.gates[0];
      const note = !first || first.flag === null ? 'it checks no row'
        : first.flag !== name ? `it checks row ${first.flag}; ask about ${first.flag} for its state and runs`
        : `with no row, its wrapper ${GATES[first.gate].noRow}`;
      return { timer: t.timer, schedule: t.schedule, ref: t.ref, note };
    });
    const lower = name.toLowerCase();
    const similar = [...new Set(snap.ai_agents.map((a) => a.agent_name))]
      .filter((n) => n.toLowerCase() === lower || n.toLowerCase().startsWith(lower) || lower.startsWith(n.toLowerCase()))
      .sort();
    const timerText = named.length
      ? ` A timer by that name does exist: ${named.map((t) => `${t.timer} (${t.schedule}, ${t.ref}), ${t.note}`).join('; ')}.`
      : ` No timer by that name was found in ${scope}.`;
    return {
      name, registration: 'not_registered', facts: ['not registered'], enabled: null, runs: null,
      timers_with_this_name: named, similar_registered_names: similar,
      statement: `${name} is not registered: there is no ai_agents row for it. That is not the same as disabled, and not the same as zero runs; neither can be said without a row.${timerText}${similar.length ? ` Registered names that look similar: ${similar.join(', ')}.` : ''}`,
      citations: [],
    };
  }

  const row = rows[0];
  const live = liveTimers(snap, name);
  const deciding = live.filter((l) => l.role === 'decides_the_run');
  const scheduleNotes: string[] = [];
  if (live.length === 0) {
    scheduleNotes.push(row.schedule
      ? `no timer in ${scope} reads this row, so its declared schedule ${row.schedule} may never fire; the registry's next run for it is a prediction from that field`
      : `no timer in ${scope} reads this row`);
  } else if (row.schedule && deciding.length > 0 && deciding.every((l) => l.schedule !== row.schedule)) {
    scheduleNotes.push(`the declared schedule ${row.schedule} is not what fires: ${deciding.map((l) => `${l.timer} ${l.schedule}`).join('; ')}`);
  }
  for (const l of live) if (l.governance) scheduleNotes.push(`${l.timer}: ${l.governance}`);

  const activity = snap.ai_agent_activity_logs.filter((a) => a.agent_id === row.id).sort(byTime);
  const attribution: Registered['runs']['attribution'] = deciding.length > 1 ? 'pooled'
    : deciding.length === 0 && live.length > 0 ? 'counted_under_another_row'
    : live.length === 0 ? 'not_from_a_scheduled_timer' : 'this_agent';
  const runNotes: string[] = [];
  if (attribution === 'pooled') runNotes.push(`${deciding.length} timers count against this one row, so its runs cannot be told apart: ${deciding.map((l) => l.timer === name ? l.ref : l.timer).join(', ')}`);
  if (attribution === 'counted_under_another_row') runNotes.push('this row is only an inner gate: the timer that reads it counts its runs under an earlier row, so a run count of 0 here does not mean it never ran');

  const noRuns = row.run_count === 0 && activity.length === 0;
  const facts = [row.enabled ? 'enabled' : 'disabled', `status ${row.status}`];
  if (noRuns) facts.push(attribution === 'counted_under_another_row' ? 'no runs recorded on this row' : 'no recorded runs');
  const statement = `${name} is registered and ${row.enabled ? 'enabled' : 'disabled'} (status ${row.status}). `
    + (noRuns ? (attribution === 'counted_under_another_row' ? 'It has no runs recorded on its own row, because its timer counts runs under an earlier row.' : 'It has no recorded runs.')
      : `It has ${row.run_count} recorded run(s) and ${row.error_count} error(s)${row.last_run_at ? `, last at ${row.last_run_at}` : ''}.`)
    + (attribution === 'pooled' ? ' Those runs are pooled across several timers.' : '')
    + (scheduleNotes.length ? ` Schedule: ${scheduleNotes.join('; ')}.` : '');

  return {
    name, registration: 'registered', facts, row_id: row.id, enabled: row.enabled, status: row.status,
    schedule: { declared: row.schedule, live, notes: scheduleNotes },
    runs: { run_count: row.run_count, error_count: row.error_count, last_run_at: row.last_run_at, activity_rows: activity.length, last_activity_at: activity[0]?.created_at ?? null, attribution, notes: runNotes },
    statement,
    citations: [
      { table: 'ai_agents', id: row.id, fields: ['agent_name', 'enabled', 'status', 'schedule', 'run_count', 'error_count', 'last_run_at'] },
      ...activity.map((a) => ({ table: 'ai_agent_activity_logs' as const, id: a.id, fields: ['result', 'created_at'] })),
    ],
  };
}
