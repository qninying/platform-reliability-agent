# platform.CAP.system_resilience_supervision — System resilience supervision

The platform's resilience posture is supervised twice an hour so a failure pattern spanning several subsystems is recognised as one problem instead of several unrelated alerts.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because the audit found supervisor verdicts unfalsifiable where the supervised department is broken, and because 34 timers contribute no run count at all (phase1-reconciliation.md:221)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the posture surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:82)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# System resilience supervision
**Domain:** Platform Automation & Reliability · **Capability:** `platform.system_resilience_supervision`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** inherited
## The business outcome
The platform's resilience posture is supervised twice an hour so a failure pattern spanning several subsystems is recognised as one problem instead of several unrelated alerts.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires at 11 and 41 minutes past each hour
- Subsystem verdicts and failure counters are collected
- Failures are correlated to find patterns that span subsystems
- A posture verdict is emitted with the subsystems that contributed to it
**Inputs**
- subsystem health verdicts
- failure and retry counts
- circuit breaker state
**Outputs**
- resilience posture verdict
- cross-subsystem failure pattern records
**Exceptions that must be handled**
- A supervisor over subsystems that are themselves silent produces an unfalsifiable verdict — the exact finding of SUPERVISOR_HEALTH_AUDIT_2026-10-06.md, which is why this is marked partial
- One counter standing in for three timers cannot attribute a failure to a timer, so attribution must be reported as unavailable rather than guessed
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_cron_run_logs
- read_activity_log
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/overview
- GET /api/admin/ai-ops/health/agents
**Source modules**
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.security_oversight_rollup
- platform.cron_health_alerting
- platform.agent_health_scoring
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: A supervisor's output is a judgement about other systems. Shadow evaluation against approved reference outcomes is both the top rung that needs no new side effect and the only one that can prove the verdict is falsifiable.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports the current resilience posture with each contributing subsystem's state and the age of its last signal.

Acceptance: A subsystem with no signal is reported as unknown and prevents a healthy overall verdict.
## Before you start
- Marked partial because the audit found supervisor verdicts unfalsifiable where the supervised department is broken, and because 34 timers contribute no run count at all (phase1-reconciliation.md:221)
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the posture surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:82)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:351 { agentName: 'SystemResilienceSuperAgent', hardcodedSchedule: '11,41 * * * *', runner: runSystemResilienceSuperAgent }
- backend/src/services/aiOpsScheduler.ts:88 import runSystemResilienceSuperAgent
- docs/architecture/ai-workforce-management/SUPERVISOR_HEALTH_AUDIT_2026-10-06.md:181 'D7 — one employee, three timers, one counter'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A subsystem with no signal is reported as unknown and prevents a healthy overall verdict.

When every box above is ticked, stop and show the demo.
