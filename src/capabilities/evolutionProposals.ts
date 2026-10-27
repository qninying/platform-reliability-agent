// platform.infrastructure_evolution_proposals, first release behaviour (R2):
// answers "what has been proposed, what is its rationale, and what happened to it?" from the
// initiative records the architects write and the tickets generated for them. Each proposal's state
// is open, accepted, deferred or rejected, and only a recorded decision moves it off open: a proposal
// with no recorded outcome is open, never accepted. Read-only. Adopting a proposal is a human decision
// at every autonomy level; Ellis reports, it never decides.
//
// Platform behaviour this rests on (platform repo, commit 3ffea7c):
// - The three architects, like all sixteen, run the same strategyArchitectAgent with a department
//   slug (backend/src/services/aiOrchestrator.ts:798-828, agentRegistrySeed.ts:1875, :1970, :1982).
// - A proposal is an `initiatives` row created as 'planned' (departmentInitiativeEngine.ts:221-233),
//   plus one ticket with entity_type 'initiative' and entity_id set to it (:267-283).
// - initiatives.status is planned | active | completed | on_hold | cancelled (models/Initiative.ts:4),
//   with no field for who changed it. No code path writes it after creation
//   (scripts/lib/agentTicketStandardChecks.ts:322-334). The only attributed decision is a person
//   changing the linked ticket's status, which TicketActivity records with actor_type 'human'
//   (models/Ticket.ts:57, company/ticketOrchestrator.ts:161-182).
// - Ticket statuses run backlog, todo, in_progress, in_review, done, cancelled (ticketService.ts:40-47);
//   none means deferred, so 'deferred' can only come from initiatives.status 'on_hold'.

import type { Citation } from './orchestrationHealthWatch.ts';

export const PLATFORM_ARCHITECTS = ['InfrastructureEvolutionArchitect', 'OrchestrationEcosystemArchitect', 'PlatformInnovationArchitect'];
const DEDUP_TAG_PREFIX = 'dedup_key:';

export interface InitiativeRow {
  id: string;
  department_id: string;
  title: string;
  description: string | null;
  status: string;
  created_by_agent: string | null;
  tags?: string[] | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ProposalTicketRow {
  id: string;
  status: string;
  entity_type: string | null;
  entity_id: string | null;
}

export interface TicketActivityRow {
  id: string;
  ticket_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  from_value?: string | null;
  to_value?: string | null;
  created_at: string;
}

export interface ProposalSnapshot {
  captured_at: string;
  captured_by: string;
  initiatives: InitiativeRow[];
  tickets: ProposalTicketRow[];
  ticket_activities: TicketActivityRow[];
}

export type ProposalState = 'open' | 'accepted' | 'deferred' | 'rejected';
type Outcome = Exclude<ProposalState, 'open'>;

export interface ProposalAnswer {
  id: string;
  title: string;
  architect: string;
  proposed_at: string;
  rationale: string | null;
  state: ProposalState;
  decided: { by: string; at: string | null; source: 'ticket_activity' | 'initiative_status' } | null;
  reason: string;
  notes: string[];
  ticket_ids: string[];
  citations: Citation[];
}

export interface ProposalReport {
  architects: string[];
  counts: Record<ProposalState, number>;
  proposals: ProposalAnswer[];
  // Proposals whose duplicate key matches an earlier rejected one: the platform only checks planned
  // and active initiatives before proposing (departmentInitiativeEngine.ts:205-215).
  reproposed_after_rejection: Array<{ id: string; earlier_rejected: string[] }>;
}

const TICKET_OUTCOME: Record<string, Outcome> = { todo: 'accepted', in_progress: 'accepted', in_review: 'accepted', done: 'accepted', cancelled: 'rejected' };
const STATUS_OUTCOME: Record<string, Outcome | null> = { planned: null, active: 'accepted', completed: 'accepted', on_hold: 'deferred', cancelled: 'rejected' };

export function proposalReport(snap: ProposalSnapshot, opts: { architects?: string[] } = {}): ProposalReport {
  const architects = [...(opts.architects ?? PLATFORM_ARCHITECTS)].sort();
  const rows = snap.initiatives
    .filter((i) => i.created_by_agent !== null && architects.includes(i.created_by_agent))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const proposals = rows.map((i) => judge(i, snap));
  const counts = { open: 0, accepted: 0, deferred: 0, rejected: 0 };
  for (const p of proposals) counts[p.state]++;
  return { architects, counts, proposals, reproposed_after_rejection: reproposals(rows, proposals) };
}

function judge(i: InitiativeRow, snap: ProposalSnapshot): ProposalAnswer {
  const notes: string[] = [];
  const tickets = snap.tickets.filter((t) => t.entity_type === 'initiative' && t.entity_id === i.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const ticketIds = new Set(tickets.map((t) => t.id));
  const activity = snap.ticket_activities.filter((a) => ticketIds.has(a.ticket_id) && a.action === 'status_changed');
  const human = activity.filter((a) => a.actor_type === 'human').sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))[0];
  const citations: Citation[] = [
    { table: 'initiatives', id: i.id, fields: ['status', 'created_by_agent', 'description'] },
    ...tickets.map((t): Citation => ({ table: 'tickets', id: t.id, fields: ['status', 'entity_id'] })),
    ...(human ? [{ table: 'ticket_activities', id: human.id, fields: ['actor_type', 'actor_id', 'to_value', 'created_at'] } as Citation] : []),
  ];

