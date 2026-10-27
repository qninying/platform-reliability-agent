# Agent ticket auto-resolution

**Story:** `platform.CAP.agent_ticket_auto_resolution` · **Autonomy:** starts R0, first release R4, ceiling R7 (per resolver) · **Approver:** K.D.
**Code:** `src/capabilities/agentTicketAutoResolution.ts`, `src/tickets/resolverRules.ts`, `src/sandbox/ticketSandbox.ts` · **Tests:** `test/agentTicketAutoResolution.test.ts`

Ellis runs the platform's five ticket resolvers against a **sandbox queue**. The queue holds tickets
that should close and tickets that must not. Ellis then runs all five again.

Done means:
- every must-not ticket is still open;
- the second run closes nothing and adds no comment.

Only a sandbox copy can be resolved. There is no production target, by design.

Platform facts cite the public Colaberry platform repository at upstream commit `efb0cfb`.

## The five resolvers

| Resolver (platform agent) | Runs | Closes a ticket when | Seeded |
|---|---|---|---|
| WorkforceTicketAutoResolver | `15 */6 * * *` | the agent's error rate is back at or below 20%, or under 10 errors | on |
| CoryEngineTicketAutoResolver | `25 */6 * * *` | the failing agent is no longer in error, or the lead drop has cleared | off |
| CoryBrainInitiativeTicketAutoResolver | `40 */6 * * *` | the linked initiative is completed (done) or cancelled | off |
| BposCapabilityTicketAutoResolver | `55 */6 * * *` | the capability is verified (done) or deleted (cancelled) | off |
| InboxCaseSourceCompletionResolver | `19 * * * *` | the linked Basecamp to-do is completed or trashed (item-level) | off |

Schedules are at `backend/src/services/aiOpsScheduler.ts:274`, `:284`, `:285`, `:298` and `:307`. The
seed flags are at `backend/src/services/agentRegistrySeed.ts:2943`, `:2979`, `:3016` and `:3086`. The
live flags can be switched without a redeploy, so whether each runs today is unknown until checked.

Each rule is copied from the platform, with the file and lines named in `src/tickets/resolverRules.ts`.

## How the sandbox keeps the brief's three rules

1. **The evidence is part of the write.** A close changes the status and records its evidence in one
   write. A close with no evidence is refused.
2. **A re-run cannot re-close or re-comment.** Closing a closed ticket is refused, and each resolver only
   reads open tickets. Run twice, the second run reports zero closes and zero comments.
3. **Every rule has a negative case.** Before the first run, Ellis checks that each resolver has at least
   one must-not ticket in its scope. A resolver without one is a coverage gap, and the run is not verified.
   Otherwise a rule that matched everything would pass.

The fixture's expectations are kept apart from the ticket rows, so no rule can read what it is expected
to do. A resolver can also be run alone (`--resolver workforce`), which fits the brief: an R7 grant for
one resolver authorizes nothing for another.

## Where Ellis keeps a ticket open that the platform would close

For each of these, Ellis leaves the ticket open and reports `platform_would_close`:

| Resolver | Case | The platform reads it as |
|---|---|---|
| Workforce | the agent has 0 runs recorded, or was disabled | 0% error rate, recovered |
| Cory engine | the failing agent was disabled, deleted or paused | recovered |
| Cory engine | the lead query failed | drop cleared |
| Cory engine | fewer than 7 leads in 7 days (no baseline) | drop cleared |

## What the code showed

1. **Switching a failing agent off closes its ticket as "recovered".** The failing set is agents with
   `status = 'error'` and `enabled = true` (`backend/src/intelligence/agents/ProblemDiscoveryAgent.ts:31-33`).
   Any agent outside that set is closed as recovered, including one that was disabled, deleted or paused
   (`backend/src/intelligence/autonomy/coryEngineTicketResolutionRules.ts:158-184`).
