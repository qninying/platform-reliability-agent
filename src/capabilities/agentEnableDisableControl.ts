// platform.agent_enable_disable_control, first release behaviour (R2):
// recommends a disable with the evidence that justifies it, and names every timer the disable would
// stop. Ellis never performs the disable: stopping a live timer is a human decision at every autonomy
// level. For a name with no ai_agents row, it says no disable flag exists rather than proposing one.
// Read-only.
//
// Platform behaviour this rests on (platform repo, commit a284987):
// - The control route sets ai_agents.status (pause, resume) or .enabled (enable, disable) on one row
//   (backend/src/services/aiOpsService.ts:291-313, routes/admin/aiOpsRoutes.ts:72).
// - A timer only stops if the wrapper it runs through reads that row, and the wrappers differ:
//   runAgent honours both flags (aiOrchestrator.ts:183-191), instrumentCronJob honours both and logs
//   'cron_job_skipped_disabled' (cronInstrumentation.ts:46-52), trackAgentRun ignores pause
//   (agentRunTracker.ts:33-36), the workforce director gate honours both inside the run
//   (workforce/workforceAgentRuntime.ts:66-73), and CampaignHealthScanner's own check ignores pause
//   (aiOrchestrator.ts:109-112).
// - The timer's name and the row its wrapper reads can differ (for example timer 'AdmissionsAssistant'
//   runs runAgent('AdmissionsAssistantAgent'), aiOrchestrator.ts:539-541), and one timer can be gated by
//   two rows (Dara's outer row and a director's inner row, aiOpsScheduler.ts:367 with
//   workforce/directorActions.ts:71). So the inventory lists, per timer, every row that can stop it.
// - A run that finishes writes status back to idle or error (aiOrchestrator.ts:234,
//   cronInstrumentation.ts:75), so a pause set during a run is undone when the run ends.

import type { Citation } from './orchestrationHealthWatch.ts';

export type Gate = 'run_agent' | 'instrument_cron_job' | 'track_agent_run' | 'director_gate' | 'own_check' | 'none' | 'unknown';

// What each wrapper does with the row's flags. null means it cannot be said from the records.
// noRow is what the wrapper does when the row it reads does not exist (aiOrchestrator.ts:177-181,
// cronInstrumentation.ts:34-38, agentRunTracker.ts:29-31, workforceAgentRuntime.ts:68, aiOrchestrator.ts:108).
// closingWrite is whether the wrapper writes the row's status back at the end of a run, which erases a pause
// set mid-run (aiOrchestrator.ts:234, cronInstrumentation.ts:75, aiOrchestrator.ts:124-125); trackAgentRun and
// the director gate never write status.
export const GATES: Record<Gate, { disable: boolean | null; pause: boolean | null; closingWrite: boolean | null; skip: string; noRow: string }> = {
  run_agent: { disable: true, pause: true, closingWrite: true, skip: 'a plain console line', noRow: 'returns without running, so this timer does nothing today' },
  instrument_cron_job: { disable: true, pause: true, closingWrite: true, skip: "a structured 'cron_job_skipped_disabled' line", noRow: 'runs it anyway, untracked' },
  track_agent_run: { disable: true, pause: false, closingWrite: false, skip: 'a plain console line', noRow: 'runs it anyway, untracked' },
  director_gate: { disable: true, pause: true, closingWrite: false, skip: 'a returned reason, with no log line', noRow: 'blocks every write as not registered' },
  own_check: { disable: true, pause: false, closingWrite: true, skip: 'a plain console line', noRow: 'runs it anyway, untracked' },
  none: { disable: false, pause: false, closingWrite: false, skip: 'nothing: the row is never read', noRow: 'never reads a row' },
  unknown: { disable: null, pause: null, closingWrite: null, skip: 'unknown', noRow: 'cannot be said' },
};

export interface TimerRow {
  timer: string;
  schedule: string;
  label: string;
  ref: string;
  // In the order a tick meets them: the first decides whether the run starts, later ones sit inside it.
  gates: Array<{ gate: Gate; flag: string | null }>;
}

