# platform.CAP.orchestration_health_watch.L4-AGENT-WATCHED — Orchestration health watch · 4 · agent does it, watched

**Let the agent do it at its starting rung, with a human approving every run.**

Only start this once step 3 has a recorded decision and the tool exists. The agent now does the capability at **R0**, its own starting rung, with a named human approving every single run before it takes effect.

**The behaviour to reach**
Answers 'is orchestration healthy right now, and when did it last change' from the registry and activity log only.

**How it is judged**
Every answer cites the ai_agents row and activity-log rows it was derived from; no answer is produced for an agent name with no row.

**Measure it against your run log, not against a feeling.** Same inputs, same outcome, and the exceptions from step 1 handled the way you handled them. A run that differs is evidence, and it belongs in the record whether or not it is convenient.

**This capability's ceiling is autonomy:R5.** Read-and-report over existing records. Shadow evaluation against an approved reference verdict is the highest rung that needs no new production side effect; anything above R5 would mean acting on the verdict, which is a separate capability.

Higher rungs are not part of this story and are not tasks. A rung is earned by a named human on evidence, after this one is working and has a record behind it.

**When this passes, the capability is done and the next one starts.** One at a time is the point: pick the next capability with your manager and open its step 1.

**Release:** autonomy:R0 · Legacy migration plan (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Orchestration health watch · R2
**Domain:** Platform Automation & Reliability · **Capability:** `platform.orchestration_health_watch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
The scheduler and agent-orchestration layer is checked every five minutes so a stalled or degraded orchestration path is surfaced instead of discovered by a user.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Scheduler fires the timer on its cron expression
- runOrchestrationHealth inspects the orchestration path and records a verdict
- Result is written to the activity log under the agent name
- A degraded verdict is surfaced through the alert path
**Inputs**
- SCHEDULE_REGISTRY entries
- ai_agents rows (schedule, enabled, last_run_at)
- ai_agent_activity_logs results
**Outputs**
- orchestration health verdict per run
- AiAgentActivityLog row
- alert when degraded
**Exceptions that must be handled**
- The agent has an ai_agents row, so a disabled or paused row skips the run and logs cron_job_skipped_disabled
- A verdict for a timer that carries no ai_agents row cannot be recorded at all
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_cron_run_logs
- read_activity_log
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/overview
- GET /api/admin/ai-ops/registry
**Source modules**
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.cron_run_instrumentation
- platform.cron_health_alerting
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Read-and-report over existing records. Shadow evaluation against an approved reference verdict is the highest rung that needs no new production side effect; anything above R5 would mean acting on the verdict, which is a separate capability.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**This story is one rung: autonomy:R2**
Answers 'is orchestration healthy right now, and when did it last change' from the registry and activity log only.

Acceptance: Every answer cites the ai_agents row and activity-log rows it was derived from; no answer is produced for an agent name with no row.

**Satisfying this does not promote anything.** It makes autonomy:R2 *eligible*. A named human promotes the capability one step, on this evidence. Story completion, elapsed time, a conversation that went well and a passing mocked test are all recorded as non-promoting signals, so none of them moves the rung.
## Before you start
- manager_has_no_admin_login: Kesetebirhan Delele has an org_members row (3df017df-affa-49ab-884f-a99a4bd2ef4e) but no admin_users row, so every /api/admin/ai-ops/* route is unreachable to him — all are gated by requireAdmin (backend/src/routes/admin/aiOpsRoutes.ts:44-82)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:192 { agentName: 'OrchestrationHealthAgent', hardcodedSchedule: '*/5 * * * *', runner: runOrchestrationHealth }
- backend/src/services/aiOpsScheduler.ts:172 SCHEDULE_REGISTRY declaration
- legacy-slices/platform.json row OrchestrationHealthAgent (cited aiOpsScheduler.ts:170 — stale by 22 lines; real line measured 2026-10-09 is 192)

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every answer cites the ai_agents row and activity-log rows it was derived from; no answer is produced for an agent name with no row.
- [ ] The agent produced the same outcome as the step 1 run log, on the same inputs, including the exceptions recorded there.
- [ ] Every run in the evidence window was approved by a named human before it took effect, and the record shows who.

When every box above is ticked, stop and show the demo.
