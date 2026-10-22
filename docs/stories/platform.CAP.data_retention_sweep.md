# platform.CAP.data_retention_sweep — Platform data retention sweeps

High-volume operational tables are pruned on a nightly cadence so storage, query latency and cost stay bounded without anyone remembering to do it.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation), so an agent never executes a production delete — a human or the existing timer does
- ChatMessageCleanup and PageEventCleanup are registered in schedulerService.ts, which is where the 33-to-34 untracked-timer population lives; whether these two carry an ai_agents row is unknown and was not measured in this read-only task

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Platform data retention sweeps
**Domain:** Platform Automation & Reliability · **Capability:** `platform.data_retention_sweep`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
High-volume operational tables are pruned on a nightly cadence so storage, query latency and cost stay bounded without anyone remembering to do it.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Each cleanup timer fires on its nightly schedule
- Rows older than the table's retention window are selected
- Rows are deleted in bounded batches so one run cannot lock the table
- The deleted count per table is recorded for the run
**Inputs**
- retention window per table
- row age
- referential dependents
**Outputs**
- deleted row counts per table per run
- retention run record
**Exceptions that must be handled**
- A retention window that is not written down anywhere is a silent data-loss policy; each window must be stated, not inferred from the code
- Deleting a row that something still references turns a cleanup into an outage, so dependents are checked before the batch
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_schema_metadata
- sandbox_database
- read_cron_run_logs
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/schedulerService.ts
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Deletion is irreversible, so the ladder stops at verified multi-step sandbox execution. Reaching production would require production_database, which is default-denied; the live sweeps keep running as the existing deterministic timers, not as agent actions.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'what is each table's retention window and when was it last swept' from run records.

Acceptance: A table whose window is not recorded anywhere returns 'unknown', never a guessed number of days.
## Before you start
- production_database is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation), so an agent never executes a production delete — a human or the existing timer does
- ChatMessageCleanup and PageEventCleanup are registered in schedulerService.ts, which is where the 33-to-34 untracked-timer population lives; whether these two carry an ai_agents row is unknown and was not measured in this read-only task
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/schedulerService.ts:2474 instrumentCronJob('ChatMessageCleanup', ...)
- backend/src/services/schedulerService.ts:2457 instrumentCronJob('PageEventCleanup', ...)
- backend/src/services/aiOpsScheduler.ts:344 ProposalCleanupService '0 2 * * *'
- legacy-slices/platform.json cited schedulerService.ts:2382 and :2365 for the first two — both stale; real lines measured 2026-10-09 are 2474 and 2457

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A table whose window is not recorded anywhere returns 'unknown', never a guessed number of days.

When every box above is ticked, stop and show the demo.
