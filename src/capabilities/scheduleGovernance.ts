// platform.schedule_governance_live_reload, first release behaviour (R2):
// proposes schedule changes with the measured run cost and signal rate behind each, and says for each where
// the timer lives: in the aiOps registry the governance screen reloads live, inline in schedulerService.ts
// (restart only), both, or unknown. Applying a change stays a person's decision at every autonomy level;
// Ellis never holds the PATCH. Read-only.
//
// Platform behaviour this rests on (platform repo, commit c96f6a6):
// - The PATCH (routes/admin/governanceCenterRoutes.ts:151) updates an existing cron_schedule_configs row and
//   returns 404 when there is none (:156-159); it never creates one. It then reloads the registries and
//   reports applied.live (:42-62, :173). A reload failure degrades to live: false, never an error.
// - Without a row a registry timer runs its hardcoded schedule and is on: enabled = dbEntry?.enabled ?? true
//   (services/aiOpsScheduler.ts:649, and :750, :769 at boot).
// - The screen still says "Schedule changes take effect on next server restart"
//   (frontend/src/pages/admin/GovernanceCommandCenter.tsx:376), so the response's applied field is the
//   only place a person learns whether the change went live.
// - Inline timers never read cron_schedule_configs. One that runs through instrumentCronJob is skipped while
//   its ai_agents row is disabled (services/cronInstrumentation.ts:47-49); that is the enable/disable
//   control, not this screen.
// - instrumentCronJob writes one activity row per run, action = the name, with trace_id and duration_ms
//   (cronInstrumentation.ts:88-100); the run's AI calls carry the same trace id, with cost_usd (models/AiEvent.ts:72).

import { homeOf, type TimerIndex, type Home, type RegistryHome, type InlineSite } from '../inventory/timerHomes.ts';
import { parseCron, nextFire } from '../inventory/cronExpression.ts';

export interface AgentRow { id: string; agent_name: string; enabled: boolean }
export interface RunRow { id: string; agent_id: string; action: string; result: string; trace_id: string | null; duration_ms: number | null; created_at: string }
export interface EventRow { id: string; trace_id: string | null; cost_usd: number | null; created_at: string }
export interface ConfigRow { agent_name: string; active_schedule: string; default_schedule: string; enabled: boolean }
export interface GovernanceSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: AgentRow[];
  ai_agent_activity_logs: RunRow[];
  ai_events: EventRow[];
  cron_schedule_configs: ConfigRow[];
}
export const TABLES = ['ai_agents', 'ai_agent_activity_logs', 'ai_events', 'cron_schedule_configs'] as const;

export type Change = { schedule: string } | { enabled: false };
export interface Ask { target: string; change: Change }

export interface Evidence {
  window_days: number;
  runs: number | null;
  failed: number | null;
  runs_per_day: number | null;
  mean_duration_ms: number | null;
  ai_cost: { total_usd: number | null; per_run_usd: number | null; costed_calls: number; uncosted_calls: number };
  // Runs whose trace holds a record beyond the wrapper's own row. A lower bound: a run that writes only to its
  // own tables reads as no signal here.
  signal: { runs: number; rate: number | null; lower_bound: true } | null;
  fires_per_day: { current: number | null; proposed: number | null };
  projected_ai_cost_per_day_usd: number | null;
  row_ids: string[];
  blind_spots: string[];
}
export interface Proposal {
  target: string;
  change: Change;
  origin: 'asked' | 'sweep';
  why: string;
  home: Home;
  where: string[];
  governance_keys: string[];
  current: Array<{ key: string; schedule: string; enabled: boolean; from: 'governance row' | 'hardcoded' | 'code' }>;
  remedy: string;
  evidence: Evidence;
  decision: string;
}
export interface GovernanceAnswer { captured_at: string; source_commit: string | null; proposals: Proposal[]; statement: string }

const DAY = 86_400_000;
const DECISION = 'A person decides and applies this. Ellis proposes only; it never changes a live schedule.';
const PATCH = 'PATCH /api/admin/governance-center/schedules/';
// A sweep proposes pausing a job only on this many runs in the window, every one failed.
export const SWEEP_MIN_RUNS = 3;

export function firesPerDay(expr: string, from: Date, days = 7): number | null {
  const c = parseCron(expr);
  if (!c) return null;
  const end = from.getTime() + days * DAY;
  let n = 0;
  for (let t = nextFire(c, from); t && t.getTime() <= end; t = nextFire(c, t)) n++;
  return Math.round((n / days) * 100) / 100;
}

