# platform.CAP.scheduler_liveness_watch — Scheduler and agent liveness watch

**CANDIDATE -- not started, not assigned.** This is one line on this domain's list of everything its agent could eventually do. It becomes real work only when the builder picks it and their manager agrees, at which point it opens as four stories. Until then it is deliberately inert, and the honest status of it is "not started" rather than "behind".

Somebody is told when a scheduled agent stops running, instead of the silence being mistaken for health.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm which agents are in scope, what counts as late for each cadence, and who is woken; he has no admin login today

**Blocked by**
- manager_has_no_admin_login: Kesetebirhan Delele cannot reach /api/admin/ai-ops/* to confirm scope, because every route there is gated by requireAdmin (backend/src/routes/admin/aiOpsRoutes.ts:44-82)
- tolerance_undefined: what counts as late is not recorded anywhere for any agent, so the check cannot be specified until an owner sets it per cadence

Full build prompt is attached to this story.

**Release:** autonomy:R0 · Legacy migration plan (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Scheduler and agent liveness watch
**Domain:** Platform Automation & Reliability · **Capability:** `platform.scheduler_liveness_watch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Somebody is told when a scheduled agent stops running, instead of the silence being mistaken for health.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Read every entry in SCHEDULE_REGISTRY and pair it with its ai_agents row
- For each enabled agent, compute the expected next run from its cron expression and its last_run_at
- Classify the agent as on time, late, or silent against a per-cadence tolerance
- Raise an alert for each silent agent, once per silence rather than once per check
- Record the verdict so repeated silence is distinguishable from a first miss
**Inputs**
- SCHEDULE_REGISTRY entries (agent name, cron expression)
- ai_agents rows (schedule, enabled, last_run_at)
- ai_agent_activity_logs rows (per-run outcome and timestamp)
**Outputs**
- a liveness verdict per scheduled agent: ran on time, late, or silent
- an alert that reaches a person when an enabled agent is silent past its tolerance
- an activity-log row recording the check itself, so the watcher is auditable
**Exceptions that must be handled**
- A disabled or paused agent is expected to be silent and must not alert
- A timer with no ai_agents row cannot be measured at all; that absence is itself the finding and must be reported, not skipped
- A newly registered agent has no last_run_at and must not alert until it has had one full interval to run
- Alerting has to be idempotent: a persistently silent agent produces one alert, not one every five minutes
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_cron_run_logs
- read_activity_log
- escalate_to_human
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/registry
- GET /api/admin/ai-ops/activity
**Source modules**
_none recorded_
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Read-and-report over scheduler records, plus a notification. Shadow evaluation against an approved reference verdict is the highest rung that needs no new production side effect; acting on a silent agent, such as restarting it, is platform.orchestration_auto_repair's job and not this one's.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which scheduled agents have not run when they should have' from the registry and activity log, and does nothing else.

Acceptance: Every answer cites the ai_agents row and the activity-log rows behind it; an agent with no ai_agents row is reported as unmeasurable rather than omitted or assumed healthy.
## Before you start
- manager_has_no_admin_login: Kesetebirhan Delele cannot reach /api/admin/ai-ops/* to confirm scope, because every route there is gated by requireAdmin (backend/src/routes/admin/aiOpsRoutes.ts:44-82)
- tolerance_undefined: what counts as late is not recorded anywhere for any agent, so the check cannot be specified until an owner sets it per cadence
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/agents/orchestrationHealthAgent.ts:1-124 — the agent historically credited with this check reads no scheduler state: not SCHEDULE_REGISTRY, not ai_agents, not ai_agent_activity_logs
- backend/src/services/agents/orchestrationHealthAgent.ts:101-110 — the activity log is written to (one finding action per finding) and never read, so a missed run leaves no signal this code would notice
- Quincy Ninying, L1 run log 2026-11-14: 'at the moment nothing checks that the scheduler and the agents are running, although the record says something does'
- ABSENCE EVIDENCE: no module in backend/src was found that compares a scheduled agent's last_run_at against its cron expression and raises on the difference

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.


When every box above is ticked, stop and show the demo.
