# platform.CAP.agent_promotion_and_approval_decision — Agent promotion and approval decision

An agent's authority increases only when a named human decides it has earned it against evidence, so autonomy is granted deliberately rather than accumulated by elapsed time or passing tests.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Promotion is a human decision at every rung, permanently; no evidence quality changes that
- This domain has no AI employee yet — agent_id is null in the domain registry — so there is no agent to promote and nothing in this file has an approved level
- manager_has_no_admin_login: Kesetebirhan Delele has no surface on which to record a promotion decision
- No timeout-based auto-approval may stand in for him, per the approval-drop audit finding

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent promotion and approval decision
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_promotion_and_approval_decision`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** manager_defined
## The business outcome
An agent's authority increases only when a named human decides it has earned it against evidence, so autonomy is granted deliberately rather than accumulated by elapsed time or passing tests.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Evidence for one capability at one rung is assembled
- The accountable human reviews it against that rung's acceptance criteria
- A decision is recorded against that capability alone
- A production rung is approved separately from any sandbox rung, never carried over
**Inputs**
- one capability's acceptance evidence
- its current approved level
- the environment the promotion targets
**Outputs**
- a recorded promotion decision per capability
- an unchanged level where evidence is insufficient
**Exceptions that must be handled**
- An auto-approval on a timeout is not an approval — it is the specific defect the approval-drop audit found, where approved actions were marked performed when they were not
- Promotion is per capability: approving one capability at a high rung must not raise another's or the agent's overall authority
- A promotion based on passing mocked tests promotes nothing, because mocks prove the test, not the behaviour
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_approval_records
- read_activity_log
- compose_report_draft
**Application surfaces**
- /admin/intelligence
**Source modules**
- backend/src/services/agentDomain/autonomyLadder.ts
- backend/src/services/agentDomain/agentDomainRegistry.ts
**Dependencies**
- platform.capability_autonomy_authority_resolution
- platform.manager_reachable_agent_surface
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: An agent that could promote itself is not governed. Its ceiling is assembling and presenting the evidence for a rung it does not grant. This is the capability that makes every other max_permitted_autonomy in this file meaningful.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Assembles the evidence for one capability at one rung and states plainly whether it meets that rung's acceptance criteria.

Acceptance: The assembly cites real run records and names any criterion with no evidence as unmet; a capability whose only evidence is a passing mocked test is reported as unproven.
## Before you start
- Promotion is a human decision at every rung, permanently; no evidence quality changes that
- This domain has no AI employee yet — agent_id is null in the domain registry — so there is no agent to promote and nothing in this file has an approved level
- manager_has_no_admin_login: Kesetebirhan Delele has no surface on which to record a promotion decision
- No timeout-based auto-approval may stand in for him, per the approval-drop audit finding
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- .loop-architect/runs/20261007-school-agent-factory/execution-contract.md:53-57 'Story completion, elapsed time, a successful conversation and passing mocked tests promote nothing.'
- .loop-architect/runs/20261007-school-agent-factory/execution-contract.md:50-52 'Autonomy is mapped per capability on the R0-R9 ladder, never per agent. One capability passing does not raise the agent's authority.'
- docs/architecture/ai-workforce-management/APPROVAL_DROP_QUEUE_2026-10-06.md:90 'The human in the loop is a timer'
- backend/src/services/agentDomain/autonomyLadder.ts:114 'The level a HUMAN has approved for this capability. Never inferred from behaviour.'
- backend/src/services/agentDomain/autonomyLadder.ts:156-159 production at or above R6 flags production_requires_separate_pilot_approval
- backend/src/services/agentDomain/agentDomainRegistry.ts:207 agent_id null — this domain has no AI employee today, so there is nothing to promote yet

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The assembly cites real run records and names any criterion with no evidence as unmet; a capability whose only evidence is a passing mocked test is reported as unproven.

When every box above is ticked, stop and show the demo.
