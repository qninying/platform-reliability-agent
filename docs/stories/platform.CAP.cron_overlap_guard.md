# platform.CAP.cron_overlap_guard — Cron overlap guard

A scheduled job cannot start a second time while its previous run is still going, so a slow run stops turning into two concurrent runs competing over the same work.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Applying the guard to live timers requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42)
- Whether a skipped tick should be recorded as a missed run is a policy question for Kesetebirhan Delele, because it changes what the missed-run detector reports
- Timers with no registry row record no duration, so the at-risk list is incomplete until the untracked population is registered

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Cron overlap guard
**Domain:** Platform Automation & Reliability · **Capability:** `platform.cron_overlap_guard`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
A scheduled job cannot start a second time while its previous run is still going, so a slow run stops turning into two concurrent runs competing over the same work.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Compare each timer's recorded duration against its own cron interval
- Flag every timer whose worst observed duration exceeds its interval
- Apply the library's overlap guard, or a job-level claim where the job spans processes
- Verify by forcing a long run and confirming the second tick is skipped rather than started
**Inputs**
- each timer's cron interval
- its recorded average and worst-case duration
- whether it holds its own claim mechanism
**Outputs**
- the list of timers whose duration can exceed their interval
- an overlap guard applied per timer
**Exceptions that must be handled**
- A library-level guard is per process, so a job that could run on two instances needs a database-level claim instead — this platform runs more than one sender process, so the distinction is real
- Skipping an overlapping tick is not free: for a job that must run every interval, a skip is a missed run and should be recorded as one rather than silently dropped
- A timer with no registry row records no duration, so its overlap risk cannot be assessed at all until it is registered
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_cron_run_logs
- read_source_tree
- run_sandbox_job
- write_sandbox_fixture
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.idempotency_and_replay_audit
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Identifying at-risk timers and building and proving the guard is sandbox work with a clear pass condition. Applying it to live timers changes execution behaviour and ships via a reviewed deploy, so the ladder stops at verified sandbox execution.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Names every timer whose recorded duration can exceed its own interval, and states which jobs already hold their own claim.

Acceptance: Each name is accompanied by its interval and its recorded duration; a timer with no duration data is listed as unassessable rather than safe.
## Before you start
- Applying the guard to live timers requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42)
- Whether a skipped tick should be recorded as a missed run is a policy question for Kesetebirhan Delele, because it changes what the missed-run detector reports
- Timers with no registry row record no duration, so the at-risk list is incomplete until the untracked population is registered
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/package.json:42 node-cron ^4.2.1, which supports a noOverlap option
- backend/src/services/aiOpsScheduler.ts:538 and :549 the options objects passed to cron.schedule contain only { timezone: 'America/Chicago' }
- backend/src/services/cronInstrumentation.ts has no lock, no in-flight set and no claimed_by column anywhere on its path
- backend/src/services/publishing/publishingWorker.ts:290-295 the one job that defends itself, with its own optimistic claim
- backend/src/services/aiOpsScheduler.ts:203 PromptMonitorAgent runs '*/1 * * * *', so a run exceeding sixty seconds overlaps by construction
- backend/src/services/cronInstrumentation.ts:70-72 avg_duration_ms is recorded, which means the data to find the overlapping jobs already exists

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Each name is accompanied by its interval and its recorded duration; a timer with no duration data is listed as unassessable rather than safe.

When every box above is ticked, stop and show the demo.
