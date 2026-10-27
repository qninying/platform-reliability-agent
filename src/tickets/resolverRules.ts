// The completion rules of the platform's five ticket resolvers, copied as data and pure functions
// (platform repo, commit efb0cfb). Each rule decides from source records only; it never reads what
// a fixture expects. Where the platform closes on missing or unreadable evidence, Ellis leaves the
// ticket open and says the platform would close it (platform_would_close differs from close_to).
import type { InboxItemRow, Sources, TicketRow } from '../sandbox/ticketSandbox.ts';

export type ResolverName = 'workforce' | 'cory_engine' | 'corybrain_initiative' | 'bpos_capability' | 'inbox_case';
export const RESOLVERS: ResolverName[] = ['workforce', 'cory_engine', 'corybrain_initiative', 'bpos_capability', 'inbox_case'];

// Platform agent names and cron offsets (backend/src/services/aiOpsScheduler.ts:274, :284, :285, :298, :307).
export const PLATFORM_AGENT: Record<ResolverName, { agent_name: string; schedule: string }> = {
  workforce: { agent_name: 'WorkforceTicketAutoResolver', schedule: '15 */6 * * *' },
  cory_engine: { agent_name: 'CoryEngineTicketAutoResolver', schedule: '25 */6 * * *' },
  corybrain_initiative: { agent_name: 'CoryBrainInitiativeTicketAutoResolver', schedule: '40 */6 * * *' },
  bpos_capability: { agent_name: 'BposCapabilityTicketAutoResolver', schedule: '55 */6 * * *' },
  inbox_case: { agent_name: 'InboxCaseSourceCompletionResolver', schedule: '19 * * * *' },
};

export interface Decision {
  outcome: string;
  close_to: 'done' | 'cancelled' | 'RESOLVED' | 'NO_ACTION' | null;
  platform_would_close: boolean;
  evidence: string;
}

const open = (outcome: string, evidence: string, platformWouldClose = false): Decision => ({ outcome, close_to: null, platform_would_close: platformWouldClose, evidence });
const close = (outcome: string, to: NonNullable<Decision['close_to']>, evidence: string): Decision => ({ outcome, close_to: to, platform_would_close: true, evidence });

// Which open tickets each resolver owns (workforceTicketAutoResolver.ts:116-123,
// coryEngineTicketAutoResolver.ts:93, corybrainInitiativeTicketAutoResolver.ts:60,
// bposCapabilityTicketAutoResolver.ts:123-131).
export const TICKET_SCOPE: Record<Exclude<ResolverName, 'inbox_case'>, (t: TicketRow) => boolean> = {
  workforce: (t) => t.type === 'workforce_decision' && t.entity_type === 'agent' && t.created_by_id === 'workforce_intelligence_engine',
  cory_engine: (t) => t.created_by_id === 'cory-engine' && t.type === 'agent_action' && t.source === 'cory_autonomous_cycle',
  corybrain_initiative: (t) => t.created_by_id === 'CoryBrain',
  bpos_capability: (t) => t.created_by_id === 'bpos_orchestrator' && t.type === 'bpos_execution' && t.entity_type === 'capability',
};

// inboxCaseSourceCompletionResolver.ts:91-97.
export const ITEM_SCOPE = (i: InboxItemRow) => i.source_type === 'basecamp_todo' && i.inclusion_status !== 'EXCLUDED';

// workforceTicketAutoResolver.ts:73-89: closes when error rate <= 20% or errors < 10.
export function workforceRule(t: TicketRow, s: Sources): Decision {
  const fromMeta = t.metadata?.agent_name;
  const name = typeof fromMeta === 'string' && fromMeta ? fromMeta : (t.entity_id ?? '').replace(/:high_error_rate$/, '') || null;
  if (!name) return open('no_agent_name', 'the ticket names no agent, so there is nothing to re-check');
  const agent = s.ai_agents.find((a) => a.agent_name === name);
  if (!agent) return open('agent_not_found', `no ai_agents row named ${name}; left open`);
  const runs = agent.run_count || 0;
  const errors = agent.error_count || 0;
  if (runs === 0) {
    return open('no_runs_recorded', `${name} has 0 runs recorded, so its error rate cannot be measured; the platform reads that as 0% and closes`, true);
  }
  const rate = (errors / runs) * 100;
  const figure = `${Math.round(rate * 10) / 10}% (${errors}/${runs} runs)`;
  if (rate > 20 && errors >= 10) return open('still_high_error', `${name}'s error rate is ${figure}, still above the 20% threshold`);
  return close('error_rate_recovered', 'done', `${name}'s error rate is ${figure}, at or below the 20% threshold this ticket was opened under. This is the metric now, not a confirmed root-cause fix.`);
}

const AGENT_FAILURE_RE = /\*\*Problem:\*\*\s*Agent "([^"]+)" is in error state/;
const CONVERSION_DROP_RE = /\*\*Problem:\*\*\s*Lead generation dropped \d+% in last 48h/;
const ERROR_SPIKE_RE = /\*\*Problem:\*\*\s*Error spike: \d+ errors in last hour/;

