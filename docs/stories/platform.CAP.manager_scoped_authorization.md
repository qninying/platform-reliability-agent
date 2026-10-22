# platform.CAP.manager_scoped_authorization — Manager-scoped authorization for agent management

A management action on an agent is authorised against whether the acting human actually manages that agent, so admin access does not silently become authority over every agent in the company.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because the shipped coverage is reported in a document that declares itself stale, while the AI Ops routes this domain depends on are gated by requireAdmin alone — the real coverage for this domain's surfaces is unknown and was not measured in this read-only task
- Creating the admin_users row that would let Kesetebirhan Delele be authorised is a production identity change; production_database is default-denied (executionPolicy.ts:33-42) and a human must perform it
- manager_has_no_admin_login: the capability that would scope his authority cannot authorise him, because he has no login to scope

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Manager-scoped authorization for agent management
**Domain:** Platform Automation & Reliability · **Capability:** `platform.manager_scoped_authorization`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
A management action on an agent is authorised against whether the acting human actually manages that agent, so admin access does not silently become authority over every agent in the company.
Intended users: Kesetebirhan Delele, Ali Muwwakkil, every domain manager.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The route requires a real admin login first
- A platform superadmin passes
- Otherwise the caller's email is joined to an org_members row
- The chain walker decides whether the target agent is in that human's downstream, and the resolved org member id is tagged for audit
**Inputs**
- the acting admin's JWT (sub, email, role, mgmt_role)
- the target agent id
- org_members rows
- the reports-to chain
**Outputs**
- pass, or a 403 naming whether the caller has no linked org member or is outside the chain
**Exceptions that must be handled**
- The JWT carries no org_members id on any login path, so the join is by email and depends on the two records agreeing
- A human with no admin_users row cannot be authorised at all, however correct their org_members record — which is precisely this domain's blocker
- The transitive chain walk means anyone above a manager also passes, which is intended for the founder and must not be mistaken for a scoped grant
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_audit_log
- read_approval_records
**Application surfaces**
- /admin/intelligence
- /admin/governance
- every /api/admin/ai-ops/* route
- every /api/admin/governance-center/* route
**Source modules**
- backend/src/middlewares/authMiddleware.ts
- backend/src/services/orgChartHierarchyService.ts
- backend/src/services/access/mgmtRoles.ts
**Dependencies**
- platform.agent_identity_attribution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: This is the authorization boundary itself. An agent with any write authority over it could grant itself a manager, so the ceiling is answering questions about who is authorised for what. Authentication and authorization posture is an escalation boundary under CLAUDE.md.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'who may act on this agent, and by which route' from identity, role and chain records.

Acceptance: For Kesetebirhan Delele and any platform agent the answer is 'nobody, via no route, because he holds no admin_users row' — a positive control that the gap is reported rather than papered over.
## Before you start
- Marked partial because the shipped coverage is reported in a document that declares itself stale, while the AI Ops routes this domain depends on are gated by requireAdmin alone — the real coverage for this domain's surfaces is unknown and was not measured in this read-only task
- Creating the admin_users row that would let Kesetebirhan Delele be authorised is a production identity change; production_database is default-denied (executionPolicy.ts:33-42) and a human must perform it
- manager_has_no_admin_login: the capability that would scope his authority cannot authorise him, because he has no login to scope
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- docs/architecture/ai-workforce-management/MANAGER_AUTHORIZATION_MAP.md:3 'manager instructions may only RESTRICT an agent, never expand its authority; every management action must be authorized server-side against a real "is this human actually this agent's manager" check — never frontend visibility alone'
- docs/architecture/ai-workforce-management/MANAGER_AUTHORIZATION_MAP.md:22-32 the proposed requireAgentManagerOrAdmin shape: requireAdmin, then super_admin passes, else OrgMember by email then isAgentInHumanDownstream
- docs/architecture/ai-workforce-management/MANAGER_AUTHORIZATION_MAP.md:17 'No function or middleware today answers... Everything today collapses to a single requireAdmin bit.'
- docs/architecture/ai-workforce-management/IMPLEMENTATION_STATUS.md:3 requireAgentManagerOrAdmin reported on 27 routes, in a document that declares itself stale
- backend/src/middlewares/__tests__/mgmtRbac.test.ts:30-34 the mgmt_role model already anticipates Kes as mgmt_role 'admin' with inbox_content withheld
- backend/src/routes/admin/aiOpsRoutes.ts:44-82 every AI Ops route is gated by requireAdmin alone

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] For Kesetebirhan Delele and any platform agent the answer is 'nobody, via no route, because he holds no admin_users row' — a positive control that the gap is reported rather than papered over.

When every box above is ticked, stop and show the demo.
