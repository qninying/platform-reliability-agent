// platform.workforce_technology_direction, first release behaviour (R2):
// answers "what tooling does the fleet hold, and where does it diverge from the intended direction?"
// from registry records. Divergence is only reported against a written, approved direction; with none on
// file the answer is unknown, never "no divergence". Setting the direction is a human decision at every
// autonomy level, and a model class change is an escalation, never a director action. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 7c70f0a):
// - The WorkforceTechnologyDirector timer does not assess direction. It flags the one enabled agent with the
//   highest lifetime error_count as a WorkforceTask (workforce/directorActions.ts:80-114).
// - Tooling is recorded in two places: ai_agents.tools_granted, which defaults to [] (models/AiAgent.ts:480-484),
//   so an empty list means never filled in; and the grant map in code, where an agent not listed gets a
//   default suggest_only grant (agentPermissionService.ts:39-108). The map is not enforced, so its tier is
//   what is declared, not what the agent can do.
// - No agent records the model it uses; models are chosen in code, so model use comes from a code export.

import type { Citation } from './orchestrationHealthWatch.ts';

export type Tier = 'read_only' | 'suggest_only' | 'write_with_audit' | 'communication';
const TIER_RANK: Record<Tier, number> = { read_only: 0, suggest_only: 1, write_with_audit: 2, communication: 3 };

export type Rule =
  | { kind: 'allowed_tools'; tools: string[] }
  | { kind: 'denied_tools'; tools: string[] }
  | { kind: 'max_tier'; tier: Tier }
  | { kind: 'allowed_models'; models: string[] };

export interface Direction { id: string; written_by: string; approved_by: string | null; approved_at: string | null; rules: Rule[] }
export interface RegistryAgent { id: string; agent_name: string; enabled: boolean; tools_granted: string[] | null }
export interface GrantEntry { agent_name: string; tier: Tier; allowed_tables: string[]; allowed_operations: string[] }
export interface ModelUse { model: string; ref: string }

export interface DirectionSnapshot {
  captured_at: string;
  captured_by: string;
  direction: Direction | null;
  ai_agents: RegistryAgent[];
  grant_map: GrantEntry[];
  // null when no export of model use in code was taken.
  model_uses: ModelUse[] | null;
}

export interface Divergence { rule: Rule['kind']; detail: string; escalation: boolean }

export interface AgentView {
  agent_name: string;
  tools: string[] | null;
  tier: Tier;
  tier_source: 'grant_map' | 'default';
  state: 'diverges' | 'within' | 'not_recorded' | 'not_assessed';
  divergences: Divergence[];
}

export type DirectionState = 'on_file' | 'none' | 'unapproved' | 'empty';

export interface DirectionReport {
  decided_by: 'a named human';
  direction: { state: DirectionState; id: string | null; reason: string };
  verdict: 'divergent' | 'no_divergence' | 'unknown';
  statement: string;
  coverage: { enabled_agents: number; tools_recorded: number; in_grant_map: number };
  agents: AgentView[];
  fleet: { models: string[] | null; divergences: Divergence[] };
  escalations: string[];
  citations: Citation[];
}

const byName = <T extends { agent_name: string }>(a: T, b: T) => (a.agent_name < b.agent_name ? -1 : a.agent_name > b.agent_name ? 1 : 0);
const sorted = (xs: string[]) => [...new Set(xs)].sort();

function directionState(d: Direction | null, capturedAt: string): { state: DirectionState; reason: string } {
  if (!d) return { state: 'none', reason: 'no written technology direction is on file' };
  const approvedAt = d.approved_at ? Date.parse(d.approved_at) : NaN;
  if (!d.approved_by || Number.isNaN(approvedAt)) return { state: 'unapproved', reason: `direction ${d.id} is written but has no recorded approval` };
  if (approvedAt > Date.parse(capturedAt)) return { state: 'unapproved', reason: `direction ${d.id} is dated after the snapshot, so its approval cannot be trusted` };
  if (d.rules.length === 0) return { state: 'empty', reason: `direction ${d.id} states no rules, so there is nothing to diverge from` };
  return { state: 'on_file', reason: `direction ${d.id}, approved by ${d.approved_by}` };
}

