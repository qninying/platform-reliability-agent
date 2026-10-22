# platform.CAP.manager_restriction_directives — Manager restriction directives

The accountable human can narrow what his agent may do, at any time, without a deploy — and cannot accidentally widen it, so management is a safety lever rather than a second grant path.

**Built today:** unknown. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Writing a directive is the manager's action by definition; the agent never holds it
- manager_has_no_admin_login: Kesetebirhan Delele cannot issue a directive through any surface today
- Implementation state is unknown: the enforcement path for directives was not verified in this read-only task and must be measured before this capability is treated as existing

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Manager restriction directives
**Domain:** Platform Automation & Reliability · **Capability:** `platform.manager_restriction_directives`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** unknown · **Source:** manager_defined
## The business outcome
The accountable human can narrow what his agent may do, at any time, without a deploy — and cannot accidentally widen it, so management is a safety lever rather than a second grant path.
Intended users: Kesetebirhan Delele.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The manager writes a directive against a specific agent or capability
- The directive is authorised against his real management relationship, server-side
- The directive is applied only in the narrowing direction, and a widening directive is refused with a reason
- The effective behaviour and the directive that produced it are both readable
**Inputs**
- a directive from the accountable manager
- the target agent or capability
- the current approved authority
**Outputs**
- a stored directive that narrows behaviour
- a refusal when a directive would widen authority
**Exceptions that must be handled**
- A directive that appears to widen authority must be refused rather than partially applied, or the one-way property is lost
- A directive stored but not enforced at runtime is worse than no directive, because it reads as a control that is not one
- Marked unknown because whether a ManagerDirective table and enforcement path exist on main was not measured in this read-only task — the design is documented as proposed and one status document declares itself stale
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_approval_records
- read_agent_registry
**Application surfaces**
- /admin/intelligence
**Source modules**
- backend/src/services/agentDomain/autonomyLadder.ts
**Dependencies**
- platform.manager_scoped_authorization
- platform.capability_autonomy_authority_resolution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: A directive is the manager's instrument for constraining the agent. An agent that could write directives could write its own constraints, which inverts the control. Its ceiling is reading and explaining the directives in force.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Explains which directives are in force for a given capability and what each one narrows.

Acceptance: A directive with no runtime enforcement path is reported as recorded-but-unenforced, not as in force.
## Before you start
- Writing a directive is the manager's action by definition; the agent never holds it
- manager_has_no_admin_login: Kesetebirhan Delele cannot issue a directive through any surface today
- Implementation state is unknown: the enforcement path for directives was not verified in this read-only task and must be measured before this capability is treated as existing
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- docs/architecture/ai-workforce-management/MANAGER_AUTHORIZATION_MAP.md:3 'manager instructions may only RESTRICT an agent, never expand its authority'
- docs/architecture/ai-workforce-management/MANAGER_AUTHORIZATION_MAP.md:36 'shipping any new manager-facing write capability gated only on requireAdmin would let any admin act as if they manage every agent'
- docs/architecture/ai-workforce-management/TARGET_ARCHITECTURE.md — ManagerDirective among the proposed models keyed to real ai_agents.id and org_members.id
- backend/src/services/agentDomain/autonomyLadder.ts:149-153 'A ceiling can only ever LOWER the result' — the same one-way property, already enforced for autonomy ceilings

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A directive with no runtime enforcement path is reported as recorded-but-unenforced, not as in force.

When every box above is ticked, stop and show the demo.
