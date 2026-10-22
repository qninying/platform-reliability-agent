# platform.CAP.agent_registry_read_surface — Agent registry read surface

Anyone accountable for the fleet can see every registered agent, its schedule, its enabled state and its run history in one place, without reading source code.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- manager_has_no_admin_login: every route here is gated by requireAdmin (backend/src/routes/admin/aiOpsRoutes.ts:70-71) and Kesetebirhan Delele has no admin_users row, so the domain's own manager cannot read his domain's registry
- The mgmt_role model already anticipates him as mgmt_role 'admin' (backend/src/middlewares/__tests__/mgmtRbac.test.ts:30-34), so the missing piece is the admin_users row, not the role design

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent registry read surface
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_registry_read_surface`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
Anyone accountable for the fleet can see every registered agent, its schedule, its enabled state and its run history in one place, without reading source code.
Intended users: Kesetebirhan Delele, Ali Muwwakkil, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An admin opens /admin/intelligence
- The registry tab calls GET /api/admin/ai-ops/registry with any filters
- ai_agents rows are returned with schedule, enabled, status, run_count and error_count
- Selecting a row calls GET /api/admin/ai-ops/registry/:id for detail
**Inputs**
- ai_agents rows
- optional category, status and enabled filters
**Outputs**
- registry listing
- per-agent detail with run and error counts
**Exceptions that must be handled**
- The listing shows only agents that have an ai_agents row, so a running timer with no row is absent from it entirely — the surface cannot distinguish 'not running' from 'not registered'
- Three Dara timers share one row, so the detail view's run_count is a pooled figure for three different schedules
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_activity_log
**Application surfaces**
- /admin/intelligence
- /admin/governance
- GET /api/admin/ai-ops/registry
- GET /api/admin/ai-ops/registry/:id
- GET /api/admin/ai-ops/agents
**Source modules**
- backend/src/services/aiOpsService.ts
- backend/src/routes/admin/aiOpsRoutes.ts
- frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx
**Dependencies**
- platform.agent_identity_attribution
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: A read surface's whole job is answering questions from approved records, which is the definition of autonomy:R2. There is nothing above R2 for it to do, so a higher ceiling would be decoration.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers questions about any registered agent's schedule, state and run history from ai_agents and the activity log.

Acceptance: A question about a name with no ai_agents row returns 'not registered', never 'disabled' and never 'zero runs' — those are three different facts and the surface must not merge them.
## Before you start
- manager_has_no_admin_login: every route here is gated by requireAdmin (backend/src/routes/admin/aiOpsRoutes.ts:70-71) and Kesetebirhan Delele has no admin_users row, so the domain's own manager cannot read his domain's registry
- The mgmt_role model already anticipates him as mgmt_role 'admin' (backend/src/middlewares/__tests__/mgmtRbac.test.ts:30-34), so the missing piece is the admin_users row, not the role design
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:70 GET /api/admin/ai-ops/registry
- backend/src/routes/admin/aiOpsRoutes.ts:71 GET /api/admin/ai-ops/registry/:id
- backend/src/services/aiOpsService.ts:201 getAgentRegistry({category,status,enabled}), :219 getAgentDetail
- frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx:88 fetches ai-ops/registry
- frontend/src/routes/adminRoutes.tsx:223 /admin/ai-settings redirects to /admin/intelligence
- backend/src/models/AiAgent.ts:572 index on enabled, :573 index on trigger_type

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A question about a name with no ai_agents row returns 'not registered', never 'disabled' and never 'zero runs' — those are three different facts and the surface must not merge them.

When every box above is ticked, stop and show the demo.
