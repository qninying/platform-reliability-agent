# platform.CAP.error_class_coverage — Error classification coverage

Every caught failure carries a stable error class, so failures can be grouped by cause and a spike in one class is distinguishable from general noise.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- The change ships through a deploy; production_deploy is default-denied (executionPolicy.ts:33-42)
- The error-class vocabulary is a decision Kesetebirhan Delele must make, because a vocabulary the fleet does not share groups nothing
- Adding a column to persist the class on the activity log touches a table the runtime schema reconciler does not protect, so it needs a deliberate schema change

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Error classification coverage
**Domain:** Platform Automation & Reliability · **Capability:** `platform.error_class_coverage`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Every caught failure carries a stable error class, so failures can be grouped by cause and a spike in one class is distinguishable from general noise.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Agree the error-class vocabulary, starting from the classes CLAUDE.md already names
- Classify at each catch site on the cron and agent paths
- Persist the class alongside the message and stack
- Measure coverage: the share of recorded failures carrying a specific rather than generic class
**Inputs**
- caught exceptions on the cron and agent paths
- the agreed error-class vocabulary
- existing classification sites
**Outputs**
- a stable error class on every recorded failure
- a coverage figure for how many failures carry a non-generic class
**Exceptions that must be handled**
- Deriving the class from the constructor name produces 'Error' for most throws, which is the generic value the standard forbids — a constructor-name fallback is coverage on paper only
- A class vocabulary that grows per catch site becomes unusable for grouping, so the vocabulary has to be fixed and small
- Classifying only where it is easy produces a coverage figure that looks good and groups nothing, so the coverage measure must be over all recorded failures, not over classified ones
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- read_activity_log
- run_sandbox_job
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.cron_run_instrumentation
- platform.incident_trace_and_error_triage
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Classifying and measuring coverage is sandbox-verifiable work with an objective pass condition. The change ships through a reviewed deploy, so R4 is the ceiling; and the vocabulary itself is a decision rather than a derivation.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports current classification coverage and names every catch site on the cron path that records no class.

Acceptance: Coverage is reported as a share of all recorded failures; failures whose class is the generic fallback count as unclassified, not classified.
## Before you start
- The change ships through a deploy; production_deploy is default-denied (executionPolicy.ts:33-42)
- The error-class vocabulary is a decision Kesetebirhan Delele must make, because a vocabulary the fleet does not share groups nothing
- Adding a column to persist the class on the activity log touches a table the runtime schema reconciler does not protect, so it needs a deliberate schema change
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- CLAUDE.md Observability Framework: 'Every caught exception is tagged with a stable error_class string before being logged or surfaced... Generic Error is not an acceptable classification in production code paths.'
- backend/src/services/cronInstrumentation.ts:64-65 only err.message and err.stack are captured — no error class anywhere on the cron path
- backend/src/services/deadLetterService.ts:46 error_class captured as err?.constructor?.name || err?.name || 'Error' — the only capture point, and it falls back to the generic value CLAUDE.md forbids
- backend/src/models/DeadLetterJob.ts:45 error_class column, written only by the dead-letter path
- backend/src/services/errorSpikeAlertService.ts — classified failure-rate spikes over an allowlisted set of event types, so a classifier consumer already exists and is starved of classified cron failures

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Coverage is reported as a share of all recorded failures; failures whose class is the generic fallback count as unclassified, not classified.

When every box above is ticked, stop and show the demo.
