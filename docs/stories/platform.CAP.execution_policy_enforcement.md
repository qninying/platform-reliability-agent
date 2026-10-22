# platform.CAP.execution_policy_enforcement — Execution policy and default-deny enforcement

The eight capabilities nobody may hold are refused at a single chokepoint, so a dangerous grant cannot be introduced by a well-meaning change in one corner of the codebase.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Altering the denied-capability set is a compliance and security boundary — an escalation under CLAUDE.md Autonomy Model, never an agent action
- The three fail-open risk-tier readers are a known defect outside this planning task's scope; fixing them is a separate workstream

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Execution policy and default-deny enforcement
**Domain:** Platform Automation & Reliability · **Capability:** `platform.execution_policy_enforcement`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
The eight capabilities nobody may hold are refused at a single chokepoint, so a dangerous grant cannot be introduced by a well-meaning change in one corner of the codebase.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- A run declares the capabilities it wants
- Each is checked against the eight default-denied capabilities
- A non-isolated runner is refused outright regardless of capability
- The decision is returned with every violation named, not just the first
**Inputs**
- a requested capability or tool set
- the run's isolation state
- the target branch
**Outputs**
- allowed or refused with the violations that caused the refusal
**Exceptions that must be handled**
- There is no global allow-list, deliberately: the repo governs tools by denial, so an undeclared capability is checked against the blueprint's own declaration rather than a catalogue
- Two risk-tier readers elsewhere fail open — agentAutonomy.isHighRiskTier returns false for an unrecognised tier, and capabilityRouter.riskTierIndex returns 0 — so a malformed tier skips approval or clears every ceiling
- Three of the eight denials previously had no enforcer at all, which is why enforcedBy is recorded per capability rather than assumed
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- read_approval_records
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/delivery/execution/executionPolicy.ts
- backend/src/modules/delivery/deliveryRiskLevels.ts
- backend/src/services/lifecycle/generation/capabilityRegistry.ts
**Dependencies**
- platform.capability_autonomy_authority_resolution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: This is the gate that bounds every other capability in the domain. An agent that could act on it could widen its own authority, so its ceiling is answering questions about the policy from the policy. Changing the denied set is a compliance and security boundary and an escalation under CLAUDE.md.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'is this capability permitted, why is it denied, and which layer enforces it' from the policy module itself.

Acceptance: A request naming production_deploy is answered as denied with enforcedBy no_provider; a positive control asserts the same request is never answered as permitted.
## Before you start
- Altering the denied-capability set is a compliance and security boundary — an escalation under CLAUDE.md Autonomy Model, never an agent action
- The three fail-open risk-tier readers are a known defect outside this planning task's scope; fixing them is a separate workstream
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/delivery/execution/executionPolicy.ts:33-42 DENIED_CAPABILITIES: production_deploy, production_database, dns, live_email, cloud_resource_deletion, push_to_protected_main, unbounded_network, secret_exfiltration
- backend/src/services/delivery/execution/executionPolicy.ts:50-83 DENIAL_RATIONALE with enforcedBy runner_isolation | no_provider | branch_protection | policy_gate, and the note at :45-48 that 'we have a policy' and 'the policy is enforced' are different claims
- backend/src/services/delivery/execution/executionPolicy.ts:103 PROTECTED_BRANCH = 'main'
- backend/src/services/delivery/execution/executionPolicy.ts:168-173 decideExecutionPolicy returns allowed only when violations is empty
- backend/src/modules/delivery/deliveryRiskLevels.ts:50 R3 = schema_security_or_external_side_effect — a RISK tier, not an autonomy rung
- backend/src/modules/delivery/deliveryRiskLevels.ts:61-65 an unrecognised risk value returns the highest rank, failing closed

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A request naming production_deploy is answered as denied with enforcedBy no_provider; a positive control asserts the same request is never answered as permitted.

When every box above is ticked, stop and show the demo.
