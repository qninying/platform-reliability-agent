# platform.CAP.agent_ticket_auto_resolution — Agent ticket auto-resolution

Tickets raised by platform and workforce agents are closed automatically every six hours when their completion condition is already satisfied, so the ticket queue reflects reality instead of accumulating resolved-but-open work.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Kesetebirhan Delele must confirm, per resolver, which completion rules he accepts as sufficient to close a ticket without a human reading it
- manager_has_no_admin_login: he cannot review the resolution history on /admin/intelligence (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:52)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent ticket auto-resolution
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_ticket_auto_resolution`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Tickets raised by platform and workforce agents are closed automatically every six hours when their completion condition is already satisfied, so the ticket queue reflects reality instead of accumulating resolved-but-open work.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Each resolver fires on its own staggered six-hourly offset, except the inbox-case resolver which runs hourly
- Open tickets owned by that resolver are matched against its completion rules
- A matching ticket is closed with the evidence that satisfied the rule recorded on it
- A non-matching ticket is left open and untouched
**Inputs**
- open agent-created tickets
- per-resolver completion rules
- source completion state
**Outputs**
- resolved tickets with a recorded reason
- resolution run record
- artifact comment on the ticket
**Exceptions that must be handled**
- A ticket closed without the evidence recorded on it is indistinguishable from a ticket closed in error, so the reason is part of the write, not a nicety
- Re-running a resolver must not re-close or re-comment on an already closed ticket
- A completion rule that matches everything would silently empty the queue; each rule needs a negative case that provably stays open
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_ticket_queue
- resolve_ticket
- read_activity_log
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/intelligence/autonomy/inboxCaseSourceCompletionResolver.ts
- backend/src/scripts/lib/agentTicketStandardChecks.ts
- backend/src/scripts/resolveBposCapabilityTickets.ts
**Dependencies**
- platform.agent_identity_attribution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R7**.
Why that ceiling: This is the one inherited behaviour whose action class is genuinely enumerable — each resolver has a written completion rule, and closing a ticket is reversible. R7 is therefore reachable, but only per-resolver: an R7 grant for the workforce resolver authorizes nothing for the BPOS resolver.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R4)**
Runs each resolver against a sandbox queue containing tickets that should close and tickets that must not.

Acceptance: Every must-not ticket is still open, and a second run closes zero additional tickets and adds zero duplicate comments.
## Before you start
- Kesetebirhan Delele must confirm, per resolver, which completion rules he accepts as sufficient to close a ticket without a human reading it
- manager_has_no_admin_login: he cannot review the resolution history on /admin/intelligence (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:52)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:274 WorkforceTicketAutoResolver '15 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:284 CoryEngineTicketAutoResolver '25 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:285 CoryBrainInitiativeTicketAutoResolver '40 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:307 BposCapabilityTicketAutoResolver '55 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:298 InboxCaseSourceCompletionResolver '19 * * * *'
- backend/src/intelligence/autonomy/inboxCaseSourceCompletionRules.ts and backend/src/scripts/lib/agentTicketStandardChecks.ts

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every must-not ticket is still open, and a second run closes zero additional tickets and adds zero duplicate comments.

When every box above is ticked, stop and show the demo.