export interface ControlAgentRow { id: string; agent_name: string; enabled: boolean; status: string }
export interface GovernanceRow { agent_name: string; enabled: boolean; schedule: string | null }
export interface Evidence { source: string; ref: string; summary: string }
export interface ControlRequest { agent_name: string; evidence: Evidence[] }

export interface ControlSnapshot {
  captured_at: string;
  captured_by: string;
  timers: TimerRow[];
  ai_agents: ControlAgentRow[];
  cron_schedule_configs: GovernanceRow[];
  requests: ControlRequest[];
}

export interface TimerEffect { timer: string; schedule: string; label: string; ref: string; effect: string }

export interface Recommendation {
  agent_name: string;
  decided_by: 'a named human';
  recommendation: 'disable' | 'none';
  statement: string;
  flag: { exists: true; row_id: string; enabled: boolean; status: string } | { exists: false };
  action: { method: 'POST'; path: string; body: { action: 'disable' }; performed_by: 'a person, never Ellis' } | null;
  would_stop: TimerEffect[];
  would_not_stop: TimerEffect[];
  governance: Array<{ timer: string; enabled: boolean; note: string }>;
  notes: string[];
  evidence: Evidence[];
  citations: Citation[];
}

export function recommendDisable(snap: ControlSnapshot, req: ControlRequest): Recommendation {
  const name = req.agent_name;
  const row = snap.ai_agents.filter((a) => a.agent_name === name).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const timers = [...snap.timers].sort((a, b) => (a.timer < b.timer ? -1 : a.timer > b.timer ? 1 : a.ref < b.ref ? -1 : 1));
  const evidence = [...req.evidence].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const notes: string[] = [];
  const would_stop: TimerEffect[] = [];
  const would_not_stop: TimerEffect[] = [];
  const view = (t: TimerRow, effect: string): TimerEffect => ({ timer: t.timer, schedule: t.schedule, label: t.label, ref: t.ref, effect });

  for (const t of timers) {
    const i = t.gates.findIndex((g) => g.flag === name);
    if (i === -1) {
      if (t.timer !== name) continue;
      const others = t.gates.filter((g) => g.flag !== null).map((g) => g.flag);
      would_not_stop.push(view(t, others.length ? `this timer is named ${name} but checks row ${others.join(' and ')}, not ${name}` : `this timer is named ${name} but checks no row at all`));
      continue;
    }
    const g = GATES[t.gates[i].gate];
    if (!row) would_not_stop.push(view(t, `there is no ${name} row to disable; finding none, the wrapper ${g.noRow}`));
    else if (g.disable === null) would_not_stop.push(view(t, `cannot say: how this timer's wrapper treats the row is not known`));
    else if (!g.disable) would_not_stop.push(view(t, 'the wrapper never reads the row'));
    else if (i === 0) would_stop.push(view(t, `the run stops; the skip shows as ${g.skip}`));
    else would_stop.push(view(t, `the timer still fires and an earlier row counts the run, but its writes are blocked; the skip shows as ${g.skip}`));
    if (row && g.disable && !g.pause) notes.push(`pause would not stop ${t.timer}: its wrapper only reads enabled, so disable, do not pause`);
  }
  if (row && would_stop.length > 0) notes.push('a pause set while a run is in progress is undone when that run finishes, so a pause cannot be relied on to contain a misbehaving agent');

  const governance = snap.cron_schedule_configs
    .filter((g) => would_stop.some((w) => w.timer === g.agent_name) || g.agent_name === name)
    .sort((a, b) => (a.agent_name < b.agent_name ? -1 : 1))
    .map((g) => ({ timer: g.agent_name, enabled: g.enabled, note: `a separate switch: turning this governance row off stops every registration of timer ${g.agent_name} itself` }));

  const base = { agent_name: name, decided_by: 'a named human' as const, would_stop, would_not_stop, governance, notes: [...new Set(notes)], evidence };

  if (!row) {
    return {
      ...base, recommendation: 'none', flag: { exists: false }, action: null, citations: [],
      statement: `No disable flag exists for ${name}: there is no ai_agents row for the flag to live on. Ellis does not propose creating one.`,
    };
  }
  const flag = { exists: true as const, row_id: row.id, enabled: row.enabled, status: row.status };
  const citations: Citation[] = [{ table: 'ai_agents', id: row.id, fields: ['agent_name', 'enabled', 'status'] }];
  if (!row.enabled) return { ...base, recommendation: 'none', flag, action: null, citations, statement: `${name} is already disabled; there is nothing to recommend.` };
  if (evidence.length === 0) return { ...base, recommendation: 'none', flag, action: null, citations, statement: `No evidence was given for disabling ${name}, so Ellis does not recommend it.` };
  const reach = would_stop.length === 0
    ? 'No scheduled timer checks this row, so disabling it stops nothing on a schedule.'
    : `Disabling it affects ${would_stop.length} timer(s): ${would_stop.map((w) => w.label).join('; ')}.`;
  return {
    ...base, recommendation: 'disable', flag, citations,
    action: { method: 'POST', path: `/api/admin/ai-ops/registry/${row.id}/control`, body: { action: 'disable' }, performed_by: 'a person, never Ellis' },
    statement: `Ellis recommends that a person disable ${name}, on ${evidence.length} piece(s) of evidence. ${reach}`,
  };
}

