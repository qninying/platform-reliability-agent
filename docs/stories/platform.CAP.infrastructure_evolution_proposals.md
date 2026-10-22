# platform.CAP.infrastructure_evolution_proposals — Infrastructure and platform evolution proposals

The platform's own architecture is reviewed every six hours and improvement proposals are drafted for a human to accept or reject, so technical debt is surfaced as reviewable work rather than noticed during an incident.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Adopting a proposal is a strategic decision reserved to a human under CLAUDE.md Autonomy Model (architecture layer structure, cross-module dependency shifts, large refactors)
- manager_has_no_admin_login: the manager who should accept or reject these proposals cannot open the surface that holds them (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:70)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Infrastructure and platform evolution proposals
**Domain:** Platform Automation & Reliability · **Capability:** `platform.infrastructure_evolution_proposals`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
The platform's own architecture is reviewed every six hours and improvement proposals are drafted for a human to accept or reject, so technical debt is surfaced as reviewable work rather than noticed during an incident.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Each architect fires on its own six-hourly offset
- Department and platform health is evaluated for improvement opportunities
- An opportunity is written up as an initiative with its rationale
- Initiative tickets are generated for a human to accept, defer or reject
**Inputs**
- department health signals
- platform state and defect records
- existing initiatives
**Outputs**
- strategic initiative records
- initiative tickets
- proposal rationale
**Exceptions that must be handled**
- A proposal is a proposal: none of these three may implement what they propose, and the registry grant deliberately contains no execution tool
- Re-proposing an initiative that already exists in open or rejected state is queue noise, so existing initiatives are checked first
- The three legacy rows have reports_to and tools_granted but no system_prompt or persona_version, so none of them meets the employee rule — they are behaviours under this capability, not employees
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_source_tree
- create_ticket
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/registry
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/services/agentRegistrySeed.ts
**Dependencies**
- platform.agent_ticket_auto_resolution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Whether an architectural proposal is adopted is a governance decision, which CLAUDE.md lists as an escalation boundary. human_decision is therefore true, and autonomyLadder.ts:170-176 caps a human-decision capability at autonomy:R5 in code — this value matches that cap rather than asserting a higher one.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'what has been proposed, what is its rationale, and what happened to it' from initiative records.

Acceptance: Each proposal's current state is one of open, accepted, deferred or rejected; a proposal with no recorded outcome reads as open, not as accepted.
## Before you start
- Adopting a proposal is a strategic decision reserved to a human under CLAUDE.md Autonomy Model (architecture layer structure, cross-module dependency shifts, large refactors)
- manager_has_no_admin_login: the manager who should accept or reject these proposals cannot open the surface that holds them (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:70)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:321 InfrastructureEvolutionArchitect '22 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:315 OrchestrationEcosystemArchitect '10 */6 * * *'
- backend/src/services/aiOpsScheduler.ts:322 PlatformInnovationArchitect '24 */6 * * *'
- backend/src/services/agentRegistrySeed.ts:1812 tools_granted ['evaluate_department_health','identify_strategic_opportunities','create_strategic_initiative','generate_initiative_tickets','llm_strategy_analysis'] — the Architect grant shape

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Each proposal's current state is one of open, accepted, deferred or rejected; a proposal with no recorded outcome reads as open, not as accepted.

When every box above is ticked, stop and show the demo.