function current(home: { registry: RegistryHome[]; inline: InlineSite[] }, configs: ConfigRow[]): Proposal['current'] {
  const out: Proposal['current'] = [];
  for (const e of home.registry) {
    const row = configs.find((c) => c.agent_name === e.agentName);
    out.push({ key: e.agentName, schedule: row?.active_schedule || e.schedule, enabled: row?.enabled ?? true, from: row ? 'governance row' : 'hardcoded' });
  }
  for (const s of home.inline) out.push({ key: s.name, schedule: s.schedule ?? 'not a literal', enabled: true, from: 'code' });
  return out;
}

function remedy(home: Home, reg: RegistryHome[], inl: InlineSite[], configs: ConfigRow[], change: Change, hasRow: boolean): string {
  const at = (s: InlineSite) => `${s.file}:${s.line}`;
  const keys = [...new Set(reg.map((e) => e.agentName))];
  const missing = keys.filter((k) => !configs.some((c) => c.agent_name === k));
  const live = `Reloadable: a person applies it on /admin/governance (${PATCH}${keys.join(', ')}) and the reload makes it live without a restart. The screen still says a restart is needed; the response's applied.live says whether it went live.`;
  const noRow = missing.length
    ? ` No governance row exists for ${missing.join(', ')}, so the PATCH returns 404 and the timer runs its hardcoded schedule, on by default; a row must be created first, which is a production write.`
    : '';
  const disable = !('enabled' in change) ? '' : hasRow
    ? ' To stop it before a deploy, disabling its ai_agents row skips its runs (the enable/disable control, not this screen).'
    : ' It has no ai_agents row, so there is no row to disable either: stopping it takes a deploy.';
  const inline = `Restart only: registered inline at ${inl.map(at).join(', ')}, which the governance screen and the reload never reach. A schedule change is a code change and a deploy.${disable}`;
  if (home === 'aiops_registry') return live + noRow;
  if (home === 'inline') return inline;
  if (home === 'registry_and_inline') return `Partly reloadable. ${live}${noRow} But the inline timer keeps firing: ${inline}`;
  return 'Unknown home: no remedy is proposed until a person finds where this timer is registered.';
}

// proposed is a cron expression, 'off' for a proposal to switch the timer off, or null.
function evidence(s: GovernanceSnapshot, target: string, rows: string[], now: Date, windowDays: number, cur: string[], proposed: string | null): Evidence {
  const from = now.getTime() - windowDays * DAY;
  const agents = s.ai_agents.filter((a) => rows.includes(a.agent_name));
  const blind: string[] = [];
  const firesNow = cur.map((x) => firesPerDay(x, now));
  const fires = { current: !cur.length || firesNow.some((f) => f === null) ? null : firesNow.reduce<number>((a, f) => a + (f ?? 0), 0), proposed: proposed === null ? null : proposed === 'off' ? 0 : firesPerDay(proposed, now) };
  if (fires.current === null && cur.length) blind.push('a current schedule could not be read as a five-field cron');
  const empty: Evidence = { window_days: windowDays, runs: null, failed: null, runs_per_day: null, mean_duration_ms: null, ai_cost: { total_usd: null, per_run_usd: null, costed_calls: 0, uncosted_calls: 0 }, signal: null, fires_per_day: fires, projected_ai_cost_per_day_usd: null, row_ids: [], blind_spots: blind };
  if (!agents.length) {
    blind.push(`no ai_agents row named ${rows.join(' or ') || target}: its wrapper runs it untracked, so no run is recorded`);
    return empty;
  }
  const ids = new Set(agents.map((a) => a.id));
  const runs = s.ai_agent_activity_logs
    .filter((r) => ids.has(r.agent_id) && rows.includes(r.action) && Date.parse(r.created_at) > from && Date.parse(r.created_at) <= now.getTime())
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const traces = new Set(runs.map((r) => r.trace_id).filter((t): t is string => !!t));
  const calls = s.ai_events.filter((e) => e.trace_id && traces.has(e.trace_id));
  const costed = calls.filter((c) => c.cost_usd !== null && Number.isFinite(Number(c.cost_usd)));
  const total = costed.length ? Math.round(costed.reduce((a, c) => a + Number(c.cost_usd), 0) * 1e6) / 1e6 : null;
  const perRun = total !== null && runs.length ? Math.round((total / runs.length) * 1e6) / 1e6 : null;
  const signalled = runs.filter((r) => r.trace_id && (calls.some((c) => c.trace_id === r.trace_id) || s.ai_agent_activity_logs.some((o) => o.id !== r.id && o.trace_id === r.trace_id)));
  const durations = runs.map((r) => r.duration_ms).filter((d): d is number => d !== null);
  if (!runs.length) blind.push(`no run of ${rows.join(' or ')} recorded in the window; a job whose runs are recorded by trackAgentRun, runAgent or its own code writes no row Ellis reads as a run`);
  if (calls.length > costed.length) blind.push(`${calls.length - costed.length} AI call(s) recorded no cost (a streamed or failed call has none); cost is a lower bound`);
  if (runs.some((r) => !r.trace_id)) blind.push('some runs carry no trace id, so their AI calls and signal cannot be read');
  return {
    ...empty,
    runs: runs.length,
    failed: runs.filter((r) => r.result === 'failed').length,
    runs_per_day: Math.round((runs.length / windowDays) * 100) / 100,
    mean_duration_ms: durations.length ? Math.round(durations.reduce((a, d) => a + d, 0) / durations.length) : null,
    ai_cost: { total_usd: total, per_run_usd: perRun, costed_calls: costed.length, uncosted_calls: calls.length - costed.length },
    signal: runs.length ? { runs: signalled.length, rate: Math.round((signalled.length / runs.length) * 100) / 100, lower_bound: true } : null,
    projected_ai_cost_per_day_usd: perRun !== null && fires.proposed !== null ? Math.round(perRun * fires.proposed * 1e6) / 1e6 : null,
    row_ids: [...runs.map((r) => r.id), ...calls.map((c) => c.id)],
    blind_spots: blind,
  };
}

