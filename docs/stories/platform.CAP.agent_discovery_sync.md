# platform.CAP.agent_discovery_sync — Agent registry discovery sync

Newly seeded agents appear in the registry on demand, so the dashboard reflects the code without waiting for a restart.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because the endpoint's name promises discovery of what is running and it only re-reads the seed
- A discovery run can enable timers by creating rows that default to enabled; Kesetebirhan Delele must decide whether seeded rows should default off
- production_database is default-denied (executionPolicy.ts:33-42), so an agent never runs the seed against production

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent registry discovery sync
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_discovery_sync`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
Newly seeded agents appear in the registry on demand, so the dashboard reflects the code without waiting for a restart.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An admin triggers discovery from the registry tab
- AiAgent.count() is taken as a before figure
- seedAgentRegistry() runs, inserting or updating rows from the seed
- The difference in count is returned as new_agents
**Inputs**
- the AGENT_REGISTRY seed definition
**Outputs**
- total_registered
- new_agents
- synced flag
**Exceptions that must be handled**
- This discovers from the seed, not from the running timers, so it can never find a timer that has no seed row — the untracked population is invisible to it by design despite the name
- new_agents is a count difference, so a run that adds one row and removes another reports zero new agents
- Seeding a new entry creates a row whose enabled defaults to true, which is how a discovery action can turn a timer on
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_source_tree
**Application surfaces**
- /admin/intelligence
- POST /api/admin/ai-ops/discover
**Source modules**
- backend/src/services/aiOpsService.ts
- backend/src/services/agentRegistrySeed.ts
**Dependencies**
- platform.registry_runtime_reconciliation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Running discovery writes registry rows whose enabled flag defaults to true, which means a discovery run can start timers. That makes it a human action, and the agent's ceiling is reporting what a discovery run would add.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Reports which seed entries have no registry row and which rows would be created, before anything is written.

Acceptance: The report names each row that would be created and states that each would arrive enabled, so the consequence is visible before the action.
## Before you start
- Marked partial because the endpoint's name promises discovery of what is running and it only re-reads the seed
- A discovery run can enable timers by creating rows that default to enabled; Kesetebirhan Delele must decide whether seeded rows should default off
- production_database is default-denied (executionPolicy.ts:33-42), so an agent never runs the seed against production
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:81 POST /api/admin/ai-ops/discover
- backend/src/services/aiOpsService.ts:413-426 scanAndDiscoverAgents: counts before, re-runs seedAgentRegistry, counts after, returns total_registered and new_agents
- frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx:148 scan call

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The report names each row that would be created and states that each would arrive enabled, so the consequence is visible before the action.

When every box above is ticked, stop and show the demo.
