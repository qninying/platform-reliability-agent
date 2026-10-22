# platform.CAP.system_health_probe_and_alerting — System health probes and alerting

The platform's liveness, database, memory, email and third-party dependencies are checked on a schedule and a critical result reaches a human, so an outage is announced rather than noticed.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because the public liveness probe cannot detect a fully unregistered scheduler, which is the domain's single largest silent-failure mode
- live_email is default-denied (executionPolicy.ts:33-42), so the agent never sends the health alert
- Changing the business-hours window or the cooldown is a monitoring-policy decision for Kesetebirhan Delele

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# System health probes and alerting
**Domain:** Platform Automation & Reliability · **Capability:** `platform.system_health_probe_and_alerting`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
The platform's liveness, database, memory, email and third-party dependencies are checked on a schedule and a critical result reaches a human, so an outage is announced rather than noticed.
Intended users: Kesetebirhan Delele, Ali Muwwakkil, external uptime monitoring.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- External monitoring polls GET /health continuously
- The health monitor cron runs the full check inside its business-hours window
- Each subsystem is checked and an overall status derived
- A critical result raises an alert, subject to a two-hour cooldown
**Inputs**
- database connectivity
- scheduler heartbeat age
- process uptime and memory
- third-party dependency responses
**Outputs**
- a health verdict per check
- an overall status
- alert email and, for some criticals, a voice call
**Exceptions that must be handled**
- GET /health only pings the database, so it returns 200 while every cron in the platform is unregistered — the liveness probe cannot see the scheduler at all
- A single unset environment variable prevents startScheduler from running, and it is the only caller of the AI Ops scheduler, so one missing variable silently stops every timer in both schedulers while /health stays green
- The monitor runs in a weekday business-hours window, so a weekend failure is not alerted by this path
- A two-hour cooldown means a flapping critical is reported at most twelve times a day regardless of how often it flaps
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_cron_run_logs
- emit_alert
**Application surfaces**
- /admin/trust
- /admin/intelligence
- GET /health
- GET /health/full
- GET /api/admin/system-health
**Source modules**
- backend/src/routes/healthRoutes.ts
- backend/src/services/systemHealthService.ts
- backend/src/services/schedulerService.ts
- backend/src/config/env.ts
**Dependencies**
- platform.cron_health_alerting
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Probing and judging health is read-only and reaches shadow comparison against approved reference verdicts. Sending the alert stays with the deterministic service because live_email is default-denied, so no rung lets the agent page a human itself.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports current health per subsystem and states which failure modes the probes cannot see.

Acceptance: The report explicitly names 'scheduler never registered' as undetectable by GET /health — a disclosure the probe itself cannot make.
## Before you start
- Marked partial because the public liveness probe cannot detect a fully unregistered scheduler, which is the domain's single largest silent-failure mode
- live_email is default-denied (executionPolicy.ts:33-42), so the agent never sends the health alert
- Changing the business-hours window or the cooldown is a monitoring-policy decision for Kesetebirhan Delele
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/healthRoutes.ts:7 GET /health — database SELECT 1, 200 or 503, documented at :5-6 as the UptimeRobot and Pingdom target
- backend/src/routes/healthRoutes.ts:18 GET /health/full, returning 503 when overall_status is critical at :22
- backend/src/services/systemHealthService.ts:440 runFullSystemHealthCheck; scheduler liveness via heartbeat age at :135; database connectivity, connection count and long queries at :171-209; uptime and memory pressure at :214-242; email delivery at :247; third-party dependencies at :285-406; nginx at :414
- backend/src/services/schedulerService.ts:3252-3357 SystemHealthMonitor cron, weekday business-hours window at :3254-3256, two-hour alert cooldown at :3281-3289
- backend/src/routes/admin/aiOpsRoutes.ts:204 GET /api/admin/system-health
- backend/src/config/env.ts:168 enableFollowUpScheduler from ENABLE_FOLLOWUP_SCHEDULER; backend/src/server.ts:3462-3464 startScheduler() runs only under that flag, and schedulerService.ts:3428-3431 is the only caller of startAIOpsScheduler()

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The report explicitly names 'scheduler never registered' as undetectable by GET /health — a disclosure the probe itself cannot make.

When every box above is ticked, stop and show the demo.
