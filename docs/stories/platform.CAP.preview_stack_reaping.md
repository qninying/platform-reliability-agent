# platform.CAP.preview_stack_reaping — Preview stack reaping

Ephemeral preview environments are torn down every five minutes once idle, so review infrastructure does not accumulate cost or stale endpoints.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- cloud_resource_deletion is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation); the existing timer performs the teardown, never an agent
- Whether PreviewStackReaper carries an ai_agents row is unknown — it is registered in schedulerService.ts, the file FLEET_RECONCILIATION_2026-09-15.md:117 identifies as holding all 33 untracked cron names

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Preview stack reaping
**Domain:** Platform Automation & Reliability · **Capability:** `platform.preview_stack_reaping`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Ephemeral preview environments are torn down every five minutes once idle, so review infrastructure does not accumulate cost or stale endpoints.
Intended users: Kesetebirhan Delele, engineering interns running preview stacks.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires every five minutes
- Each live preview stack's idle time is compared against the threshold
- Stacks past the threshold are torn down and their resources released
- The reaped set is recorded for the run
**Inputs**
- preview stack inventory
- last-activity timestamp per stack
- idle threshold
**Outputs**
- reaped stack list per run
- reaping run record
**Exceptions that must be handled**
- A stack someone is actively reviewing must not be reaped mid-review; the idle signal has to come from real activity, not from stack age
- A teardown that half-completes leaves orphaned resources, which is worse than not reaping — teardown needs to be re-runnable to completion
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- run_sandbox_job
- read_cron_run_logs
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/schedulerService.ts
- preview-db-init/
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Teardown destroys resources. cloud_resource_deletion is one of the eight default-denied capabilities, so this capability can never hold the tool that would let an agent reap for real; sandbox verification is the ceiling by construction, not by preference.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which preview stacks are live, how idle is each, and which are reap candidates' from inventory and activity data.

Acceptance: A stack with no activity signal at all is reported as unknown-idle, not as idle.
## Before you start
- cloud_resource_deletion is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy runner_isolation); the existing timer performs the teardown, never an agent
- Whether PreviewStackReaper carries an ai_agents row is unknown — it is registered in schedulerService.ts, the file FLEET_RECONCILIATION_2026-09-15.md:117 identifies as holding all 33 untracked cron names
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/schedulerService.ts:2315 instrumentCronJob('PreviewStackReaper', ...)
- preview-db-init/ — Postgres init scripts for the preview-stack Docker images (CLAUDE.md Folder Responsibilities)
- legacy-slices/platform.json cited schedulerService.ts:2223 — stale; real line 2315

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A stack with no activity signal at all is reported as unknown-idle, not as idle.

When every box above is ticked, stop and show the demo.
