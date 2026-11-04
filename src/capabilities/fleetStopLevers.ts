// platform.agent_enable_disable_control, extended with the fleet-wide levers (A.M., 2026-11-04: emergency stop
// and kill switch fold into enable/disable control). Answers "to halt the fleet, which lever reaches what, and
// what does resuming undo?" Recommends only: pulling any lever is a human decision at every autonomy level, and
// Ellis never calls these routes.
//
// Platform behaviour this rests on (platform repo, commit cc1ebc5):
// - Emergency stop, at both routes (routes/admin/aiOpsRoutes.ts:90, routes/admin/agentGovernanceRoutes.ts:31),
//   sets enabled false and status 'paused' on every enabled ai_agents row (agentPermissionService.ts:366-375).
//   It is a disable of every row at once, so it reaches exactly the timers a per-agent disable reaches.
// - Emergency resume (aiOpsRoutes.ts:110, agentGovernanceRoutes.ts:32) re-enables every row that is disabled
//   with status 'paused', and sets it idle (agentPermissionService.ts:380-395). It cannot tell a row the stop
//   disabled from one a person disabled and paused before it, and it clears a person's earlier pause.
// - Scheduler pause (routes/admin/schedulerControlRoutes.ts:12) only writes system_settings.scheduler_paused
//   (controllers/adminSchedulerController.ts:11-14). No timer reads it. The send check refuses a send while it
//   is set, and lets the send through when the flag cannot be read (communicationSafetyService.ts:298-310).
// - Kill switch (aiOpsRoutes.ts:124) sets system_kill_switch, pauses every active campaign, and disables the
//   enabled rows whose category is outbound (launchSafety.ts:155-188, categories at :116-119). The send check
//   refuses every send while it is on (communicationSafetyService.ts:294). Turning it off re-enables nothing
//   (launchSafety.ts:194-202).

import type { Citation } from './orchestrationHealthWatch.ts';
import { GATES, type ControlSnapshot, type TimerRow } from './agentEnableDisableControl.ts';

export const PINNED_AT = 'cc1ebc5';
export const OUTBOUND_CATEGORIES = ['email', 'sms', 'voice', 'outbound', 'messaging', 'admissions_email', 'admissions_sms', 'admissions_voice'];

export type Lever = 'agent_disable' | 'emergency_stop' | 'kill_switch' | 'scheduler_pause' | 'governance_row';
export type Reach = 'stops_the_run' | 'stops_writes_only' | 'blocks_sends_only' | 'does_not_reach' | 'unknown';

export interface LeverEffect { lever: Lever; reach: Reach; why: string }
export interface TimerLevers { timer: string; ref: string; row: string | null; levers: LeverEffect[]; stopped_by: Lever[]; statement: string }

const SEND_CHECK = 'communicationSafetyService.ts:288-310';
const sendsOnly = (lever: 'kill_switch' | 'scheduler_pause'): LeverEffect => ({
  lever, reach: 'blocks_sends_only',
  why: lever === 'scheduler_pause'
    ? `no timer reads scheduler_paused; it only refuses sends that pass the send check (${SEND_CHECK}), and lets them through when the flag cannot be read`
    : `the job still runs; sends that pass the send check (${SEND_CHECK}) are refused`,
});

// What each fleet lever does to one timer. Only a lever that stops the run counts as stopping it.
export function leversForTimer(snap: ControlSnapshot, t: TimerRow): TimerLevers {
  const first = t.gates[0];
  const name = first?.flag ?? null;
  const row = name === null ? undefined : snap.ai_agents.find((a) => a.agent_name === name);
  const g = GATES[first?.gate ?? 'unknown'];
  const levers: LeverEffect[] = [];
  const registry = (lever: 'agent_disable' | 'emergency_stop'): LeverEffect => {
    if (name === null || g.disable === false) return { lever, reach: 'does_not_reach', why: 'its wrapper never reads a row' };
    if (g.disable === null) return { lever, reach: 'unknown', why: 'how its wrapper treats the row is not known' };
    if (!row) return { lever, reach: 'does_not_reach', why: `there is no ${name} row; finding none, the wrapper ${g.noRow}` };
    if (!row.enabled) return { lever, reach: 'does_not_reach', why: `row ${name} is already disabled` };
    return { lever, reach: 'stops_the_run', why: `its wrapper reads row ${name} before running` };
  };
  levers.push(registry('agent_disable'), registry('emergency_stop'));
  const outbound = row && row.enabled && OUTBOUND_CATEGORIES.includes(row.category ?? '') && g.disable === true;
  levers.push(outbound
    ? { lever: 'kill_switch', reach: 'stops_the_run', why: `row ${name} is in an outbound category (${row!.category}), so the kill switch disables it` }
    : sendsOnly('kill_switch'));
  levers.push(sendsOnly('scheduler_pause'));
  const gov = snap.cron_schedule_configs.find((c) => c.agent_name === t.timer);
  if (gov) levers.push({ lever: 'governance_row', reach: 'stops_the_run', why: `turning governance row ${t.timer} off stops every registration of this timer` });
  const stopped_by = levers.filter((l) => l.reach === 'stops_the_run').map((l) => l.lever);
  const statement = stopped_by.length > 0
    ? `${t.timer} stops with: ${stopped_by.join(', ')}. Scheduler pause does not stop it; it only blocks sends.`
    : `No lever stops ${t.timer} from running. The kill switch and the scheduler pause only block its sends; stopping the job itself needs a row, a governance row or a code change.`;
  return { timer: t.timer, ref: t.ref, row: row ? row.id : null, levers, stopped_by, statement };
}

