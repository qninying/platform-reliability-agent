# platform.CAP.cron_run_instrumentation — Cron run instrumentation

Every tracked scheduled job records that it ran, how long it took and whether it failed, so reliability questions are answered from data instead of from recollection.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because an untracked job is recorded nowhere (cronInstrumentation.ts:35-38) and error_class is never captured — both are stated requirements in CLAUDE.md's Observability Framework
- Closing the untracked-job hole is a scheduler change and is explicitly out of scope for this planning task

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Cron run instrumentation
**Domain:** Platform Automation & Reliability · **Capability:** `platform.cron_run_instrumentation`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
Every tracked scheduled job records that it ran, how long it took and whether it failed, so reliability questions are answered from data instead of from recollection.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- A cron site calls instrumentCronJob with the agent name and the job
- The matching ai_agents row is looked up and a trace id is generated
- If a row exists and is enabled, status goes to running, the job runs, and counters plus an activity-log row are written
- If no row exists, the job runs untracked and the wrapper returns
**Inputs**
- agent_name string
- the job function
- the matching ai_agents row if one exists
**Outputs**
- ai_agents run_count, avg_duration_ms, last_run_at, error_count, last_error
- ai_agent_activity_logs row with trace_id, duration_ms, result, stack_trace
**Exceptions that must be handled**
- A missing ai_agents row produces no record of any kind, which is the mechanism behind the 33-to-34 untracked timers and the reason they have no enabled gate and no run count
- error_class is not captured — only err.message and err.stack — so the Observability Framework's error_class requirement is unmet on this path; the DLQ writer does capture it
- The activity-log result vocabulary includes 'skipped', but the disabled path returns before writing any row, so a skip is never persisted
- There is no overlap guard: node-cron v4 supports noOverlap, and the options object passed at aiOpsScheduler.ts:538 contains only a timezone
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_cron_run_logs
- read_activity_log
- read_agent_registry
**Application surfaces**
- GET /api/admin/ai-ops/activity
- GET /api/admin/ai-ops/trace/:traceId
**Source modules**
- backend/src/services/cronInstrumentation.ts
- backend/src/models/AiAgentActivityLog.ts
- backend/src/models/AiAgent.ts
**Dependencies**
- platform.registry_runtime_reconciliation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: This is deterministic plumbing that must stay deterministic — CLAUDE.md's core principle is that production systems are deterministic and the agent is never the runtime executor. The agent's role is to read what the instrumentation recorded and report on its gaps, not to become the instrumentation.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'did this job run, when, how long did it take, and did it fail' and names which jobs it cannot answer for.

Acceptance: For an untracked timer the answer is 'not instrumented — no record exists', never 'did not run'. A positive control: asking about a name known to have no ai_agents row must return the not-instrumented answer.
## Before you start
- Marked partial because an untracked job is recorded nowhere (cronInstrumentation.ts:35-38) and error_class is never captured — both are stated requirements in CLAUDE.md's Observability Framework
- Closing the untracked-job hole is a scheduler change and is explicitly out of scope for this planning task
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/cronInstrumentation.ts:19 instrumentCronJob(agentName, fn)
- backend/src/services/cronInstrumentation.ts:34-38 'If agent not in registry, run untracked' — returns with no log, no warn and no counter
- backend/src/services/cronInstrumentation.ts:60 status 'running'; :74-87 run_count, avg_duration_ms, last_run_at, error_count, last_error
- backend/src/services/cronInstrumentation.ts:88-100 AiAgentActivityLog.create
- backend/src/services/cronInstrumentation.ts:22-23 traceId = uuidv4() seeded into request context
- backend/src/services/agentRunTracker.ts:29-32 warns in the same missing-row case, so the silent path is a divergence inside this repo, not a platform-wide convention

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] For an untracked timer the answer is 'not instrumented — no record exists', never 'did not run'. A positive control: asking about a name known to have no ai_agents row must return the not-instrumented answer.

When every box above is ticked, stop and show the demo.
