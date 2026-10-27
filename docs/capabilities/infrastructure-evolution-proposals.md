# Infrastructure and platform evolution proposals

**Story:** `platform.CAP.infrastructure_evolution_proposals` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/evolutionProposals.ts` · **Tests:** `test/evolutionProposals.test.ts`

Ellis answers **"what has been proposed, what is its rationale, and what happened to it?"** for the
three platform architects: InfrastructureEvolutionArchitect, OrchestrationEcosystemArchitect and
PlatformInnovationArchitect.

**This is a human decision at every autonomy level.** Ellis reports. It never accepts, defers or
rejects a proposal.

Platform facts cite the public Colaberry platform repository at upstream commit `3ffea7c`.

## How a proposal's state is decided

Every proposal reads as exactly one of **open, accepted, deferred or rejected**. Only a recorded
decision moves it off open, so a proposal with no recorded outcome is open, never accepted.

| Recorded outcome | State | Who is named |
|---|---|---|
| A person moved the proposal's ticket to todo, in progress, in review or done | accepted | that person, with the time |
| A person cancelled the proposal's ticket | rejected | that person, with the time |
| Initiative status `active` or `completed` | accepted | "unattributed": the record does not say who set it |
| Initiative status `on_hold` | deferred | "unattributed" |
| Initiative status `cancelled` | rejected | "unattributed" |
| Nothing recorded | open | nobody |

Four rules keep the answer safe:
- **An agent cannot decide.** A ticket moved or closed by an agent is ignored, and the proposal stays open.
- **A ticket status alone is not a decision.** It counts only when a person's activity record changed it.
- **Outcomes that disagree read as open.** For example, a ticket a person accepted under an initiative
  marked cancelled. Both outcomes are named.
- **Unknown statuses are not decisions.** A status the platform does not define reads as open, with a note.

Ticket statuses have no "deferred", so deferred can only come from the initiative status `on_hold`.

Each proposal also gives:
- its rationale (the recorded description, or a note that none was recorded);
- its architect and when it was proposed;
- a citation for the initiative, its tickets and the deciding activity.

The report also lists **proposals raised again after the same idea was rejected** in the same
department (finding 2).

## What the code showed

1. **No proposal has ever left "planned".**
   - Nothing in the code, human or automated, changes an architect initiative's status after it is
     created. The platform's own audit says so (`backend/src/scripts/lib/agentTicketStandardChecks.ts:322-334`).
   - The approve and reject routes act on a different table, Cory's `strategic_initiatives`
     (`backend/src/routes/admin/coryRoutes.ts:286`, `:297`).
   - So the only decision trail is a person moving the proposal's ticket. Ellis reads that.
   - Because duplicates are checked only against planned and active proposals, each department can hold
     one open proposal per idea type, and it stays open forever.
2. **No idea can ever be proposed again.**
   - The brief says existing proposals in open or rejected state are checked first. The model has no
     rejected state: its statuses are planned, active, completed, on_hold and cancelled
     (`backend/src/models/Initiative.ts:4`).
   - The duplicate check covers `planned` and `active` (`backend/src/services/agents/strategy/strategyArchitectAgent.ts:120-123`,
     `backend/src/services/departmentInitiativeEngine.ts:205-215`). Because nothing writes the status
     (finding 1), every proposal stays `planned` forever, inside the duplicate window. So no idea of the
     same type can be proposed again, including one finished or abandoned on purpose.
3. **Proposing raises the department's health score.**
   - Each cycle that creates a proposal adds 2 to the department's health score and 3 to its innovation
     score (`strategyArchitectAgent.ts:241-247`).
   - The scores start at seeded values (for example health 88 or 100, innovation 50:
     `backend/src/seeds/seedDepartments.ts:13`, `backend/src/services/departmentSeed.ts:38-39`) and are read
     back as the department's health on the next cycle (`departmentInitiativeEngine.ts:100-101`).
   - I found no other code that changes them, so they rise with proposals made, up to 100, not with
     problems fixed.
   - A department below its health threshold triggers a health proposal (`:133-135`). Making proposals
     eventually lifts it over the threshold, and the proposals stop.
4. **The grant does not cover every write.** The registry grant lists five tools (`agentRegistrySeed.ts:1874`,
   `:1969`, `:1981`). The department score update in finding 3 is a write none of them names.
   This is the first visible effect of an unenforced grant map (see agent-behavior-safety-watch.md,
   finding 2): an agent quietly moves a number nobody authorised it to touch, and the number decides
   whether it keeps proposing. The fix is to remove the write, not widen the grant. If an agent needs to
   move a score, a person adds that tool on purpose.
5. **The three architects are not specialised.** All sixteen architects, including these three, run the
   same function with a different department slug (`backend/src/services/aiOrchestrator.ts:798-828`).
6. **The person who should decide cannot open the list.** The initiatives list is admin-only
   (`backend/src/routes/admin/departmentIntelligenceRoutes.ts:27`, `:51`), and K.D. has no admin login.

## How to run it

```
npm run evolution-proposals -- --snapshot examples/evolution-proposals.example.json [--architect <name> ...]
```

The example is not production data. It shows:
- one proposal of each state;
- an agent-closed ticket, which stays open;
- a proposal with no rationale;
- a conflict between the ticket and the initiative status;
- a proposal raised again after the same idea was rejected;
- an out-of-scope architect.

Exit codes:
- 0: every proposal has a recorded outcome
- 3: any proposal is open
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: a proposal with no recorded outcome reads as open, not as accepted"
  - "acceptance: every proposal's state is one of open, accepted, deferred or rejected, whatever the records hold"

  There are 13 tests in this file and 137 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - reading no outcome as accepted fails 4;
  - reading `planned` as accepted fails 6;
  - reading an unknown status as accepted fails 7;
  - counting an agent's ticket move as a decision fails 1;
  - reading a cancelled ticket as accepted fails 3;
  - resolving a conflict to the ticket's outcome fails 1;
  - letting the earliest move win fails 1;
  - ignoring the department when spotting re-proposals fails 1;
  - keeping a blank rationale fails 1.
- **Not yet run on live records.** The first live check is one export of
  `GET /api/admin/intelligence/initiatives` for the three architects, their `strategic` tickets, and those
  tickets' status-change activity.