export function propose(ix: TimerIndex, s: GovernanceSnapshot, asks: Ask[], opts: { window_days?: number } = {}): GovernanceAnswer {
  const now = new Date(s.captured_at);
  const windowDays = opts.window_days ?? 7;
  const build = (target: string, change: Change, origin: Proposal['origin'], why: string): Proposal => {
    const h = homeOf(ix, target);
    const cur = current(h, s.cron_schedule_configs);
    const rows = [...new Set([target, ...h.registry.flatMap((e) => (e.row ? [e.row] : []))])];
    const proposed = 'schedule' in change ? change.schedule : 'off';
    const ev = evidence(s, target, rows, now, windowDays, cur.filter((c) => c.enabled).map((c) => c.schedule), proposed);
    if (h.home === 'unknown') ev.blind_spots.unshift(`home unknown: ${h.unknown_because}`);
    return {
      target, change, origin, why, home: h.home,
      where: [...h.registry.map((e) => `backend/src/services/aiOpsScheduler.ts:${e.line} (${e.registry})`), ...h.inline.map((x) => `${x.file}:${x.line}`)],
      governance_keys: [...new Set(h.registry.map((e) => e.agentName))],
      current: cur, remedy: remedy(h.home, h.registry, h.inline, s.cron_schedule_configs, change, s.ai_agents.some((a) => rows.includes(a.agent_name))), evidence: ev, decision: DECISION,
    };
  };
  const proposals = asks.map((a) => build(a.target, a.change, 'asked', 'asked by a person'));
  const asked = new Set(asks.map((a) => a.target));
  const from = now.getTime() - windowDays * DAY;
  for (const a of [...s.ai_agents].sort((x, y) => x.agent_name.localeCompare(y.agent_name))) {
    if (asked.has(a.agent_name) || !a.enabled) continue;
    const runs = s.ai_agent_activity_logs.filter((r) => r.agent_id === a.id && r.action === a.agent_name && Date.parse(r.created_at) > from && Date.parse(r.created_at) <= now.getTime());
    if (runs.length >= SWEEP_MIN_RUNS && runs.every((r) => r.result === 'failed')) {
      proposals.push(build(a.agent_name, { enabled: false }, 'sweep', `every one of its ${runs.length} runs in the last ${windowDays} days failed`));
    }
  }
  const unknown = proposals.filter((p) => p.home === 'unknown').length;
  const statement = proposals.length
    ? `${proposals.length} proposal(s); ${unknown} with an unknown home. ${DECISION}`
    : `Nothing to propose: no job asked about, and none failed every run in the last ${windowDays} days.`;
  return { captured_at: s.captured_at, source_commit: ix.source_commit, proposals, statement };
}
