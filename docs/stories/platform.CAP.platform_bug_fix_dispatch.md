# platform.CAP.platform_bug_fix_dispatch — On-demand platform bug fix dispatch

A ticket typed as a bug is routed to a platform fix attempt on demand, so routine defects are picked up without a human triaging each one into a queue.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- push_to_protected_main is default-denied (executionPolicy.ts:33-42, enforcedBy branch_protection); a human merges
- production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider); a human deploys
- The bug.platform_fix predicate is 'any ticket of type bug' — Kesetebirhan Delele must state which defect classes this may attempt before any rung above R1 is meaningful

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# On-demand platform bug fix dispatch
**Domain:** Platform Automation & Reliability · **Capability:** `platform.platform_bug_fix_dispatch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
A ticket typed as a bug is routed to a platform fix attempt on demand, so routine defects are picked up without a human triaging each one into a queue.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- A ticket of type 'bug' arrives at the work-graph router
- The bug.platform_fix entry matches at specificity 1.0 and its risk ceiling is checked
- runPlatformFixAgent is invoked with the ticket id and metadata
- The attempt outcome is recorded against the ticket
**Inputs**
- a ticket of type 'bug' with title, description and metadata
**Outputs**
- fix attempt result
- ticket update
- dispatch record
**Exceptions that must be handled**
- This entry matches every ticket of type 'bug' — there is no narrower predicate, so a mistyped ticket is dispatched here regardless of content
- Its declared ceiling is maxRiskTier 'R4' in the platform risk vocabulary, which means production_release; that is a far wider grant than this capability's autonomy ceiling and the two must not be conflated
- capabilityRouter.riskTierIndex() returns 0 for an unrecognised tier, so a malformed tier on this entry would clear every ceiling as though it were read-only
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_ticket_queue
- read_source_tree
- write_sandbox_fixture
- run_sandbox_job
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/workGraph/capabilityRegistry.ts
- backend/src/services/agents/platformFixAgent.ts
**Dependencies**
- platform.execution_policy_enforcement
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: A fix becomes real only when it merges and deploys, and both push_to_protected_main and production_deploy are default-denied. The honest ceiling is a verified sandbox fix with a human taking it from there; the entry's maxRiskTier 'R4' is a risk-tier ceiling in a different vocabulary and does not raise this.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R1)**
Prepares an isolated reproduction and a baseline test for the reported defect, and changes nothing else.

Acceptance: The baseline test fails for the reported reason before any fix and is shown to fail — a test that passes before the fix proves nothing.
## Before you start
- push_to_protected_main is default-denied (executionPolicy.ts:33-42, enforcedBy branch_protection); a human merges
- production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider); a human deploys
- The bug.platform_fix predicate is 'any ticket of type bug' — Kesetebirhan Delele must state which defect classes this may attempt before any rung above R1 is meaningful
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/workGraph/capabilityRegistry.ts:87 capabilityId 'bug.platform_fix'
- backend/src/services/workGraph/capabilityRegistry.ts:89 agent_name 'PlatformFixAgent'
- backend/src/services/workGraph/capabilityRegistry.ts:91 runPlatformFixAgent(ticket.id, {...})
- backend/src/services/workGraph/capabilityRegistry.ts maxRiskTier 'R4' on this entry — a platform RISK tier, not an autonomy rung
- backend/src/services/agentRegistrySeed.ts:1088 agent_name 'PlatformFixAgent' — legacy slice cited :1075, stale

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The baseline test fails for the reported reason before any fix and is shown to fail — a test that passes before the fix proves nothing.

When every box above is ticked, stop and show the demo.
