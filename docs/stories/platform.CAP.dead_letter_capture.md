# platform.CAP.dead_letter_capture — Dead-letter capture for repeatedly failing jobs

A job that fails repeatedly is recorded with its error class and full context instead of retrying forever, so a persistent failure becomes a triageable item.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because dead_letter_jobs has no reader anywhere in the codebase and coverage excludes the dynamic registry and every schedulerService job
- CLAUDE.md requires dead-lettered work to reach a manual triage runbook; no such runbook or surface exists

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Dead-letter capture for repeatedly failing jobs
**Domain:** Platform Automation & Reliability · **Capability:** `platform.dead_letter_capture`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
A job that fails repeatedly is recorded with its error class and full context instead of retrying forever, so a persistent failure becomes a triageable item.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- A wrapped job runs and its outcome updates an in-memory consecutive-failure counter
- A success resets the counter
- On the third consecutive failure a dead_letter_jobs row is written with the error class and context
- The counter is cleared after the write so the next cycle starts fresh
**Inputs**
- job name and label
- consecutive failure count
- the thrown error
**Outputs**
- a dead_letter_jobs row with error class, message, stack and context
**Exceptions that must be handled**
- The table is write-only: no route, controller or admin page reads dead_letter_jobs, so a dead-lettered job is recorded where nobody looks
- The failure counter lives in memory, so a restart resets progress toward the threshold and a job failing once per deploy may never dead-letter
- Coverage is partial by construction — dynamic registry entries and all of the roughly seventy schedulerService jobs are unwrapped
- Two independent dead-letter mechanisms exist with no shared view, so 'what is dead-lettered' has two answers
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_cron_run_logs
- read_activity_log
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/deadLetterService.ts
- backend/src/models/DeadLetterJob.ts
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Capture is deterministic plumbing the agent reads rather than performs; R4 covers exercising the capture path end to end against a sandbox fixture, including the restart case the in-memory counter makes fragile. Reading and acting on the queue is the separate triage capability.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports what has been dead-lettered, by error class, and which job families cannot dead-letter at all.

Acceptance: The report names the unwrapped job families explicitly, so an empty queue is never read as a healthy fleet.
## Before you start
- Marked partial because dead_letter_jobs has no reader anywhere in the codebase and coverage excludes the dynamic registry and every schedulerService job
- CLAUDE.md requires dead-lettered work to reach a manual triage runbook; no such runbook or surface exists
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/deadLetterService.ts:25 wrapWithDeadLetter(jobName, label, fn), :17 MAX_CONSECUTIVE_FAILURES = 3
- backend/src/services/deadLetterService.ts:46 error_class captured as err?.constructor?.name || err?.name || 'Error' — the only place on the cron path where an error class is recorded
- backend/src/services/deadLetterService.ts:19 in-memory consecutive-failure counter, reset on restart; :32 reset on success; :53-58 a DLQ write failure is swallowed
- backend/src/models/DeadLetterJob.ts:54 dead_letter_jobs with job_name, label, consecutive_failures, error_message, error_class, error_stack, context JSONB, resolved, resolved_at
- backend/src/services/aiOpsScheduler.ts:533 wrapWithDeadLetter applied to standard registry entries only — not to DYNAMIC_SCHEDULE_REGISTRY (:546) and not to any schedulerService.ts job
- backend/src/models/PublishingJob.ts:108-109 a second, independent dead-letter mechanism on publishing_jobs

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The report names the unwrapped job families explicitly, so an empty queue is never read as a healthy fleet.

When every box above is ticked, stop and show the demo.
