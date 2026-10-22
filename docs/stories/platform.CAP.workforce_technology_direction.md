# platform.CAP.workforce_technology_direction — Workforce technology direction

The technology direction of the agent workforce is reviewed four times an hour so tooling and platform choices for the fleet stay coherent rather than accreting per agent.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Technology direction decisions are escalation boundaries under CLAUDE.md Autonomy Model (AI model class changes, external dependency introduction, cost model shifts)
- manager_has_no_admin_login: Kesetebirhan Delele is the human this chain reports to, and he cannot open the surface it reports into (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:70)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Workforce technology direction
**Domain:** Platform Automation & Reliability · **Capability:** `platform.workforce_technology_direction`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
The technology direction of the agent workforce is reviewed four times an hour so tooling and platform choices for the fleet stay coherent rather than accreting per agent.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires four times an hour on a staggered offset
- runTechnologyDirector is lazily imported and invoked
- Fleet tooling and capability state is assessed against the intended direction
- Recommendations are recorded against the workforce reporting chain that terminates at Kesetebirhan Delele
**Inputs**
- fleet tooling inventory
- agent capability and grant records
- workforce intelligence output
**Outputs**
- technology direction decisions and recommendations
- director action records
**Exceptions that must be handled**
- A direction decision that changes which model class the fleet uses is an escalation under CLAUDE.md, not a director action
- Four runs an hour on a direction-setting job is a cadence mismatch worth questioning: direction does not change every fifteen minutes, and the cost of the run does not vanish because the output is unchanged
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_health_metrics
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/registry
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/services/workforce/directorActions.ts
**Dependencies**
- platform.agent_identity_attribution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Setting the fleet's technology direction is a strategic decision — CLAUDE.md names AI model class changes and external dependency introduction as escalation boundaries. human_decision is true, and autonomyLadder.ts:170-176 caps such a capability at autonomy:R5.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'what tooling does the fleet hold, and where does it diverge from the intended direction' from registry records.

Acceptance: Divergence is reported against a written intended direction; with no written direction on file, the answer is 'unknown', not 'no divergence'.
## Before you start
- Technology direction decisions are escalation boundaries under CLAUDE.md Autonomy Model (AI model class changes, external dependency introduction, cost model shifts)
- manager_has_no_admin_login: Kesetebirhan Delele is the human this chain reports to, and he cannot open the surface it reports into (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:70)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:379 { agentName: 'WorkforceTechnologyDirector', hardcodedSchedule: '7,22,37,52 * * * *', runner: async () => { const { runTechnologyDirector } = await import('./workforce/directorActions'); return runTechnologyDirector(); } }
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:116 'now reports through workforce_intelligence_engine (AI Leadership), which itself still reports to Kes'
- legacy-slices/platform.json cited aiOpsScheduler.ts:348 — stale; real line 379

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Divergence is reported against a written intended direction; with no written direction on file, the answer is 'unknown', not 'no divergence'.

When every box above is ticked, stop and show the demo.
