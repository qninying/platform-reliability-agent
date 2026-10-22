# platform.CAP.agent_behavior_safety_watch — Agent behaviour and AI-safety watch

The agent fleet's own behaviour is policed on a sub-hourly cadence so an agent acting outside its remit is caught by the platform instead of by its blast radius.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Acting on a finding by disabling the offending agent is a live-timer change and is human-decided (see platform.agent_enable_disable_control)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the agent detail surface where findings land (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:71)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent behaviour and AI-safety watch
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_behavior_safety_watch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
The agent fleet's own behaviour is policed on a sub-hourly cadence so an agent acting outside its remit is caught by the platform instead of by its blast radius.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Both timers fire on offset sub-hourly schedules so they do not collide
- Recent agent actions are compared against each agent's granted tools and declared remit
- An action outside remit is recorded with the agent, the action and the grant it lacked
- A [Security] ticket is created under the monitor's own registered identity
**Inputs**
- agent activity logs
- tool grants per agent
- ticket creation ledger
**Outputs**
- [Security] tickets
- behaviour findings
- activity-log rows
**Exceptions that must be handled**
- A finding against an agent name that carries no ai_agents row cannot be attributed and must be reported as unattributable rather than dropped
- The monitor must not police itself into a loop: its own ticket creation is excluded from its input
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_activity_log
- read_agent_registry
- create_ticket
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/activity
- GET /api/admin/ai-ops/registry/:id
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts
**Dependencies**
- platform.agent_identity_attribution
- platform.security_oversight_rollup
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R6**.
Why that ceiling: It already writes tickets in production today, so a production pilot rung is the honest ceiling. R7 is withheld because 'stop that agent' is the obvious next action and it is a live-timer change, which stays human-decided under platform.agent_enable_disable_control.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which agents acted outside their grants recently' from the activity log and grant records.

Acceptance: Every finding names the specific grant that was missing; a finding with no named grant is not emitted.
## Before you start
- Acting on a finding by disabling the offending agent is a live-timer change and is human-decided (see platform.agent_enable_disable_control)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the agent detail surface where findings land (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:71)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:335 AgentBehaviorMonitorAgent '5,15,25,35,45,55 * * * *'
- backend/src/services/aiOpsScheduler.ts:334 AISafetyMonitorAgent '2,7,12,17,22,27,32,37,42,47,52,57 * * * *'
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:186-198 AgentBehaviorMonitorAgent was found 'creating [Security] tickets under raw, unregistered UUID b95d1700-1a2d-49d0-a8d0-a5859afd360a (matched no admin_users row)' and now reports through workforce_intelligence_engine

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every finding names the specific grant that was missing; a finding with no named grant is not emitted.

When every box above is ticked, stop and show the demo.
