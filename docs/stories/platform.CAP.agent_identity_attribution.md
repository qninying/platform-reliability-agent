# platform.CAP.agent_identity_attribution — Agent identity and reporting-chain attribution

Every action an agent takes resolves to a real identity with a real human above it, so no ticket, email or record is attributable only to a raw string or an unrecognised UUID.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today — and he is himself the terminal human in this domain's chain, so his confirmation is structurally required

**Blocked by**
- Changing a reports-to target is a recorded human decision; the existing chain was set by a direct founder exchange, not derived
- Creating an admin_users row for an unattributable identity touches production; production_database is default-denied (executionPolicy.ts:33-42)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent identity and reporting-chain attribution
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_identity_attribution`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
Every action an agent takes resolves to a real identity with a real human above it, so no ticket, email or record is attributable only to a raw string or an unrecognised UUID.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The identity seed supplies config for each registered ticket-creator process
- The generic identity seeder links the identity quad, requiring the AiAgent registry row to exist first
- legacyCreatorIds let read-side queries match historical tickets without rewriting them
- The chain walker resolves each agent upward to the accountable human
**Inputs**
- agent_name
- the AdminUser, Enrollment, CommunityMember and AiAgent identity quad
- legacyCreatorIds
- reports-to targets
**Outputs**
- a resolvable display name per actor
- a reporting chain terminating at a real org_members row
- ticket attribution matching either the AdminUser id or a historical raw string
**Exceptions that must be handled**
- An identity row without a system_prompt or persona_version does not meet the employee rule, which is why the three identity-only rows in this domain's legacy slice are neither schedules nor tools
- An agent creating records under a raw UUID that matches no admin_users row is unattributable — the defect this seed was written to fix, found in this domain's own security watchdog
- workforce_intelligence_engine was recorded as enabled=false while five agents reported through it, so a chain can resolve through a disabled intermediary and still look valid
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_audit_log
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/registry/:id
**Source modules**
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts
- backend/src/services/orgChartHierarchyService.ts
- backend/src/models/AiAgent.ts
**Dependencies**
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Who an agent reports to is an accountability decision made by the founder and recorded in the seed, not something an agent may adjust. The ceiling is answering questions about the current chain and naming where it is broken.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'who is accountable for this agent, through what chain, and is every link enabled' from identity and chain records.

Acceptance: A chain passing through a disabled intermediary is reported as resolving-but-degraded, not as resolved; and an actor id matching no admin_users row is reported as unattributable.
## Before you start
- Changing a reports-to target is a recorded human decision; the existing chain was set by a direct founder exchange, not derived
- Creating an admin_users row for an unattributable identity touches production; production_database is default-denied (executionPolicy.ts:33-42)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:20 ORG_MEMBER.KES = '3df017df-affa-49ab-884f-a99a4bd2ef4e'
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:144-153 workforce_intelligence_engine, role ai_staff, reportsToOrgMemberId ORG_MEMBER.KES — 'AI Leadership — reports directly to Kes, unchanged.'
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:132-142 InboxCaseEngine and :156-164 bpos_orchestrator both report through workforce_intelligence_engine
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:52-58 historical ticket volume verified live against production: 9,606 + 1,401 + 815 + 433 + 47 = 12,302 tickets stamped with the raw agentName as created_by_id, 100% NULL assigned_to_id
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:186-190 AgentBehaviorMonitorAgent was creating [Security] tickets under raw UUID b95d1700-1a2d-49d0-a8d0-a5859afd360a, matching no admin_users row
- docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:41 'Kes Delele | human | 1 (workforce_intelligence_engine)'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A chain passing through a disabled intermediary is reported as resolving-but-degraded, not as resolved; and an actor id matching no admin_users row is reported as unattributable.

When every box above is ticked, stop and show the demo.
