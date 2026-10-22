# platform.CAP.runtime_cron_drift_detection — Runtime cron drift detection

At runtime, in production, the set of timers that actually fire is compared against the set of agents the platform claims are scheduled — so a job running untracked, a row claiming to run that never does, and a timer firing under a name no row carries are all named while they are happening.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Fixing any detected drift is explicitly out of scope for this build and is a separate workstream; detection must not be allowed to imply remediation
- Registering a missing row or disabling a phantom row is a human decision under platform.agent_enable_disable_control and platform.untracked_timer_registration_proposal
- manager_has_no_admin_login: no surface exists for this report yet, and the manager could not open it if it did (requireAdmin on every admin route)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Runtime cron drift detection
**Domain:** Platform Automation & Reliability · **Capability:** `platform.runtime_cron_drift_detection`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
At runtime, in production, the set of timers that actually fire is compared against the set of agents the platform claims are scheduled — so a job running untracked, a row claiming to run that never does, and a timer firing under a name no row carries are all named while they are happening.
Intended users: Kesetebirhan Delele, Ali Muwwakkil, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Enumerate the timers the running process actually registered, not the ones the source declares
- Compare that set against ai_agents rows and cron_schedule_configs rows in both directions
- Classify each disagreement into one of the five known classes
- Publish the report where a human can read it, with the time it was measured attached to every count
**Inputs**
- the live task registry as the process actually holds it
- ai_agents rows
- cron_schedule_configs rows
- observed call-site names
**Outputs**
- a drift report per class with every affected name
- a readable count per class with its measurement timestamp
**Exceptions that must be handled**
- A name registered more than once pools its counters into one row, so duplicate registration is a drift class in its own right and not a harmless alias
- The build-time ratchet passes while the known phantom and untracked populations persist, because they are in the frozen baseline — a runtime detector must report them as present rather than as accepted
- The two reported figures for untracked timers differ by source: 33 as reconciled on 2026-09-15 and 34 in the later Phase 1 census. A runtime detector should supersede both by measuring, and must not restate either as current
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_source_tree
- read_cron_run_logs
- compose_report_draft
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.registry_runtime_reconciliation
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Detection is comparison and reporting, and shadow evaluation against the existing build-time reconciler is a genuinely useful top rung — the build-time result is already an approved reference outcome. Acting on a drift finding means registering or disabling a timer, which is human-decided under separate capabilities.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which timers are untracked, which rows are phantom, and which names collide' from a live measurement, with the measurement time attached.

Acceptance: Every count is accompanied by the list of names behind it; a count with no name list is not published. A positive control asserts WorkforceIntelligence appears in the no-seed-row class.
## Before you start
- Fixing any detected drift is explicitly out of scope for this build and is a separate workstream; detection must not be allowed to imply remediation
- Registering a missing row or disabling a phantom row is a human decision under platform.agent_enable_disable_control and platform.untracked_timer_registration_proposal
- manager_has_no_admin_login: no surface exists for this report yet, and the manager could not open it if it did (requireAdmin on every admin route)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:8 'Nothing in production compares the two.'
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:90-136 the five drift classes already defined as a pure function: cronSeedRowsWithNoRegistration, scheduledNamesWithNoSeedRow, scheduleDisagreements, registeredRowsDenyingSchedule, duplicateRegistryNames
- backend/src/services/cronInstrumentation.ts:35-38 an unregistered job runs untracked and returns, silently
- backend/src/services/cronHealthAlertService.ts:143-144 the health detector queries only trigger_type 'cron' and enabled true, so it cannot see any drift class
- backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:196 'WorkforceIntelligence', // runs every 6h; no seed row, so run_count is tracked against nothing
- .loop-architect/runs/20261007-school-agent-factory/phase1-reconciliation.md:221 '34 timers with no ai_agents row'; :226 '19 enabled phantom crons render as live scheduled jobs'
- docs/architecture/ai-workforce-management/FLEET_RECONCILIATION_2026-09-15.md:117 '33 names have no registry row (all in schedulerService.ts)'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every count is accompanied by the list of names behind it; a count with no name list is not published. A positive control asserts WorkforceIntelligence appears in the no-seed-row class.

When every box above is ticked, stop and show the demo.
