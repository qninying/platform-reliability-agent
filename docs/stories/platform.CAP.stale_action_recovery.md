# platform.CAP.stale_action_recovery — Stale action recovery

Work that started and never finished is detected every fifteen minutes and returned to a runnable state, so a single stuck action does not quietly stall a queue.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- The staleness threshold and the attempt cap are not documented; Kesetebirhan Delele must state both before any rung above R2 is meaningful
- production_database is default-denied (executionPolicy.ts:33-42), so the live recovery stays with the existing timer

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Stale action recovery
**Domain:** Platform Automation & Reliability · **Capability:** `platform.stale_action_recovery`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Work that started and never finished is detected every fifteen minutes and returned to a runnable state, so a single stuck action does not quietly stall a queue.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires every fifteen minutes
- Actions in flight longer than the staleness threshold are selected
- Each is returned to a runnable state with its attempt count incremented
- An action past its attempt cap is parked rather than recycled again
**Inputs**
- in-flight action records
- staleness threshold
- attempt counts
**Outputs**
- recovered action records
- recovery run record
**Exceptions that must be handled**
- Recycling without an attempt cap is an unbounded retry loop, which CLAUDE.md prohibits outright
- An action that is slow rather than stuck must not be recovered underneath itself, or the same work runs twice concurrently
- Recovering an approval into 'performed' when it was not is the specific defect APPROVAL_DROP_QUEUE_2026-10-06.md records
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_activity_log
- sandbox_database
- read_approval_records
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/schedulerService.ts
**Dependencies**
- platform.dead_letter_triage
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Recovery mutates work state, and getting it wrong double-executes real side effects. Sandbox verification with a concurrency fixture is the ceiling until the slow-versus-stuck distinction is specified by the manager.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'what is stuck right now, for how long, and on which attempt' from action records.

Acceptance: The answer separates 'past the threshold' from 'past the attempt cap', because the second must not be recycled.
## Before you start
- The staleness threshold and the attempt cap are not documented; Kesetebirhan Delele must state both before any rung above R2 is meaningful
- production_database is default-denied (executionPolicy.ts:33-42), so the live recovery stays with the existing timer
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/schedulerService.ts:2328 instrumentCronJob('StaleActionRecovery', () => recoverStaleActions().then(() => {}))
- docs/architecture/ai-workforce-management/APPROVAL_DROP_QUEUE_2026-10-06.md:90 'The human in the loop is a timer'
- legacy-slices/platform.json cited schedulerService.ts:2236 — stale; real line 2328

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The answer separates 'past the threshold' from 'past the attempt cap', because the second must not be recycled.

When every box above is ticked, stop and show the demo.