2. **A failed lead query or a quiet week closes a lead-drop ticket as "cleared".**
   - The query's failure is swallowed and returns no problems (`ProblemDiscoveryAgent.ts:86-88`), and
     no problems means cleared (`coryEngineTicketAutoResolver.ts:162`).
   - The daily average is `COUNT(*) / 7` in Postgres, which is whole-number division
     (`ProblemDiscoveryAgent.ts:65`, and again in the resolver at `coryEngineTicketAutoResolver.ts:69`).
     Under 7 leads a week the expected count is 0, so a drop is never reported (`ProblemDiscoveryAgent.ts:72-73`).
     Drop detection is off for exactly the weeks when a drop matters most.
3. **An agent with no runs, or a disabled one, closes as 0% errors** (`backend/src/services/company/workforceTicketAutoResolver.ts:82-89`).
   This resolver skips a missing agent explicitly (`:154-156`) but never reads `enabled`.
4. **Latent, not live: a planned fix would wipe the evidence the resolver checks.**
   - The reset sets `error_count = 0` and `status = 'idle'` (`ExecutionAgent.ts:45-48`). If it ran, the next
     pass would close the ticket as "recovered" whether or not anything was fixed.
   - It cannot run today. The planner picks it only when the problem type and a root-cause pattern both
     match (`backend/src/intelligence/agents/ActionPlannerAgent.ts:37-45`, `:107-113`); otherwise it falls
     back to `launch_ab_test` when confidence is under 0.7, or recommends nothing (`:137-140`). And the
     executor returns early when `agent_name` is missing (`ExecutionAgent.ts:35-36`), which the stored
     default parameters never supply.
   - Reported so the fuse is not added without the evidence problem being fixed first.
5. **A close and its evidence are two separate writes.** `updateTicketStatus` sets the status, then adds
   the comment, with no transaction and no check that the ticket is still open
   (`backend/src/services/company/ticketOrchestrator.ts:161-182`). If the comment write fails, the ticket
   is closed with no evidence. Re-run safety rests only on each resolver's own query filter, so two runs
   that overlap could both close and both comment.
6. **Inbox items: the disposition and its event are also two writes**
   (`inboxCaseSourceCompletionResolver.ts:172-182`). Each pass then closes any case that passes the
   closure guard, not only cases this resolver touched (`:266-269`). Ellis runs the item-level rule only
   and does not copy the nine-condition case guard (`backend/src/services/inboxCase/caseClosureService.ts:41-128`).

## How to run it

```
npm run ticket-resolution -- --fixture examples/ticket-resolution.fixture.json [--resolver workforce]
```

The example is a sandbox queue, not production data. It holds:
- 15 tickets and 4 inbox items across the five resolvers;
- for each resolver, at least one item that should close and one that must stay open;
- the cases in the table above (no runs, a disabled agent);
- a ticket owned by a person, which no resolver may touch.

Exit codes:
- 0: verified
- 3: not verified
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: every must-not ticket is still open, and a second run closes zero additional tickets and adds zero duplicate comments"
  - "acceptance, per resolver: each resolver run alone keeps its must-not tickets open and is a no-op the second time"

  There are 12 tests in this file and 124 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - counting a disabled agent as recovered fails 3;
  - reading 0 runs as 0% (the platform's rule) fails 3;
  - dropping the creator check from the workforce scope fails both acceptance tests;
  - letting a closed ticket back into a run fails the first acceptance test;
  - treating a failed lead query as cleared fails 1;
  - dropping the whole-number baseline fails 1;
  - allowing a closed ticket to be closed again fails 1;
  - dropping the evidence from a close fails 1;
  - removing the coverage check fails 1.

  The failed-lead-query check first passed unnoticed: its test used 0 leads, so a different rule kept
  the ticket open. The test now uses numbers that would otherwise close.
- **Not yet run against a copy of the live queue.** The first live check is a read-only export of the
  open tickets each resolver owns, with the source rows its rule reads, loaded as a fixture.
  K.D. still has to confirm which rules he accepts for closing a ticket without a human reading it.
