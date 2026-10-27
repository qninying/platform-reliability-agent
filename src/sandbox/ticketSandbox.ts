import { readFileSync } from 'node:fs';
import { SandboxError } from './sandboxStore.ts';

// A sandbox copy of the ticket queue the five platform resolvers act on, plus the source records
// their completion rules read. Every close writes the status and its evidence comment as one entry,
// so "how many tickets closed and how many comments were added" is counted, not inferred. Nothing
// here reaches a database.

export type Expectation = 'close' | 'stay_open';

// Shaped like the platform's Ticket and TicketActivity models (backend/src/models/Ticket.ts,
// TicketActivity.ts); only the columns the resolvers read.
export interface TicketRow {
  id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by_id: string;
  source?: string | null;
  status: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  parent_ticket_id?: string | null;
}

// Shaped like InboxCaseItem (backend/src/models/InboxCaseItem.ts).
export interface InboxItemRow {
  id: string;
  case_id: string;
  source_type: string;
  source_id: string;
  inclusion_status: string;
  disposition: string | null;
  disposition_reason?: string | null;
}

export interface Sources {
  ai_agents: Array<{ agent_name: string; status: string; enabled: boolean; run_count: number; error_count: number }>;
  capabilities: Array<{ id: string; name?: string | null; user_status: string | null; user_status_set_by?: string | null; user_status_set_at?: string | null }>;
  strategic_initiatives: Array<{ id: string; ticket_id: string | null; status: string; title?: string | null }>;
  ops_bc_todos: Array<{ bc_id: string; status: string | null }>;
  // The lead counts detectConversionDrops() reads; available false means the query failed.
  leads: { available: boolean; recent_48h: number; last_7d: number };
}

export interface TicketFixture {
  fixture_id: string;
  description: string;
  tickets: Array<TicketRow & { expect: Expectation }>;
  inbox_items: Array<InboxItemRow & { expect: Expectation }>;
  sources: Sources;
}

export interface Write {
  seq: number;
  kind: 'ticket_closed' | 'item_dispositioned';
  target_id: string;
  resolver: string;
  from: string | null;
  to: string;
  comment: string;
}

const TERMINAL = new Set(['done', 'cancelled']);

export class TicketSandbox {
  readonly fixtureId: string;
  readonly sources: Sources;
  #tickets = new Map<string, TicketRow>();
  #items = new Map<string, InboxItemRow>();
  // Kept apart from the rows, so a resolver can never read what the fixture expects of it.
  #expect = new Map<string, Expectation>();
  #writes: Write[] = [];

  constructor(f: TicketFixture) {
    this.fixtureId = f.fixture_id;
    this.sources = structuredClone(f.sources);
    for (const { expect, ...t } of f.tickets) {
      this.#tickets.set(t.id, structuredClone(t));
      this.#expect.set(t.id, expect);
    }
    for (const { expect, ...i } of f.inbox_items) {
      this.#items.set(i.id, structuredClone(i));
      this.#expect.set(i.id, expect);
    }
  }

  openTickets(match: (t: TicketRow) => boolean): TicketRow[] {
    return [...this.#tickets.values()].filter((t) => !TERMINAL.has(t.status) && match(t)).map((t) => structuredClone(t)).sort(byId);
  }

  openItems(match: (i: InboxItemRow) => boolean): InboxItemRow[] {
    return [...this.#items.values()].filter((i) => i.disposition === null && match(i)).map((i) => structuredClone(i)).sort(byId);
  }

  // The status change and its evidence comment are one write. A close with no evidence, or of a
  // ticket already closed, is refused, so a re-run can never re-close or re-comment.
  closeTicket(id: string, to: 'done' | 'cancelled', resolver: string, comment: string): Write {
    const t = this.#tickets.get(id);
    if (!t) throw new SandboxError('SandboxWriteFailed', `ticket ${id} does not exist`);
    if (TERMINAL.has(t.status)) throw new SandboxError('SandboxWriteFailed', `ticket ${id} is already ${t.status}`);
    if (!comment.trim()) throw new SandboxError('SandboxWriteFailed', `closing ticket ${id} needs the evidence that satisfied the rule`);
    return this.#record('ticket_closed', id, resolver, t.status, to, comment, () => { t.status = to; });
  }

  disposeItem(id: string, disposition: 'RESOLVED' | 'NO_ACTION', resolver: string, reason: string): Write {
    const i = this.#items.get(id);
    if (!i) throw new SandboxError('SandboxWriteFailed', `inbox item ${id} does not exist`);
    if (i.disposition !== null) throw new SandboxError('SandboxWriteFailed', `inbox item ${id} is already ${i.disposition}`);
    if (!reason.trim()) throw new SandboxError('SandboxWriteFailed', `dispositioning item ${id} needs a reason`);
    return this.#record('item_dispositioned', id, resolver, null, disposition, reason, () => { i.disposition = disposition; i.disposition_reason = reason; });
  }

  isOpen(id: string): boolean {
    const t = this.#tickets.get(id);
    if (t) return !TERMINAL.has(t.status);
    return this.#items.get(id)?.disposition === null;
  }

  expectations(): Array<{ id: string; expect: Expectation }> {
    return [...this.#expect.entries()].map(([id, expect]) => ({ id, expect })).sort(byId);
  }

  writes(): Write[] {
    return this.#writes.map((w) => ({ ...w }));
  }

  #record(kind: Write['kind'], id: string, resolver: string, from: string | null, to: string, comment: string, apply: () => void): Write {
    const w: Write = { seq: this.#writes.length + 1, kind, target_id: id, resolver, from, to, comment };
    apply();
    this.#writes.push(w);
    return { ...w };
  }
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function loadTicketFixture(path: string): TicketFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let f: Partial<TicketFixture>;
  try {
    f = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof f.fixture_id !== 'string' || !Array.isArray(f.tickets) || !Array.isArray(f.inbox_items) || typeof f.sources !== 'object' || f.sources === null) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, tickets[], inbox_items[] and sources`);
  }
  for (const r of [...f.tickets, ...f.inbox_items]) {
    if (r.expect !== 'close' && r.expect !== 'stay_open') throw new SandboxError('ContractViolation', `${r.id}: expect must be 'close' or 'stay_open'`);
  }
  return f as TicketFixture;
}