// coryEngineTicketResolutionRules.ts:59-61, :153-229; the detectors are ProblemDiscoveryAgent.ts:28-91.
export function coryEngineRule(t: TicketRow, s: Sources): Decision {
  const d = t.description ?? '';
  const agentMatch = d.match(AGENT_FAILURE_RE);
  if (agentMatch) {
    const name = agentMatch[1];
    const agent = s.ai_agents.find((a) => a.agent_name === name);
    if (agent && agent.enabled && agent.status === 'error') return open('agent_still_failing', `${name} is still status='error' and enabled`);
    if (!agent) return open('agent_not_found', `no ai_agents row named ${name}: a deleted agent has not recovered; the platform closes it as recovered`, true);
    if (!agent.enabled) return open('agent_disabled', `${name} is disabled: switching a failing agent off is not a recovery; the platform closes it as recovered`, true);
    if (agent.status !== 'idle' && agent.status !== 'running') return open('agent_state_unclear', `${name} is status='${agent.status}', which is neither failing nor working; the platform closes it as recovered`, true);
    return close('agent_recovered', 'done', `${name} is status='${agent.status}' and enabled, no longer in error. This is its latest run, not a confirmed root-cause fix.`);
  }
  if (CONVERSION_DROP_RE.test(d)) {
    if (!s.leads.available) return open('conversion_signal_unavailable', 'the lead query failed, so whether the drop cleared cannot be known; the platform swallows the failure and closes', true);
    // Postgres COUNT(*) / 7 is integer division (ProblemDiscoveryAgent.ts:65).
    const expected = Math.floor(s.leads.last_7d / 7) * 2;
    if (expected === 0) return open('no_baseline', `${s.leads.last_7d} leads in 7 days gives an expected 48h count of 0, so a drop cannot be measured; the platform reads that as cleared and closes`, true);
    if (s.leads.recent_48h < expected * 0.6) return open('conversion_drop_still_active', `${s.leads.recent_48h} leads in 48h against ${expected} expected: still a drop`);
    return close('conversion_drop_cleared', 'done', `${s.leads.recent_48h} leads in 48h against ${expected} expected: no longer a drop.`);
  }
  if (ERROR_SPIKE_RE.test(d)) return open('error_spike_no_reliable_check', 'the error-spike detector cannot run in production, so there is no reliable re-check');
  return open('unclassified', 'the description matches no known cory-engine condition');
}

// corybrainInitiativeTicketAutoResolver.ts:117-159 and corybrainInitiativeTicketResolutionRules.ts:75-147.
export function corybrainRule(t: TicketRow, s: Sources): Decision {
  const initiative = t.parent_ticket_id
    ? s.strategic_initiatives.find((i) => i.id === t.metadata?.initiative_id)
    : s.strategic_initiatives.find((i) => i.ticket_id === t.id);
  if (!initiative) return open('initiative_not_found', 'no linked strategic initiative was found');
  const title = initiative.title ? `"${initiative.title}"` : initiative.id;
  if (initiative.status === 'cancelled') return close('initiative_cancelled', 'cancelled', `linked initiative ${title} is cancelled.`);
  if (initiative.status === 'completed') return close('initiative_completed', 'done', `linked initiative ${title} is completed.`);
  if (['proposed', 'approved', 'in_progress'].includes(initiative.status)) return open('initiative_still_active', `linked initiative ${title} is ${initiative.status}`);
  return open('initiative_status_unknown', `linked initiative ${title} has unrecognized status '${initiative.status}'`);
}

// bposCapabilityTicketResolutionRules.ts:106-170.
export function bposRule(t: TicketRow, s: Sources): Decision {
  if (!t.entity_id) return open('no_signal', 'the ticket names no capability');
  const cap = s.capabilities.find((c) => c.id === t.entity_id);
  if (!cap) return close('capability_deleted', 'cancelled', `capability ${t.entity_id} no longer exists, so there is nothing left to finish.`);
  if (cap.user_status === 'verified') {
    return close('capability_verified', 'done', `capability "${cap.name ?? cap.id}" is user_status 'verified', set by ${cap.user_status_set_by ?? 'an unknown user'} at ${cap.user_status_set_at ?? 'an unknown time'}.`);
  }
  return open('no_signal', `capability "${cap.name ?? cap.id}" is user_status '${cap.user_status ?? 'unknown'}', not verified`);
}

// inboxCaseSourceCompletionRules.ts:68-113: dispositions an item from its mirrored Basecamp to-do.
export function inboxItemRule(i: InboxItemRow, s: Sources): Decision {
  const todo = s.ops_bc_todos.find((x) => x.bc_id === i.source_id);
  if (!todo) return open('no_live_signal', `no mirrored Basecamp to-do ${i.source_id}`);
  if (todo.status === 'completed') return close('completed_at_source', 'RESOLVED', `Basecamp to-do ${i.source_id} is completed at the source.`);
  if (todo.status === 'trashed') return close('trashed_at_source', 'NO_ACTION', `Basecamp to-do ${i.source_id} was trashed at the source.`);
  if (todo.status === 'active') return open('still_active', `Basecamp to-do ${i.source_id} is still active`);
  return open('no_live_signal', `unrecognized Basecamp status '${todo.status}'`);
}

export const TICKET_RULE: Record<Exclude<ResolverName, 'inbox_case'>, (t: TicketRow, s: Sources) => Decision> = {
  workforce: workforceRule,
  cory_engine: coryEngineRule,
  corybrain_initiative: corybrainRule,
  bpos_capability: bposRule,
};
