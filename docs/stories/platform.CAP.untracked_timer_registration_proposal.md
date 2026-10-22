# platform.CAP.untracked_timer_registration_proposal — Untracked timer registration proposal

Every timer that fires without a registry row gets a proposed row, so the fleet becomes governable — each job gaining an enabled gate, a run count and a place in health alerting.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Creating registry rows in production is a human action; production_database is default-denied (executionPolicy.ts:33-42)
- Kesetebirhan Delele must rule per timer on govern-or-retire, and on the intended enabled value for each
- Explicitly out of this build's scope — the untracked population is on the stated not-fixed list, and this capability exists so the requirement is recorded rather than claimed as done

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Untracked timer registration proposal
**Domain:** Platform Automation & Reliability · **Capability:** `platform.untracked_timer_registration_proposal`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Every timer that fires without a registry row gets a proposed row, so the fleet becomes governable — each job gaining an enabled gate, a run count and a place in health alerting.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Measure the untracked set at runtime rather than restating a document's count
- For each name, establish its real schedule and what it actually does
- Propose a registry row, explicitly stating whether it should arrive enabled or disabled
- Separate the timers that should be governed from the ones that should be retired instead
**Inputs**
- the measured list of untracked timer names
- each one's real cron expression and call site
- each one's business purpose
**Outputs**
- a proposed registry row per untracked timer, with schedule, category and intended enabled state
- a per-timer recommendation to govern or to retire
**Exceptions that must be handled**
- Creating a registry row is not a neutral act: with the current default a new row makes the timer governable but also keeps it on, so each proposal must state the intended enabled value rather than leaving it to the default
- Some untracked timers may be the right candidates for retirement rather than registration, and proposing a row for a job that should not run at all entrenches it
- The two published counts differ — 33 as reconciled on 2026-09-15 and 34 in the Phase 1 census — so the proposal set must be derived from a fresh measurement, with its own date, and neither figure restated as current
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- read_agent_registry
- compose_report_draft
**Application surfaces**
- /admin/governance
**Source modules**
_none recorded_
**Dependencies**
- platform.runtime_cron_drift_detection
- platform.default_on_timer_guard
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R3**.
Why that ceiling: Proposing is analysis; creating the rows is a production registry change that alters which jobs are gated and counted. R3 covers an operator-initiated sandbox run that generates and validates the proposal set, and the rows themselves are created by a human.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Publishes the freshly measured untracked set with each name's real schedule and call site.

Acceptance: Every entry carries a real call-site citation and a measurement date; the published count is the one just measured, not 33 or 34 quoted from a document.
## Before you start
- Creating registry rows in production is a human action; production_database is default-denied (executionPolicy.ts:33-42)
- Kesetebirhan Delele must rule per timer on govern-or-retire, and on the intended enabled value for each
- Explicitly out of this build's scope — the untracked population is on the stated not-fixed list, and this capability exists so the requirement is recorded rather than claimed as done
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- docs/architecture/ai-workforce-management/AI_EMPLOYEE_ROSTER.md:37 row 9 names Kes Delele and records 'Also the natural owner of the 33 untracked scheduler crons'
- docs/architecture/ai-workforce-management/FLEET_RECONCILIATION_2026-09-15.md:117 '64 string-literal call sites, 63 distinct names. 33 names have no registry row (all in schedulerService.ts). They run every tick with no enabled/paused gate, no run_count, no activity log, and are invisible to cronHealthAlertService'
- .loop-architect/runs/20261007-school-agent-factory/phase1-reconciliation.md:221 the later Phase 1 census figure of 34
- backend/src/services/cronInstrumentation.ts:35-38 the mechanism: no row means run untracked and return
- backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts:190 'The registry row of the same agent_name (agentRegistrySeed.ts) exists first: seedAgentIdentity() throws without it' — registry row before identity, an ordering this proposal must respect

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every entry carries a real call-site citation and a measurement date; the published count is the one just measured, not 33 or 34 quoted from a document.

When every box above is ticked, stop and show the demo.
