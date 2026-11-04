// platform.agent_registry_read_surface, extended with a preview of the registry's "discover" action (A.M.,
// 2026-11-04: agent discovery sync folds into the registry read surface). Answers "if a person presses discover,
// which rows would be created, does each arrive enabled, and which timers would that switch on?" before anything
// is written. Pressing it stays a human decision at every autonomy level: Ellis never calls the route.
//
// Platform behaviour this rests on (platform repo, commit cc1ebc5):
// - POST /api/admin/ai-ops/discover (routes/admin/aiOpsRoutes.ts:81) runs scanAndDiscoverAgents
//   (services/aiOpsService.ts:451-464): it counts rows, re-runs the seed, counts again, and reports
//   new_agents as the difference, floored at zero.
// - The seed finds or creates one row per AGENT_REGISTRY entry by agent_name (agentRegistrySeed.ts:3291-3296),
//   so it discovers from the seed, never from the running timers. A created row takes the entry's own enabled,
//   and the column defaults to true (models/AiAgent.ts:423-427). Existing rows get their schedule, category,
//   prompt and tools rewritten from the seed (:3310-3327).
// - After the loop, ContentOptimizationAgent is forced off (:3342-3345) and every retired agent is held off
//   (enforceRetiredAgents, :3276-3289, called at :3349, list at :3253-3264).
// - The same seed runs whenever the AI Ops scheduler starts (aiOpsScheduler.ts:715), so on a platform whose scheduler
//   started, discover usually creates nothing; it matters when that start never happened, or for entries added since.

import type { Citation } from './orchestrationHealthWatch.ts';
import { GATES, type ControlAgentRow, type TimerRow } from './agentEnableDisableControl.ts';
import type { RegistrySnapshot } from './registryReadSurface.ts';

export const PINNED_AT = 'cc1ebc5';
export const FORCED_OFF: Record<string, string> = {
  ContentOptimizationAgent: 'forced off after seeding (agentRegistrySeed.ts:3342-3345)',
  StudentProgressMonitor: 'retired, held off after seeding (agentRegistrySeed.ts:3253-3264)',
  CompanyStrategicCycle: 'retired, held off after seeding (agentRegistrySeed.ts:3253-3264)',
};

export interface TimerChange { timer: string; ref: string; change: string }
export interface WouldCreate { agent_name: string; arrives_enabled: boolean; why: string; timers: TimerChange[] }

export interface DiscoveryPreview {
  pinned_at: string;
  decided_by: 'a named human';
  would_create: WouldCreate[];
  // Existing rows the seed would rewrite (schedule, category, prompt, tools); not compared field by field yet.
  would_rewrite: number;
  // Rows the seed does not know: discovery leaves them alone, and never finds them.
  not_in_seed: string[];
  // Timers whose row is in neither the registry nor the seed: no discovery run will ever register them.
  never_discovered: Array<{ timer: string; ref: string; row: string }>;
  predicted_new_agents: number;
  statement: string;
  cannot_see: string[];
  citations: Citation[];
}

function timerChange(gate: keyof typeof GATES, enabled: boolean): string {
  if (gate === 'run_agent' || gate === 'director_gate') {
    return enabled ? 'does nothing today (no row); once the row exists and is enabled, it starts running' : 'does nothing today, and stays off: the new row arrives disabled';
  }
  if (gate === 'instrument_cron_job' || gate === 'track_agent_run' || gate === 'own_check') {
    return enabled ? 'runs today untracked; it keeps running, now tracked, and disable and pause start to reach it' : 'runs today untracked; the new row arrives disabled, so it is skipped from then on';
  }
  if (gate === 'none') return 'its wrapper never reads the row: no change';
  return 'how its wrapper treats the row is not known';
}

// The timer inventory read from source: the seed's entries (ids start "seed:") and the timers it found.
export interface SeedInventory { ai_agents: ControlAgentRow[]; timers: TimerRow[] }

export function previewDiscovery(snap: RegistrySnapshot, seed: SeedInventory): DiscoveryPreview {
  const entries = seed.ai_agents.filter((r) => r.id.startsWith('seed:'));
  const seedNames = new Set(entries.map((r) => r.agent_name));
  const rowNames = new Set(snap.ai_agents.map((r) => r.agent_name));
  const timers = [...new Map([...snap.timers, ...seed.timers].map((t) => [`${t.timer}@${t.ref}`, t])).values()].sort((a, b) => (a.timer < b.timer ? -1 : a.timer > b.timer ? 1 : a.ref < b.ref ? -1 : 1));

  const would_create: WouldCreate[] = [...new Map(entries.filter((e) => !rowNames.has(e.agent_name)).map((e) => [e.agent_name, e])).values()]
    .sort((a, b) => (a.agent_name < b.agent_name ? -1 : 1))
    .map((e) => {
      const forced = FORCED_OFF[e.agent_name];
      const arrives_enabled = e.enabled && !forced;
      const why = forced ?? (e.enabled ? 'the seed sets no enabled: false, and the column defaults to true' : 'the seed entry is disabled');
      const reading = timers.filter((t) => t.gates[0]?.flag === e.agent_name);
      return { agent_name: e.agent_name, arrives_enabled, why, timers: reading.map((t) => ({ timer: t.timer, ref: t.ref, change: timerChange(t.gates[0].gate, arrives_enabled) })) };
    });

  const not_in_seed = [...rowNames].filter((n) => !seedNames.has(n)).sort();
  const never_discovered = timers
    .filter((t) => t.gates[0]?.flag && !rowNames.has(t.gates[0].flag) && !seedNames.has(t.gates[0].flag))
    .map((t) => ({ timer: t.timer, ref: t.ref, row: t.gates[0].flag! }));
  const enabledNew = would_create.filter((w) => w.arrives_enabled);
  const started = enabledNew.flatMap((w) => w.timers.filter((t) => /starts running/.test(t.change)));

  const statement = would_create.length === 0
    ? `Discover would create no row: every seed entry already has one. It would rewrite ${rowNames.size - not_in_seed.length} existing row(s) from the seed.`
    : `Discover would create ${would_create.length} row(s), ${enabledNew.length} arriving enabled${started.length ? `, which would start ${started.length} timer(s) that do nothing today` : ''}. A person decides; Ellis does not press it.`;
  return {
    pinned_at: PINNED_AT, decided_by: 'a named human',
    would_create, would_rewrite: rowNames.size - not_in_seed.length, not_in_seed, never_discovered,
    predicted_new_agents: would_create.length,
    statement: never_discovered.length ? `${statement} ${never_discovered.length} timer(s) have no row and no seed entry, so no discovery run will ever register them.` : statement,
    cannot_see: [
      'The platform reports new_agents as a change in the table\'s row count, so a row created or deleted by anything else during the run changes the figure',
      'Existing rows are rewritten from the seed, but Ellis does not yet compare the fields it would change',
      'enabled is as seeded in code; a row created in production outside the seed is not known to it',
    ],
    citations: [...snap.ai_agents].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => ({ table: 'ai_agents' as const, id: r.id, fields: ['agent_name', 'enabled'] })),
  };
}