  if (tickets.length === 0) notes.push('no ticket is linked to this proposal, so no one has been asked to decide it');
  const unattributedMoves = tickets.filter((t) => t.status !== 'backlog' && !human);
  for (const t of unattributedMoves) notes.push(`ticket ${t.id} is '${t.status}' but no person changed it, so it is not counted as a decision`);
  if (activity.some((a) => a.actor_type !== 'human')) notes.push('an agent changed a linked ticket; an agent cannot decide a proposal, so that is ignored');

  const fromTicket = human ? TICKET_OUTCOME[human.to_value ?? ''] ?? null : null;
  if (!(i.status in STATUS_OUTCOME)) notes.push(`initiative status '${i.status}' is not one the platform defines, so it is not read as a decision`);
  const fromStatus = STATUS_OUTCOME[i.status] ?? null;
  if (fromStatus) notes.push(`initiative status '${i.status}' records no one who set it`);

  const rationale = i.description && i.description.trim() ? i.description : null;
  if (!rationale) notes.push('no rationale was recorded');
  const base = { id: i.id, title: i.title, architect: i.created_by_agent ?? '', proposed_at: i.created_at, rationale, notes, ticket_ids: [...ticketIds], citations };

  if (fromTicket && fromStatus && fromTicket !== fromStatus) {
    return { ...base, state: 'open', decided: null, reason: `the recorded outcomes disagree (ticket says ${fromTicket}, initiative status says ${fromStatus}), so what was decided cannot be known` };
  }
  if (fromTicket && human) {
    return { ...base, state: fromTicket, decided: { by: human.actor_id ?? 'an unnamed person', at: human.created_at, source: 'ticket_activity' }, reason: `${human.actor_id ?? 'a person'} moved the ticket to '${human.to_value}'` };
  }
  if (fromStatus) {
    return { ...base, state: fromStatus, decided: { by: 'unattributed', at: i.updated_at ?? null, source: 'initiative_status' }, reason: `initiative status is '${i.status}'` };
  }
  return { ...base, state: 'open', decided: null, reason: 'no outcome is recorded, so it is open, not accepted' };
}

function reproposals(rows: InitiativeRow[], proposals: ProposalAnswer[]): ProposalReport['reproposed_after_rejection'] {
  const keyOf = (i: InitiativeRow) => `${i.department_id}|${(i.tags ?? []).find((t) => t.startsWith(DEDUP_TAG_PREFIX)) ?? ''}`;
  const stateOf = new Map(proposals.map((p) => [p.id, p.state]));
  const out: ProposalReport['reproposed_after_rejection'] = [];
  rows.forEach((row, n) => {
    if (keyOf(row).endsWith('|')) return;
    const earlier = rows.slice(0, n).filter((e) => keyOf(e) === keyOf(row) && stateOf.get(e.id) === 'rejected').map((e) => e.id);
    if (earlier.length > 0) out.push({ id: row.id, earlier_rejected: earlier });
  });
  return out;
}
