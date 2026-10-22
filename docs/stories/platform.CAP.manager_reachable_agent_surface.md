# platform.CAP.manager_reachable_agent_surface — Manager-reachable agent surface

The human accountable for this domain can actually open his employee's detail and talk surface, so accountability is exercisable rather than nominal.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today — and this capability exists precisely because of that, so it is the one he must confirm first

**Blocked by**
- manager_has_no_admin_login: Kesetebirhan Delele has an org_members row (3df017df-affa-49ab-884f-a99a4bd2ef4e) but no admin_users row, so he cannot open his employee's Agent Detail or Talk surface. This is the root blocker that every other capability in this domain inherits
- production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42); a human must create the row
- Which of his two emails is authoritative is unresolved and must be decided before the login is created, because the authorization join is by email

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Manager-reachable agent surface
**Domain:** Platform Automation & Reliability · **Capability:** `platform.manager_reachable_agent_surface`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** manager_defined
## The business outcome
The human accountable for this domain can actually open his employee's detail and talk surface, so accountability is exercisable rather than nominal.
Intended users: Kesetebirhan Delele.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Decide the access route: an admin_users row with a scoped mgmt_role, or a named alternative surface
- Reconcile the email on the admin_users row with the email on the org_members row, since the authorization join is by email
- Grant the minimum sections the platform domain actually needs
- Verify by having him open the surface, and record that he did
**Inputs**
- his org_members row 3df017df-affa-49ab-884f-a99a4bd2ef4e
- the email that row carries, kesetebirhan@gmail.com
- the intended mgmt_role scope
**Outputs**
- a reachable agent detail and talk surface for the platform domain
- a Phase 5 verification record that he opened it
**Exceptions that must be handled**
- He appears in the repository under two different emails — kesetebirhan@gmail.com on the org_members row and kes@colaberry.com in the team roster — and the authorization design joins on email, so picking the wrong one produces a login that authorises nothing
- A full admin role would over-grant: the existing RBAC model deliberately withholds inbox_content from his intended scope
- Creating the login is an identity change in production and is not something this planning task may perform
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_audit_log
- read_agent_registry
**Application surfaces**
- /admin/intelligence
- /admin/governance
- every /api/admin/ai-ops/* route
- every /api/admin/governance-center/* route
**Source modules**
- backend/src/services/agentDomain/agentDomainRegistry.ts
- backend/src/middlewares/authMiddleware.ts
- backend/src/services/access/mgmtRoles.ts
**Dependencies**
- platform.manager_scoped_authorization
- platform.agent_identity_attribution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Provisioning a human's login and choosing their permission scope is an identity and authorization decision — a governance boundary under CLAUDE.md and the one decision an agent in this domain must never make, since it would be granting access to its own supervisor's seat.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
States exactly what is missing, which route would resolve it, which sections the scope should include, and which email the join requires.

Acceptance: The answer names the org_members id and the absent admin_users row as two separate facts, and does not claim the surface is reachable under any current configuration.
## Before you start
- manager_has_no_admin_login: Kesetebirhan Delele has an org_members row (3df017df-affa-49ab-884f-a99a4bd2ef4e) but no admin_users row, so he cannot open his employee's Agent Detail or Talk surface. This is the root blocker that every other capability in this domain inherits
- production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42); a human must create the row
- Which of his two emails is authoritative is unresolved and must be decided before the login is created, because the authorization join is by email
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:46 'Four resolved owners, Aleem, Swati, Taiwo and Kes, have no admin_users login, so they cannot open their employee's Agent Detail or Talk tab today... Each employee's Phase 1 must state how its manager will reach it (an admin_users row with a scoped mgmt_role, or an alternative surface), and Phase 5 must verify the manager actually did.'
- docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19 row 9, Platform Automation & Reliability, Kes, team Operations, admin_users login 'none'
- backend/src/services/agentDomain/agentDomainRegistry.ts:199-205 domain_key 'platform', can_reach_surface false, blocker from MANAGER_NO_LOGIN('Kesetebirhan Delele', 'Already the reports_to target for workforce_intelligence_engine.')
- backend/src/services/agentDomain/agentDomainRegistry.ts:82-84 MANAGER_NO_LOGIN text: 'has an org_members row but no admin_users row, so they cannot open their employee's Agent Detail or Talk surface'
- backend/src/middlewares/__tests__/mgmtRbac.test.ts:30-34 adminAllowedSections({ role: 'admin', mgmt_role: 'admin' }) already models Kes's intended scope, including that he cannot see inbox_content

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The answer names the org_members id and the absent admin_users row as two separate facts, and does not claim the surface is reachable under any current configuration.

When every box above is ticked, stop and show the demo.