export interface ResumeEffect { agent_name: string; row_id: string; before: { enabled: boolean; status: string }; after_resume: string }

export interface FleetStopAnswer {
  pinned_at: string;
  decided_by: 'a named human';
  // already_off: the row is disabled before the stop, so the timer is not running for the stop to reach.
  emergency_stop: { rows_disabled: number; timers_stopped: string[]; already_off: string[]; timers_not_reached: Array<{ timer: string; why: string }> };
  kill_switch: { rows_disabled: number; also: string };
  scheduler_pause: { timers_stopped: []; also: string };
  // Rows the next emergency resume would change in a way a person did not ask for.
  resume_undoes: ResumeEffect[];
  statement: string;
  citations: Citation[];
}

export function fleetStop(snap: ControlSnapshot): FleetStopAnswer {
  const timers = [...snap.timers].sort((a, b) => (a.timer < b.timer ? -1 : a.timer > b.timer ? 1 : a.ref < b.ref ? -1 : 1));
  const each = timers.map((t) => ({ t, l: leversForTimer(snap, t) }));
  const stopReach = (x: { l: TimerLevers }) => x.l.levers.find((e) => e.lever === 'emergency_stop')!;
  const timers_stopped = each.filter((x) => stopReach(x).reach === 'stops_the_run').map((x) => x.t.timer);
  const off = (x: { l: TimerLevers }) => / is already disabled$/.test(stopReach(x).why);
  const already_off = each.filter((x) => off(x)).map((x) => x.t.timer);
  const timers_not_reached = each.filter((x) => stopReach(x).reach !== 'stops_the_run' && !off(x)).map((x) => ({ timer: x.t.timer, why: stopReach(x).why }));
  const rows = [...snap.ai_agents].sort((a, b) => (a.agent_name < b.agent_name ? -1 : a.agent_name > b.agent_name ? 1 : a.id < b.id ? -1 : 1));
  const resume_undoes: ResumeEffect[] = [];
  for (const r of rows) {
    if (!r.enabled && r.status === 'paused') resume_undoes.push({ agent_name: r.agent_name, row_id: r.id, before: { enabled: r.enabled, status: r.status }, after_resume: 'a person disabled and paused it; resume re-enables it and sets it idle' });
    else if (r.enabled && r.status === 'paused') resume_undoes.push({ agent_name: r.agent_name, row_id: r.id, before: { enabled: r.enabled, status: r.status }, after_resume: 'a person paused it; stop then resume leaves it enabled and idle, so the pause is lost' });
  }
  const enabled = rows.filter((r) => r.enabled);
  const killRows = enabled.filter((r) => OUTBOUND_CATEGORIES.includes(r.category ?? '')).length;
  const statement = `Emergency stop would disable ${enabled.length} row(s) and stop ${timers_stopped.length} of ${timers.length} timer(s); ${already_off.length} are already off and ${timers_not_reached.length} keep running. `
    + 'Scheduler pause stops no timer, only sends. '
    + (resume_undoes.length ? `The next emergency resume would undo a person's choice on ${resume_undoes.length} row(s): resume them by name, not all at once.` : 'No row is paused today, so a resume would undo no earlier choice.');
  return {
    pinned_at: PINNED_AT, decided_by: 'a named human',
    emergency_stop: { rows_disabled: enabled.length, timers_stopped, already_off, timers_not_reached },
    kill_switch: { rows_disabled: killRows, also: 'pauses every active campaign and refuses every send at the send check; turning it off re-enables nothing' },
    scheduler_pause: { timers_stopped: [], also: 'refuses sends at the send check while set, and lets them through when the flag cannot be read' },
    resume_undoes,
    statement,
    citations: rows.map((r) => ({ table: 'ai_agents' as const, id: r.id, fields: ['agent_name', 'enabled', 'status', 'category'] })),
  };
}
