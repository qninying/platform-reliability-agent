# platform.CAP.schedule_governance_live_reload — Schedule governance and live reload

An agent's cron schedule can be changed or disabled from a governance screen and take effect without a restart, so a runaway cadence is corrected immediately.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Changing or disabling a live timer is a human decision; the agent never holds the PATCH
- The write lands in the production cron_schedule_configs table; production_database is default-denied (executionPolicy.ts:33-42)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open /admin/governance (requireAdmin) to apply or review a schedule change

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Schedule governance and live reload
**Domain:** Platform Automation & Reliability · **Capability:** `platform.schedule_governance_live_reload`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** existing_application
## The business outcome
An agent's cron schedule can be changed or disabled from a governance screen and take effect without a restart, so a runaway cadence is corrected immediately.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An authorised human edits a schedule or toggles enabled on /admin/governance
- The PATCH writes cron_schedule_configs and calls applyScheduleChange
- reloadAIOpsSchedules groups live tasks by agent name and stops, starts or reschedules each one
- The route returns applied with whether the change took effect live
**Inputs**
- agent_name
- a cron expression or an enabled flag
- acting admin identity
**Outputs**
- updated cron_schedule_configs row
- a ScheduleReloadResult
- an applied summary of live and action
**Exceptions that must be handled**
- A missing cron_schedule_configs row means enabled defaults to true at all three resolution points, so adding a registry entry turns its timer on by default — the single most consequential default in this domain
- Only timers held in the aiOps task registry can be reloaded; the roughly seventy jobs registered inline in schedulerService.ts keep no task handle and cannot be reloaded or disabled this way at all
- The UI tells the operator a restart is needed while the backend reports whether the change went live, so the screen understates its own power — a softer version of the silent-toggle failure the reload machinery was built to fix
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_cron_run_logs
- compose_report_draft
**Application surfaces**
- /admin/governance
- GET /api/admin/governance-center/schedules
- GET /api/admin/governance-center/schedules/resolved
- PATCH /api/admin/governance-center/schedules/:agentName
- POST /api/admin/governance-center/schedules/:agentName/reset
**Source modules**
- backend/src/routes/admin/governanceCenterRoutes.ts
- backend/src/services/aiOpsScheduler.ts
- backend/src/models/CronScheduleConfig.ts
- frontend/src/pages/admin/GovernanceCommandCenter.tsx
**Dependencies**
- platform.agent_enable_disable_control
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Changing a live schedule or disabling a live timer is a human decision by this domain's own rule. The agent may propose a cadence change with the cost and signal evidence behind it; a human applies it. R2 is the ceiling because every rung above involves touching the live schedule.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Proposes schedule changes with the measured run cost and signal rate behind each, and states for each whether it is reloadable or restart-only.

Acceptance: Every proposal says whether the target is in the reloadable aiOps registry or inline in schedulerService.ts, because the two have different remedies; a proposal with an unknown home is labelled unknown.
## Before you start
- Changing or disabling a live timer is a human decision; the agent never holds the PATCH
- The write lands in the production cron_schedule_configs table; production_database is default-denied (executionPolicy.ts:33-42)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open /admin/governance (requireAdmin) to apply or review a schedule change
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/governanceCenterRoutes.ts:132 GET schedules, :141 GET schedules/resolved, :151 PATCH schedules/:agentName, :181 POST schedules/:agentName/reset
- backend/src/routes/admin/governanceCenterRoutes.ts:42-62 applyScheduleChange dynamically imports reloadAIOpsSchedules and degrades to live:false, action:'failed' rather than throwing
- backend/src/services/aiOpsScheduler.ts:587 reloadAIOpsSchedules, :151-156 ScheduleReloadResult { started, stopped, rescheduled, unchanged }
- backend/src/services/aiOpsScheduler.ts:628 enabled = dbEntry?.enabled ?? true in the reload path; also :729 (standard boot loop) and :748 (dynamic boot loop)
- backend/src/services/aiOpsScheduler.ts:590-593 the reload deliberately does not catch a DB read failure, because reconciling against an empty map would silently re-enable operator-disabled jobs
- backend/src/models/CronScheduleConfig.ts:46-50 enabled BOOLEAN NOT NULL DEFAULT true
- frontend/src/pages/admin/GovernanceCommandCenter.tsx:376 still tells the operator 'Schedule changes take effect on next server restart' and never reads the applied field the backend returns

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every proposal says whether the target is in the reloadable aiOps registry or inline in schedulerService.ts, because the two have different remedies; a proposal with an unknown home is labelled unknown.

When every box above is ticked, stop and show the demo.
