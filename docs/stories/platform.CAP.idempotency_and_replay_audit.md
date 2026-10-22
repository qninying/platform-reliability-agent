# platform.CAP.idempotency_and_replay_audit — Idempotency and replay-safety audit

Every side-effecting job, webhook handler and script is assessed for whether running it twice produces one outcome, so retry and recovery stop being guesses.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- A job whose side effect is an outbound email or external write cannot be double-run to test it: live_email and unbounded_network are default-denied (executionPolicy.ts:33-42), so those verdicts rest on inspection and must be labelled as such
- production_database is default-denied (executionPolicy.ts:33-42), so no verdict may be produced by replaying against production
- Adding an overlap guard or an idempotency key to a live job is a change that ships, so remediation is a reviewed deploy performed by a human

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Idempotency and replay-safety audit
**Domain:** Platform Automation & Reliability · **Capability:** `platform.idempotency_and_replay_audit`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Every side-effecting job, webhook handler and script is assessed for whether running it twice produces one outcome, so retry and recovery stop being guesses.
Intended users: Kesetebirhan Delele, Ali Muwwakkil, engineering interns.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Enumerate every side-effecting job, webhook handler and script
- For each, identify the idempotency mechanism: a key, a unique constraint, an optimistic claim, or none
- Prove or disprove replay safety by running the operation twice against a sandbox and comparing end state
- Report the jobs with no mechanism as defects, not as unknowns, once they have been tested
**Inputs**
- the inventory of side-effecting jobs, handlers and scripts
- each one's dedup or claim mechanism
- each one's external effects
**Outputs**
- a replay-safety verdict per job with the mechanism that provides it
- a named list of jobs with no mechanism at all
**Exceptions that must be handled**
- Absence of a documented mechanism is not proof of unsafety and presence of one is not proof of safety — only the twice-run comparison settles it, so an untested job is unknown rather than either
- A job whose side effect is an outbound email or an external write cannot be safely double-run in production to test it, so those must be proven in a sandbox or by inspection only
- There is no overlap guard on the cron path at all, so two concurrent runs of the same timer are possible today and a single-run idempotency proof does not cover that case
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- run_sandbox_job
- sandbox_database
- write_sandbox_fixture
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.dead_letter_triage
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: The whole method is run-it-twice-in-a-sandbox-and-compare, which is precisely stateful multi-step sandbox execution with verification. Nothing above R4 is needed, and nothing above R4 would be safe, because the next rung would mean double-running jobs against production.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R1)**
Builds the isolated fixtures and the twice-run harness for one job family, with a baseline that captures end state.

Acceptance: The harness detects a deliberately non-idempotent fixture job as unsafe — if it cannot fail, it cannot pass.
## Before you start
- A job whose side effect is an outbound email or external write cannot be double-run to test it: live_email and unbounded_network are default-denied (executionPolicy.ts:33-42), so those verdicts rest on inspection and must be labelled as such
- production_database is default-denied (executionPolicy.ts:33-42), so no verdict may be produced by replaying against production
- Adding an overlap guard or an idempotency key to a live job is a change that ships, so remediation is a reviewed deploy performed by a human
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- CLAUDE.md Idempotency & Replayability (NON-NEGOTIABLE): 'Every script, worker, webhook handler, and side-effecting service in this repo MUST be idempotent' and 'A script that works once but breaks on the second run is broken, not fragile.'
- CLAUDE.md Test Strategy Framework names idempotency validation as one of four mandatory test types per feature
- backend/src/services/cronInstrumentation.ts has no lock, no in-flight set and no claimed_by — there is no overlap guard on the cron path
- backend/package.json:42 node-cron ^4.2.1 supports a noOverlap option; the options objects at backend/src/services/aiOpsScheduler.ts:538 and :549 contain only a timezone
- backend/src/services/publishing/publishingWorker.ts:290-295 an optimistic claim, which is the one place a job defends itself rather than relying on the scheduler
- backend/src/scripts/auditApprovalReplayDrift.ts — a replay-drift audit exists for approvals only, not for the cron fleet

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The harness detects a deliberately non-idempotent fixture job as unsafe — if it cannot fail, it cannot pass.

When every box above is ticked, stop and show the demo.
