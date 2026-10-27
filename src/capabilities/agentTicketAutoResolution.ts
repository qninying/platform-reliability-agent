// platform.agent_ticket_auto_resolution, first release behaviour (R4):
// runs each of the platform's five ticket resolvers against a sandbox queue holding tickets that
// should close and tickets that must not, then runs them all again. Done means every must-not ticket
// is still open, and the second run closes nothing and adds no comment.
//
// Only a TicketSandbox can be resolved: there is no production target, by design.
//
// Platform behaviour this rests on (platform repo, commit efb0cfb):
// - Every resolver closes through updateTicketStatus (backend/src/services/company/ticketOrchestrator.ts:161-182),
//   which writes the status and then the evidence comment as two separate writes with no transaction,
//   and does not check the ticket is still open. Re-run safety rests on each resolver's own query
//   filter (status NOT IN done, cancelled). Here the close and its comment are one write, and closing
//   a closed ticket is refused.
// - Inbox case closure goes through the platform's nine-condition guard
//   (backend/src/services/inboxCase/caseClosureService.ts:41-128). Ellis runs the item-level rule only
//   and does not copy the guard.
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { TicketSandbox, type Write } from '../sandbox/ticketSandbox.ts';
import { ITEM_SCOPE, PLATFORM_AGENT, RESOLVERS, TICKET_RULE, TICKET_SCOPE, inboxItemRule, type Decision, type ResolverName } from '../tickets/resolverRules.ts';

export interface TicketResult {
  id: string;
  outcome: string;
  closed_to: Decision['close_to'];
  platform_would_close: boolean;
  evidence: string;
}

export interface ResolverRun {
  resolver: ResolverName;
  agent_name: string;
  checked: number;
  closed: number;
  results: TicketResult[];
  // Tickets Ellis left open that the platform's rule would close.
  platform_differs: string[];
  errors: Array<{ id: string; error_class: string; message: string }>;
}

export interface Verification {
  fixture_id: string;
  resolvers: ResolverName[];
  coverage_gaps: ResolverName[];
  first_run: ResolverRun[];
  second_run: ResolverRun[];
  must_not_still_open: boolean;
  closed_must_not: string[];
  left_open_should_close: string[];
  second_run_closed: number;
  second_run_comments: number;
  verified: boolean;
}

export function resolveOnce(store: TicketSandbox, resolvers: ResolverName[] = RESOLVERS): ResolverRun[] {
  if (!(store instanceof TicketSandbox)) throw new SandboxError('ContractViolation', 'resolvers run against a TicketSandbox only');
  return resolvers.map((r) => runResolver(store, r));
}

function runResolver(store: TicketSandbox, resolver: ResolverName): ResolverRun {
  const run: ResolverRun = { resolver, agent_name: PLATFORM_AGENT[resolver].agent_name, checked: 0, closed: 0, results: [], platform_differs: [], errors: [] };
  const work: Array<{ id: string; decide: () => Decision; apply: (d: Decision) => Write }> = resolver === 'inbox_case'
    ? store.openItems(ITEM_SCOPE).map((i) => ({ id: i.id, decide: () => inboxItemRule(i, store.sources), apply: (d) => store.disposeItem(i.id, d.close_to as 'RESOLVED' | 'NO_ACTION', resolver, d.evidence) }))
    : store.openTickets(TICKET_SCOPE[resolver]).map((t) => ({ id: t.id, decide: () => TICKET_RULE[resolver](t, store.sources), apply: (d) => store.closeTicket(t.id, d.close_to as 'done' | 'cancelled', resolver, d.evidence) }));
  for (const w of work) {
    run.checked++;
    const d = w.decide();
    run.results.push({ id: w.id, outcome: d.outcome, closed_to: d.close_to, platform_would_close: d.platform_would_close, evidence: d.evidence });
    if (d.close_to === null) {
      if (d.platform_would_close) run.platform_differs.push(w.id);
      continue;
    }
    try {
      w.apply(d);
      run.closed++;
    } catch (err) {
      // One bad ticket never stops the batch; the error is reported with the ticket it belongs to.
      const e = err as SandboxError;
      run.errors.push({ id: w.id, error_class: e.errorClass ?? 'SandboxWriteFailed', message: e.message });
    }
  }
  return run;
}

// A resolver with no must-not ticket in its scope is unproven: a rule that matches everything would
// pass. Checked before the first run, from the queue as it was seeded.
export function coverageGaps(store: TicketSandbox, resolvers: ResolverName[] = RESOLVERS): ResolverName[] {
  const mustNot = new Set(store.expectations().filter((e) => e.expect === 'stay_open').map((e) => e.id));
  return resolvers.filter((r) => {
    const inScope = r === 'inbox_case' ? store.openItems(ITEM_SCOPE) : store.openTickets(TICKET_SCOPE[r]);
    return !inScope.some((x) => mustNot.has(x.id));
  });
}

export function verifyResolution(store: TicketSandbox, resolvers: ResolverName[] = RESOLVERS): Verification {
  const coverage_gaps = coverageGaps(store, resolvers);
  const first_run = resolveOnce(store, resolvers);
  const before = store.writes().length;
  const second_run = resolveOnce(store, resolvers);
  const added = store.writes().slice(before);
  const exp = store.expectations();
  const closed_must_not = exp.filter((e) => e.expect === 'stay_open' && !store.isOpen(e.id)).map((e) => e.id);
  const left_open_should_close = exp.filter((e) => e.expect === 'close' && store.isOpen(e.id)).map((e) => e.id);
  const second_run_closed = second_run.reduce((n, r) => n + r.closed, 0);
  const second_run_comments = added.length;
  const verified = coverage_gaps.length === 0 && closed_must_not.length === 0 && left_open_should_close.length === 0
    && second_run_closed === 0 && second_run_comments === 0 && [...first_run, ...second_run].every((r) => r.errors.length === 0);
  return {
    fixture_id: store.fixtureId, resolvers, coverage_gaps, first_run, second_run,
    must_not_still_open: closed_must_not.length === 0, closed_must_not, left_open_should_close,
    second_run_closed, second_run_comments, verified,
  };
}
