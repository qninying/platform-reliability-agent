# platform.CAP.agent_enable_disable_control — Agent enable, disable, pause and resume control

A named human can stop or start a specific agent without a deploy, so a misbehaving agent is contained in seconds rather than in a release cycle.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Disabling a live timer is a human decision; an agent never holds this control even at the top of its ladder
- The write lands in production ai_agents; production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation)
- manager_has_no_admin_login: Kesetebirhan Delele, the human who should hold this control for the platform domain, cannot reach the endpoint (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:72)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent enable, disable, pause and resume control
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_enable_disable_control`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
A named human can stop or start a specific agent without a deploy, so a misbehaving agent is contained in seconds rather than in a release cycle.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An authorised human selects an agent and an action on the registry surface
- controlAgent updates status or enabled on the ai_agents row
- On the next tick, instrumented jobs observe the new state and skip with a structured warn
- The skip is visible in logs as cron_job_skipped_disabled rather than as silence
**Inputs**
- agent id
- action: pause | resume | enable | disable
- acting admin identity
**Outputs**
- updated ai_agents row
- skip log lines on subsequent ticks
**Exceptions that must be handled**
- Disabling by agent_name moves every timer sharing that name — the three Dara entries are one row, so one disable stops three schedules
- An uninstrumented or unregistered timer cannot be disabled this way at all, because there is no row for the flag to live on
- A disable that is never re-enabled is indistinguishable from a mis-seeded row, which is exactly why cronInstrumentation.ts logs instead of returning silently
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_activity_log
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- POST /api/admin/ai-ops/registry/:id/control
- PATCH /api/admin/ai-ops/agents/:id
**Source modules**
- backend/src/services/aiOpsService.ts
- backend/src/routes/admin/aiOpsRoutes.ts
**Dependencies**
- platform.agent_registry_read_surface
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Turning a live timer off is explicitly a human decision in this domain's brief. The agent's ceiling is therefore answering from records and recommending — it may say 'this agent should be stopped and here is why', and a human performs the stop. R2 is the highest rung that involves no state change.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Recommends a disable with the evidence that justifies it, and names every timer the disable would stop.

Acceptance: A recommendation for a shared agent_name lists all timers that share it; a recommendation for an unregistered name states that no disable flag exists for it rather than proposing one.
## Before you start
- Disabling a live timer is a human decision; an agent never holds this control even at the top of its ladder
- The write lands in production ai_agents; production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation)
- manager_has_no_admin_login: Kesetebirhan Delele, the human who should hold this control for the platform domain, cannot reach the endpoint (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:72)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:72 POST /api/admin/ai-ops/registry/:id/control
- backend/src/services/aiOpsService.ts:253-275 controlAgent with actions pause, resume, enable, disable
- backend/src/services/aiOpsService.ts:77 updateAgent
- backend/src/services/cronInstrumentation.ts:46-52 a disabled or paused row skips the run and logs event 'cron_job_skipped_disabled'
- frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx:134 control call

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A recommendation for a shared agent_name lists all timers that share it; a recommendation for an unregistered name states that no disable flag exists for it rather than proposing one.

When every box above is ticked, stop and show the demo.