function assessAgent(a: RegistryAgent, grant: GrantEntry | undefined, rules: Rule[] | null): AgentView {
  // The column defaults to [], so an empty list is a list nobody filled in, not an agent with no tools.
  const tools = a.tools_granted && a.tools_granted.length > 0 ? sorted(a.tools_granted) : null;
  const tier: Tier = grant ? grant.tier : 'suggest_only';
  const view: AgentView = { agent_name: a.agent_name, tools, tier, tier_source: grant ? 'grant_map' : 'default', state: 'not_assessed', divergences: [] };
  if (!rules) return view;

  let unreadable = false;
  for (const r of rules) {
    if (r.kind === 'max_tier') {
      if (TIER_RANK[tier] > TIER_RANK[r.tier]) view.divergences.push({ rule: r.kind, detail: `declared tier ${tier}${grant ? '' : ' (the default for an unlisted agent)'} is above the intended maximum ${r.tier}`, escalation: false });
    } else if (r.kind === 'allowed_tools' || r.kind === 'denied_tools') {
      if (!tools) { unreadable = true; continue; }
      const outside = r.kind === 'allowed_tools' ? tools.filter((t) => !r.tools.includes(t)) : tools.filter((t) => r.tools.includes(t));
      if (outside.length) view.divergences.push({ rule: r.kind, detail: `${r.kind === 'allowed_tools' ? 'holds tools outside the intended set' : 'holds tools the direction rules out'}: ${outside.join(', ')}`, escalation: false });
    }
  }
  view.state = view.divergences.length ? 'diverges' : unreadable ? 'not_recorded' : 'within';
  return view;
}

export function assessDirection(snap: DirectionSnapshot): DirectionReport {
  const { state, reason } = directionState(snap.direction, snap.captured_at);
  const rules = state === 'on_file' ? snap.direction!.rules : null;
  const enabled = snap.ai_agents.filter((a) => a.enabled).sort(byName);
  const grants = new Map(snap.grant_map.map((g) => [g.agent_name, g]));
  const agents = enabled.map((a) => assessAgent(a, grants.get(a.agent_name), rules));

  const models = snap.model_uses ? sorted(snap.model_uses.map((m) => m.model)) : null;
  const fleet: Divergence[] = [];
  let modelsUnknown = false;
  for (const r of rules ?? []) {
    if (r.kind !== 'allowed_models') continue;
    if (!models) { modelsUnknown = true; continue; }
    const outside = models.filter((m) => !r.models.includes(m));
    if (outside.length) fleet.push({ rule: r.kind, detail: `the fleet uses models outside the intended set: ${outside.join(', ')}`, escalation: true });
  }
  const escalations = fleet.filter((d) => d.escalation).map((d) => `${d.detail}. A model class change is an escalation under CLAUDE.md for a named human, never a director action.`);

  const diverging = agents.filter((a) => a.state === 'diverges');
  const unrecorded = agents.filter((a) => a.state === 'not_recorded');
  let verdict: DirectionReport['verdict'];
  let statement: string;
  if (!rules) {
    verdict = 'unknown';
    statement = `Divergence is unknown, not "no divergence": ${reason}. The tooling of ${agents.length} enabled agent(s) is listed for a person to write one against.`;
  } else if (diverging.length || fleet.length) {
    verdict = 'divergent';
    const parts = [diverging.length ? `${diverging.length} agent(s) diverge` : '', fleet.length ? 'the fleet\'s model use diverges' : ''].filter(Boolean);
    const gaps = unrecorded.length || modelsUnknown ? ` Some of the fleet could not be checked (${unrecorded.length} agent(s) with no tool record${modelsUnknown ? ', and model use with no export' : ''}), so there may be more.` : '';
    statement = `Against ${reason}: ${parts.join(' and ')}.${gaps}`;
  } else if (unrecorded.length || modelsUnknown) {
    verdict = 'unknown';
    statement = `No divergence was found in what could be read, but ${unrecorded.length} agent(s) have no tool record${modelsUnknown ? ' and model use has no export' : ''}, so the answer is unknown, not "no divergence".`;
  } else {
    verdict = 'no_divergence';
    statement = `Every enabled agent is within ${reason}.`;
  }

  const citations: Citation[] = [
    ...(snap.direction ? [{ table: 'technology_direction' as const, id: snap.direction.id, fields: ['approved_by', 'approved_at', 'rules'] }] : []),
    ...enabled.map((a) => ({ table: 'ai_agents' as const, id: a.id, fields: ['agent_name', 'enabled', 'tools_granted'] })),
    ...(snap.grant_map.length ? [{ table: 'grant_map' as const, id: 'AGENT_PERMISSIONS', fields: ['tier'] }] : []),
    ...(snap.model_uses ? [{ table: 'model_usage_export' as const, id: snap.captured_at, fields: ['model', 'ref'] }] : []),
  ];

  return {
    decided_by: 'a named human',
    direction: { state, id: snap.direction?.id ?? null, reason },
    verdict,
    statement,
    coverage: { enabled_agents: agents.length, tools_recorded: agents.filter((a) => a.tools).length, in_grant_map: agents.filter((a) => a.tier_source === 'grant_map').length },
    agents,
    fleet: { models, divergences: fleet },
    escalations,
    citations,
  };
}
