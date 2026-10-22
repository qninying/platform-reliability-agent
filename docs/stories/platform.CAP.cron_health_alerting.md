# platform.CAP.cron_health_alerting — Cron health alerting

A scheduled job that has started failing or has stopped running raises an alert on its own, so a silently dead job is caught in hours rather than discovered weeks later.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today — and the thresholds are already recorded as his discretion, so this capability is validated by him twice over

**Blocked by**
- Marked partial because the detector is structurally blind to unregistered, disabled and phantom crons, which is where the known reliability gap actually lives
- live_email is default-denied (executionPolicy.ts:33-42), so an agent never sends the alert itself even where the alert is correct
- manager_has_no_admin_login: the thresholds are recorded as Kesetebirhan Delele's discretion, yet he cannot open the surface that shows their effect (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:55)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Cron health alerting
**Domain:** Platform Automation & Reliability · **Capability:** `platform.cron_health_alerting`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
A scheduled job that has started failing or has stopped running raises an alert on its own, so a silently dead job is caught in hours rather than discovered weeks later.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The evaluator runs four times an hour from schedulerService
- For each enabled cron agent, the last ten run results and the last_run_at are fetched
- Error rate is evaluated once a minimum sample of five runs exists; overdue is evaluated against the cron's own expected interval
- Each resulting alert is emitted with the agent id and the numbers that triggered it, and a failure for one agent does not stop the rest
**Inputs**
- ai_agents rows where trigger_type is cron and enabled is true
- the last ten activity-log results per agent
- each agent's cron expression
**Outputs**
- warning and critical alerts for error spikes
- warning and critical alerts for missed runs
- alert metadata carrying error rate, overdue multiplier and last error
**Exceptions that must be handled**
- The query filters to trigger_type cron and enabled true, so an agent with no row, a disabled row, or a non-cron trigger_type produces zero signal — the drift classes that matter most are invisible to it by construction
- An agent with fewer than five recorded runs is never error-rate alerted, so a job that fails from its first run stays quiet until it has five
- A phantom cron whose last_run_at is null cannot be overdue, so the 19 enabled phantom crons render as live and alert on nothing
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_activity_log
- emit_alert
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/health
- GET /api/admin/ai-ops/health/agents
**Source modules**
- backend/src/services/cronHealthAlertService.ts
- backend/src/utils/cronNextRun.ts
- backend/src/services/alertService.ts
**Dependencies**
- platform.cron_run_instrumentation
- platform.registry_runtime_reconciliation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: The evaluator is already a pure function over existing data, which makes shadow comparison against an approved reference alert set both cheap and the right top rung. Emitting production alerts stays with the deterministic service; an agent that could raise its own pages would be a new, unapproved external effect.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which cron jobs are error-spiking or overdue right now, and which cannot be evaluated at all' using the live thresholds.

Acceptance: Jobs excluded by the trigger_type and enabled filter are listed as not-evaluated rather than omitted, so the answer discloses its own blind spot.
## Before you start
- Marked partial because the detector is structurally blind to unregistered, disabled and phantom crons, which is where the known reliability gap actually lives
- live_email is default-denied (executionPolicy.ts:33-42), so an agent never sends the alert itself even where the alert is correct
- manager_has_no_admin_login: the thresholds are recorded as Kesetebirhan Delele's discretion, yet he cannot open the surface that shows their effect (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:55)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/cronHealthAlertService.ts:57 evaluateCronJobHealth (pure evaluator), :142 checkAllCronJobHealth
- backend/src/services/cronHealthAlertService.ts:44-45 'Starting defaults per Ali's decision on BC #10095928858 comment 2026-07-15 — Kes's discretion, tuned conservatively to avoid noise.'
- backend/src/services/cronHealthAlertService.ts:47-52 RECENT_RUN_SAMPLE_SIZE 10, MIN_SAMPLE_SIZE 5, warn 50% / critical 80% error rate, missed-run warn 2x / critical 4x
- backend/src/services/cronHealthAlertService.ts:143-144 AiAgent.findAll({ where: { trigger_type: 'cron', enabled: true } })
- backend/src/services/schedulerService.ts:3368-3373 scheduled at '10,25,40,55 * * * *'
- backend/src/services/__tests__/cronHealthAlertService.test.ts

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Jobs excluded by the trigger_type and enabled filter are listed as not-evaluated rather than omitted, so the answer discloses its own blind spot.

When every box above is ticked, stop and show the demo.
