# platform.CAP.default_on_timer_guard — Default-on timer guard

Adding a new entry to the scheduler registry stops silently switching a timer on in production, so growth in the registry is not growth in unreviewed automation.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Flipping the default changes which timers run in production — a human decision, and a deploy, so production_deploy is default-denied (executionPolicy.ts:33-42)
- Kesetebirhan Delele must first rule on each currently-ungoverned registry name: should it run or not. Until that list is ruled on, the guard cannot be switched on without stopping real work
- Out of scope to fix in this build; this capability records the requirement so it is not lost

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Default-on timer guard
**Domain:** Platform Automation & Reliability · **Capability:** `platform.default_on_timer_guard`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Adding a new entry to the scheduler registry stops silently switching a timer on in production, so growth in the registry is not growth in unreviewed automation.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- On boot, resolve each registry entry against its cron_schedule_configs row
- Where no row exists, record the entry as ungoverned and leave it off in production
- Report the ungoverned set rather than starting it
- A human enables each one deliberately, which creates the row that governs it from then on
**Inputs**
- a new or changed SCHEDULE_REGISTRY entry
- the presence or absence of a matching cron_schedule_configs row
- the environment
**Outputs**
- a timer that stays off until a row explicitly enables it
- a report of every registry name with no governing row
**Exceptions that must be handled**
- Flipping the default is a behaviour change for every currently-ungoverned timer — roughly seventy registry names have no row — so doing it without first enumerating and enabling the ones that should run would stop real work
- A database read failure at boot currently produces the same fail-open result as a missing row, so the guard must distinguish 'no row' from 'could not read rows' and refuse to start rather than start everything
- The reload path already protects against exactly this failure mode; the asymmetry between boot and reload is the defect, not the default alone
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_source_tree
- run_sandbox_job
**Application surfaces**
- /admin/governance
**Source modules**
_none recorded_
**Dependencies**
- platform.schedule_governance_live_reload
- platform.runtime_cron_drift_detection
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Changing what starts at boot in production changes which automation runs, which is a human decision. The agent can build and verify the guard in a sandbox and enumerate the ungoverned set, which is R4; applying the change is a reviewed deploy performed by a human.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Enumerates every registry name with no governing cron_schedule_configs row and states that each is currently on by default.

Acceptance: The enumeration is a measured list of names, not a count; and it states the three code locations where the default is applied.
## Before you start
- Flipping the default changes which timers run in production — a human decision, and a deploy, so production_deploy is default-denied (executionPolicy.ts:33-42)
- Kesetebirhan Delele must first rule on each currently-ungoverned registry name: should it run or not. Until that list is ruled on, the guard cannot be switched on without stopping real work
- Out of scope to fix in this build; this capability records the requirement so it is not lost
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:729 const enabled = dbEntry?.enabled ?? true; in the standard boot loop
- backend/src/services/aiOpsScheduler.ts:748 the same default in the dynamic boot loop
- backend/src/services/aiOpsScheduler.ts:628 the same default in the reload path
- backend/src/services/aiOpsScheduler.ts:713-720 a DB read failure at boot proceeds with an empty map, so every timer falls back to hardcoded and enabled
- backend/src/services/aiOpsScheduler.ts:590-593 the reload path deliberately does NOT catch that failure, because reconciling against an empty map would silently re-enable operator-disabled jobs — the boot path has no such protection
- backend/src/models/CronScheduleConfig.ts:46-50 enabled BOOLEAN NOT NULL DEFAULT true
- .loop-architect/runs/20261007-school-agent-factory/phase1-reconciliation.md:221 'Compounded by aiOpsScheduler.ts:730 enabled = dbEntry?.enabled ?? true and only 37 cron_schedule_configs rows against 107+ registry names' — the cited line has since moved to 729

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The enumeration is a measured list of names, not a count; and it states the three code locations where the default is applied.

When every box above is ticked, stop and show the demo.
