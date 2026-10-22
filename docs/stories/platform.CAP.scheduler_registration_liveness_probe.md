# platform.CAP.scheduler_registration_liveness_probe — Scheduler registration liveness probe

External monitoring can tell the difference between a healthy platform and a platform whose every scheduled job silently never registered, so the single largest invisible outage mode becomes visible.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Shipping the probe requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider)
- Changing what GET /health returns changes external alerting behaviour; Kesetebirhan Delele must approve the failure condition and the expected-count source
- The expected timer count has never been pinned anywhere, so it must be established before the probe can fail on a shortfall rather than only on zero

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Scheduler registration liveness probe
**Domain:** Platform Automation & Reliability · **Capability:** `platform.scheduler_registration_liveness_probe`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
External monitoring can tell the difference between a healthy platform and a platform whose every scheduled job silently never registered, so the single largest invisible outage mode becomes visible.
Intended users: Kesetebirhan Delele, external uptime monitoring, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- At boot, record how many timers were actually registered and under which registry
- Expose that figure on the probe external monitoring already polls
- Fail the probe when the registered count is zero, or materially below the expected count
- Keep the heartbeat-age check as a second, independent signal
**Inputs**
- the count of timers the process actually registered
- the expected count
- the scheduler heartbeat age
**Outputs**
- a liveness verdict that fails when zero or too few timers registered
- a non-200 response external monitoring already watches
**Exceptions that must be handled**
- A registered count is not a fired count: a timer can register and never fire, so this probe detects non-registration and must not claim to detect non-execution
- The expected count is itself derived from the registries, so a registry that shrinks silently would lower the expectation to match — the expected figure needs to be pinned, not computed from the same source
- One cron is registered outside the task registry entirely while still being counted as scheduled, so the existing count is already not a trustworthy denominator
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_agent_registry
- run_sandbox_job
**Application surfaces**
- GET /health
- GET /health/full
**Source modules**
_none recorded_
**Dependencies**
- platform.system_health_probe_and_alerting
- platform.runtime_cron_drift_detection
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Building and verifying a probe is sandbox work the agent can complete and prove, which is R4. Shipping it changes what external monitoring treats as an outage, which is a reviewed deploy and a human's call.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports how many timers the running process registered and states that the public probe cannot currently detect zero.

Acceptance: The report names ENABLE_FOLLOWUP_SCHEDULER as the single flag and names startScheduler as the only caller of the AI Ops scheduler, both as measured facts.
## Before you start
- Shipping the probe requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider)
- Changing what GET /health returns changes external alerting behaviour; Kesetebirhan Delele must approve the failure condition and the expected-count source
- The expected timer count has never been pinned anywhere, so it must be established before the probe can fail on a shortfall rather than only on zero
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/config/env.ts:168 enableFollowUpScheduler is process.env.ENABLE_FOLLOWUP_SCHEDULER === 'true'
- backend/src/server.ts:3462-3464 startScheduler() runs only under that flag
- backend/src/services/schedulerService.ts:3428-3431 startScheduler() is the only caller of startAIOpsScheduler(), so one unset variable stops every timer in both schedulers
- backend/src/routes/healthRoutes.ts:7-15 GET /health performs a database SELECT 1 and returns 200 — it never consults the scheduler
- backend/src/services/systemHealthService.ts:135 scheduler liveness is checked by heartbeat age inside the full check, which is not the probe external monitoring polls
- backend/src/services/aiOpsScheduler.ts:764-771 the systemAutoResponseService cron is registered with no instrumentation, no dead-letter wrap and no entry in the task registry, yet is counted as scheduled at :773

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The report names ENABLE_FOLLOWUP_SCHEDULER as the single flag and names startScheduler as the only caller of the AI Ops scheduler, both as measured facts.

When every box above is ticked, stop and show the demo.
