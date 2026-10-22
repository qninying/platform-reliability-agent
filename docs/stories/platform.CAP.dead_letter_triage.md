# platform.CAP.dead_letter_triage — Dead-letter triage and recovery runbook

Work that failed past its retry limit is visible to a human, triaged, and either recovered or deliberately abandoned — so a dead-lettered job stops being a row nobody reads.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Replaying a production job re-fires its side effects and is a human decision until idempotency is proven per job
- production_database is default-denied (executionPolicy.ts:33-42), so an agent never marks a production row resolved
- No read surface exists for either dead-letter store; building one is proposed work, not existing work

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Dead-letter triage and recovery runbook
**Domain:** Platform Automation & Reliability · **Capability:** `platform.dead_letter_triage`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Work that failed past its retry limit is visible to a human, triaged, and either recovered or deliberately abandoned — so a dead-lettered job stops being a row nobody reads.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Both dead-letter stores are read into one view
- Entries are grouped by error class so one upstream fault does not read as many unrelated failures
- Each group is triaged: recover by replay, fix and replay, or abandon with a reason
- The decision is recorded against the entry, which is what the unused resolved columns are for
**Inputs**
- dead_letter_jobs rows with error class, message, stack and context
- publishing_jobs dead-letter rows
- the originating job's identity
**Outputs**
- a triage queue grouped by error class
- a recovery or abandon decision per entry
- a resolved marking with the reason
**Exceptions that must be handled**
- Replaying a dead-lettered job re-runs its side effects, so replay is only safe where the job is idempotent — which is unproven for most jobs in this repo
- Two stores with different shapes mean 'what is dead-lettered' has two answers; a triage view that reads one and not the other is a false empty
- The capture path's in-memory counter means a job failing once per restart never reaches the queue, so an empty queue is not evidence of a healthy fleet
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_cron_run_logs
- read_activity_log
- compose_report_draft
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.dead_letter_capture
- platform.idempotency_and_replay_audit
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Reading, grouping and recommending is well within reach, and R4 covers verifying a replay end to end in a sandbox. Replaying in production re-fires real side effects, so the replay decision stays with a human until the job's idempotency is proven — and that proof is a separate capability.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Presents both dead-letter stores as one queue grouped by error class, with the job families that cannot dead-letter named alongside.

Acceptance: An empty queue is reported as 'empty, and here is what could not have reached it', never as a healthy fleet.
## Before you start
- Replaying a production job re-fires its side effects and is a human decision until idempotency is proven per job
- production_database is default-denied (executionPolicy.ts:33-42), so an agent never marks a production row resolved
- No read surface exists for either dead-letter store; building one is proposed work, not existing work
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/models/DeadLetterJob.ts:54 dead_letter_jobs with resolved and resolved_at columns that nothing sets
- no route, controller or admin page reads dead_letter_jobs — verified by search across backend routes, controllers, services and db, which returns only the model, the model index and the writer
- backend/src/services/deadLetterService.ts:41-51 the write path; :19 the in-memory counter that resets on restart
- backend/src/models/PublishingJob.ts:108-109 a second, independent dead-letter store with no shared view
- CLAUDE.md Failure-First Design: 'Failed jobs/messages that cannot be retried go to a dead-letter store with full context for manual triage' and 'What is the recovery path if all retries are exhausted?'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] An empty queue is reported as 'empty, and here is what could not have reached it', never as a healthy fleet.

When every box above is ticked, stop and show the demo.
