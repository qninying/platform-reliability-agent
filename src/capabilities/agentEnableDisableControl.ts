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
export const GATES: Record<Gate, { disable: boolean | null; pause: boolean | null; skip: string; noRow: string }> = {
  run_agent: { disable: true, pause: true, skip: 'a plain console line', noRow: 'returns without running, so this timer does nothing today' },
  instrument_cron_job: { disable: true, pause: true, skip: "a structured 'cron_job_skipped_disabled' line", noRow: 'runs it anyway, untracked' },
  track_agent_run: { disable: true, pause: false, skip: 'a plain console line', noRow: 'runs it anyway, untracked' },
  director_gate: { disable: true, pause: true, skip: 'a returned reason, with no log line', noRow: 'blocks every write as not registered' },
  own_check: { disable: true, pause: false, skip: 'a plain console line', noRow: 'runs it anyway, untracked' },
  none: { disable: false, pause: false, skip: 'nothing: the row is never read', noRow: 'never reads a row' },
  unknown: { disable: null, pause: null, skip: 'unknown', noRow: 'cannot be said' },
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