export function recommendAll(snap: ControlSnapshot): Recommendation[] {
  return [...snap.requests].sort((a, b) => (a.agent_name < b.agent_name ? -1 : 1)).map((r) => recommendDisable(snap, r));
}

// Which controls actually contain an agent. For every timer that reads the row, each control either stops the
// run, stops only the writes (an inner gate), holds only between runs (a pause the run's closing write
// erases), does not stop it, or cannot be said. Pause writes only status and leaves enabled true
// (aiOpsService.ts:296-297), so a wrapper that reads only enabled never sees it.

export type ControlEffect = 'stops' | 'stops_writes_only' | 'holds_only_between_runs' | 'does_not_stop' | 'unknown';
export type ContainmentAnswer = 'yes' | 'only_between_runs' | 'partly' | 'no' | 'unknown' | 'no_timers';

export interface TimerControl { timer: string; schedule: string; label: string; ref: string; disable: ControlEffect; pause: ControlEffect; why: string }

export interface Containment {
  agent_name: string;
  decided_by: 'a named human';
  row_exists: boolean;
  disable: ContainmentAnswer;
  pause: ContainmentAnswer;
  timers: TimerControl[];
  pause_inert: string[];
  governance: Recommendation['governance'];
  statement: string;
  citations: Citation[];
}

function effectFor(g: (typeof GATES)[Gate], control: 'disable' | 'pause', inner: boolean): ControlEffect {
  const reads = g[control];
  if (reads === null) return 'unknown';
  if (!reads) return 'does_not_stop';
  if (inner) return 'stops_writes_only';
  if (control === 'pause') return g.closingWrite === null ? 'unknown' : g.closingWrite ? 'holds_only_between_runs' : 'stops';
  return 'stops';
}

function summarise(effects: ControlEffect[]): ContainmentAnswer {
  if (effects.length === 0) return 'no_timers';
  if (effects.includes('unknown')) return 'unknown';
  const off = effects.filter((e) => e === 'does_not_stop').length;
  if (off === effects.length) return 'no';
  if (off > 0) return 'partly';
  return effects.includes('holds_only_between_runs') ? 'only_between_runs' : 'yes';
}

const ANSWER_TEXT: Record<ContainmentAnswer, string> = {
  yes: 'stops every timer that reads this row',
  only_between_runs: 'holds only between runs: a pause set during a run is undone when that run ends',
  partly: 'stops some of its timers and not others',
  no: 'stops none of its timers',
  unknown: 'cannot be said for every timer',
  no_timers: 'has nothing to stop: no scheduled timer reads this row',
};

