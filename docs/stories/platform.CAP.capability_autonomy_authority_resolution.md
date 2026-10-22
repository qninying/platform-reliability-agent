# platform.CAP.capability_autonomy_authority_resolution — Per-capability autonomy authority resolution

Each capability's effective authority is computed from its own approved level, its tool grants, its environment and whether a human must decide — so one capability's progress can never widen another's or the agent's.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Granting or raising an approved autonomy level is a recorded human decision; Kesetebirhan Delele holds it for this domain and Ali Muwwakkil for anything crossing a governance boundary
- No capability in this file has an approved_autonomy yet, so effectiveAuthority returns null for all of them until the manager records one

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Per-capability autonomy authority resolution
**Domain:** Platform Automation & Reliability · **Capability:** `platform.capability_autonomy_authority_resolution`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
Each capability's effective authority is computed from its own approved level, its tool grants, its environment and whether a human must decide — so one capability's progress can never widen another's or the agent's.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- A capability's approved level is validated as a namespaced stage
- The max_permitted ceiling is applied, and can only lower the result
- Zero tool grants cap the result at R2; production at or above R6 is flagged as needing separate pilot approval
- A human_decision capability is capped below automation and the reason recorded
**Inputs**
- capability_id
- approved_autonomy
- max_permitted_autonomy
- granted_tools
- environment
- human_decision
**Outputs**
- effective_autonomy or null
- the reasons that produced it
**Exceptions that must be handled**
- A bare R3 must never be stored: in the platform's risk vocabulary R3 means schema_security_or_external_side_effect, so a bare value reads as authorising schema, security or external side effects — a misread in the dangerous direction
- Three autonomy-shaped vocabularies coexist: this R0-R9 ladder, the R0-R5 delivery risk tiers, and ai_agents.autonomy_level which defaults to 'observe'. Nothing reconciles them
- An approved_autonomy that is not a valid stage yields null effective authority, not a default — absence of approval is not a low approval
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_approval_records
- read_agent_registry
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/agentDomain/autonomyLadder.ts
- backend/src/services/agentDomain/agentDomainRegistry.ts
**Dependencies**
- platform.execution_policy_enforcement
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: An agent that could raise its own approved level would make the whole ladder decorative. Approval is never inferred from behaviour — it is a recorded human decision — so the ceiling is answering questions about what is currently approved.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'what is this capability's effective authority today and which constraint is binding' from recorded approvals and grants.

Acceptance: A capability with no recorded approval returns null with reason no_approved_autonomy, never a defaulted rung; and a human_decision capability never resolves above autonomy:R5.
## Before you start
- Granting or raising an approved autonomy level is a recorded human decision; Kesetebirhan Delele holds it for this domain and Ali Muwwakkil for anything crossing a governance boundary
- No capability in this file has an approved_autonomy yet, so effectiveAuthority returns null for all of them until the manager records one
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/agentDomain/autonomyLadder.ts:43-55 AUTONOMY_LEVELS R0-R9, AUTONOMY_NAMESPACE 'autonomy:', AUTONOMY_STAGES
- backend/src/services/agentDomain/autonomyLadder.ts:58-69 AUTONOMY_MEANINGS, the ten rungs in the owner's words
- backend/src/services/agentDomain/autonomyLadder.ts:91-93 isBareAutonomyLevel — 'A bare R3 is exactly the value that must never be stored'
- backend/src/services/agentDomain/autonomyLadder.ts:139-177 effectiveAuthority: ceilings only lower; production at or above R6 flags production_requires_separate_pilot_approval; zero tool grants caps at R2; human_decision caps at R5
- backend/src/services/agentDomain/autonomyLadder.ts:130-138 'It never consults any other capability'
- backend/src/services/agentDomain/autonomyLadder.ts:76-83 RISK_TIER_BEARING_MODELS — the columns an autonomy value must never reach
- backend/src/db/ensureAiAgentAutonomyLevelSchema.ts:39 ai_agents.autonomy_level VARCHAR(20) DEFAULT 'observe' — a THIRD, unrelated four-value vocabulary

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A capability with no recorded approval returns null with reason no_approved_autonomy, never a defaulted rung; and a human_decision capability never resolves above autonomy:R5.

When every box above is ticked, stop and show the demo.
