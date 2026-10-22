# platform.CAP.emergency_stop_and_kill_switch — Emergency stop, resume and kill switch

The whole agent fleet, or the whole platform's automated output, can be halted in one action, so a systemic misbehaviour is contained without a deploy and without stopping each agent by hand.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Halting or resuming the fleet is a human decision at every autonomy rung
- The state write lands in production; production_database is default-denied (executionPolicy.ts:33-42)
- manager_has_no_admin_login: Kesetebirhan Delele cannot reach any of these endpoints (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:90-146)
- Which surface stops what is undocumented; Kesetebirhan Delele must define the containment ladder before a recommendation can name the right lever

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Emergency stop, resume and kill switch
**Domain:** Platform Automation & Reliability · **Capability:** `platform.emergency_stop_and_kill_switch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
The whole agent fleet, or the whole platform's automated output, can be halted in one action, so a systemic misbehaviour is contained without a deploy and without stopping each agent by hand.
Intended users: Ali Muwwakkil, Kesetebirhan Delele.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An authorised human issues the stop at the appropriate layer: one agent, the agent fleet, the scheduler, or the platform kill switch
- State is persisted so the halt survives a process restart
- The matching GET returns the current state so the halt is verifiable rather than assumed
- Resume is a separate, equally deliberate action
**Inputs**
- the stop or resume instruction
- acting admin identity
- optional scope
**Outputs**
- halted or resumed fleet state
- kill-switch and safe-mode state readable back
- scheduler paused flag in system_settings
**Exceptions that must be handled**
- There are at least four overlapping stop surfaces — agent control, agent-governance emergency stop, scheduler pause, and the system kill switch — and nothing documents which one actually stops what; pulling the wrong one produces a false sense of containment
- Jobs registered inline in schedulerService.ts hold no task handle, so a scheduler pause is the only lever that reaches them and a per-agent stop does not
- A resume must not silently re-enable agents a human disabled individually beforehand
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_health_metrics
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- /admin/governance
- /admin/trust
- POST /api/admin/ai-ops/emergency-stop
- POST /api/admin/ai-ops/emergency-resume
- POST /api/admin/system/kill-switch
- GET /api/admin/system/kill-switch
- POST /api/admin/scheduler/pause
**Source modules**
- backend/src/routes/admin/aiOpsRoutes.ts
- backend/src/routes/admin/schedulerControlRoutes.ts
- backend/src/routes/admin/agentGovernanceRoutes.ts
**Dependencies**
- platform.agent_enable_disable_control
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: A kill switch that an agent can pull is a kill switch an agent can pull on its own supervision. The agent's ceiling is recommending a halt with evidence; the pull is always a human's. R2 involves no state change and is therefore the only safe rung here.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Recommends a halt, names the specific lever, and states what that lever does and does not stop.

Acceptance: A recommendation that names a per-agent stop for a schedulerService-registered job is wrong and must instead name the scheduler pause — a positive control that the recommendation understands the layering.
## Before you start
- Halting or resuming the fleet is a human decision at every autonomy rung
- The state write lands in production; production_database is default-denied (executionPolicy.ts:33-42)
- manager_has_no_admin_login: Kesetebirhan Delele cannot reach any of these endpoints (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:90-146)
- Which surface stops what is undocumented; Kesetebirhan Delele must define the containment ladder before a recommendation can name the right lever
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:90 POST /api/admin/ai-ops/emergency-stop, :110 POST /api/admin/ai-ops/emergency-resume
- backend/src/routes/admin/aiOpsRoutes.ts:124 POST /api/admin/system/kill-switch, :146 GET /api/admin/system/kill-switch
- backend/src/routes/admin/aiOpsRoutes.ts:215 GET /api/admin/system/safe-mode, :225 POST /api/admin/system/safe-mode
- backend/src/routes/admin/agentGovernanceRoutes.ts:31 POST /api/admin/agents/emergency-stop, :32 resume
- backend/src/routes/admin/schedulerControlRoutes.ts:12 POST /api/admin/scheduler/pause, :13 resume, :14 status
- backend/src/services/agents/tools/agentToolRegistry.ts:29-34 AGENT_TOOLS_DISABLED env kill switch, described at :10-12 as 'a kill switch, not a feature flag'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A recommendation that names a per-agent stop for a schedulerService-registered job is wrong and must instead name the scheduler pause — a positive control that the recommendation understands the layering.

When every box above is ticked, stop and show the demo.