export function containment(snap: ControlSnapshot, agentName: string): Containment {
  const row = snap.ai_agents.some((a) => a.agent_name === agentName);
  const timers: TimerControl[] = [];
  for (const t of [...snap.timers].sort((a, b) => (a.timer < b.timer ? -1 : a.timer > b.timer ? 1 : a.ref < b.ref ? -1 : 1))) {
    const i = t.gates.findIndex((g) => g.flag === agentName);
    if (i === -1) continue;
    const g = GATES[t.gates[i].gate];
    const base = { timer: t.timer, schedule: t.schedule, label: t.label, ref: t.ref };
    if (!row) {
      timers.push({ ...base, disable: 'does_not_stop', pause: 'does_not_stop', why: `there is no ${agentName} row to switch; finding none, the wrapper ${g.noRow}` });
      continue;
    }
    const disable = effectFor(g, 'disable', i > 0);
    const pause = effectFor(g, 'pause', i > 0);
    const why = pause === 'does_not_stop' && disable !== 'does_not_stop'
      ? 'its wrapper reads only enabled, and pause leaves enabled true'
      : pause === 'holds_only_between_runs' ? 'its wrapper writes the status back at the end of every run'
      : i > 0 ? 'an inner gate: the timer still fires and an earlier row counts the run, but the writes are blocked'
      : disable === 'unknown' ? 'how its wrapper treats the row is not known'
      : disable === 'does_not_stop' ? 'its wrapper never reads the row' : 'its wrapper checks both flags before running';
    timers.push({ ...base, disable, pause, why });
  }
  const disableAnswer = summarise(timers.map((t) => t.disable));
  const pauseAnswer = summarise(timers.map((t) => t.pause));
  const pause_inert = timers.filter((t) => t.pause === 'does_not_stop' && t.disable !== 'does_not_stop').map((t) => t.label);
  const governance = snap.cron_schedule_configs
    .filter((g) => timers.some((t) => t.timer === g.agent_name) || g.agent_name === agentName)
    .sort((a, b) => (a.agent_name < b.agent_name ? -1 : 1))
    .map((g) => ({ timer: g.agent_name, enabled: g.enabled, note: `a separate switch: turning this governance row off stops every registration of timer ${g.agent_name} itself` }));

  const use = disableAnswer === 'yes' && pauseAnswer !== 'yes' ? ' Use disable, not pause.' : '';
  const statement = !row
    ? `No control contains ${agentName}: there is no ai_agents row for disable or pause to act on.${governance.length ? ' Only the governance schedule row can stop its timer.' : ''}`
    : `For ${agentName}, disable ${ANSWER_TEXT[disableAnswer]}; pause ${ANSWER_TEXT[pauseAnswer]}.${pause_inert.length ? ` Pause does nothing for: ${pause_inert.join('; ')}.` : ''}${use}`;
  return {
    agent_name: agentName, decided_by: 'a named human', row_exists: row,
    disable: row ? disableAnswer : (timers.length ? 'no' : 'no_timers'),
    pause: row ? pauseAnswer : (timers.length ? 'no' : 'no_timers'),
    timers, pause_inert, governance, statement,
    citations: snap.ai_agents.filter((a) => a.agent_name === agentName).map((a) => ({ table: 'ai_agents' as const, id: a.id, fields: ['agent_name', 'enabled', 'status'] })),
  };
}

// Every registered row whose pause does not fully contain it, so an operator knows before reaching for it.
export function pauseGaps(snap: ControlSnapshot): Array<{ agent_name: string; pause: ContainmentAnswer; pause_inert: string[] }> {
  return [...new Set(snap.ai_agents.map((a) => a.agent_name))].sort()
    .map((n) => containment(snap, n))
    .filter((c) => c.pause !== 'yes' && c.pause !== 'no_timers')
    .map((c) => ({ agent_name: c.agent_name, pause: c.pause, pause_inert: c.pause_inert }));
}
