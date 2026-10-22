# platform.CAP.backup_and_restore_verification — Backup and restore verification

Someone can state, with evidence, that a current backup exists and can actually be restored — so the platform's recovery position is a known fact rather than an assumption.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- production_database is default-denied (executionPolicy.ts:33-42, enforcedBy runner_isolation), so an agent can neither take nor read a production backup; a human does both
- cloud_resource_deletion is default-denied (executionPolicy.ts:33-42), so backup retention and rotation are human actions
- No backup policy exists to verify against: Kesetebirhan Delele and Ali Muwwakkil must first agree the recovery objective, destination and cadence

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Backup and restore verification
**Domain:** Platform Automation & Reliability · **Capability:** `platform.backup_and_restore_verification`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
Someone can state, with evidence, that a current backup exists and can actually be restored — so the platform's recovery position is a known fact rather than an assumption.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Establish where backups are taken and on what cadence, which is currently undefined
- Check the newest artefact's age against the agreed recovery objective
- Restore it into an isolated target and assert the restored database answers a known query
- Record the verified position, including the date the restore was last actually exercised
**Inputs**
- the backup schedule and destination, once one is defined
- the most recent backup artefact's age and size
- a restore target
**Outputs**
- a verified recovery position: newest backup age, restore tested on a date, with the result
- a failure signal when no current backup exists
**Exceptions that must be handled**
- A backup that has never been restored is an untested backup, and the only evidence that counts is a completed restore — file existence and size prove nothing
- The restore target must be isolated: restoring over anything live would turn a verification into the incident it exists to prevent
- Until a backup policy exists, this capability's inputs are unknown — the recovery objective, the destination and the cadence are all undefined, so the first deliverable is the policy, not the check
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_schema_metadata
- sandbox_database
- run_sandbox_job
- compose_report_draft
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
_none recorded_
**Dependencies**
- platform.schema_drift_detection
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R3**.
Why that ceiling: Restoring a backup into an isolated sandbox target is an approved, operator-initiated sandbox operation, which is exactly R3. Reading a production backup artefact needs production credentials a run never holds, and anything resembling an operator-free restore is categorically off the table.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
States the current recovery position honestly, including that no backup verification exists.

Acceptance: The answer is 'unknown — no backup verification exists in this repository', with the search that establishes it; it never infers a position from the presence of pg_dump in unrelated scripts.
## Before you start
- production_database is default-denied (executionPolicy.ts:33-42, enforcedBy runner_isolation), so an agent can neither take nor read a production backup; a human does both
- cloud_resource_deletion is default-denied (executionPolicy.ts:33-42), so backup retention and rotation are human actions
- No backup policy exists to verify against: Kesetebirhan Delele and Ali Muwwakkil must first agree the recovery objective, destination and cadence
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- no job, route or script verifies that a backup was taken, is restorable, or is current — verified by search across backend services, routes, scripts and the repo-root scripts directory
- backend/src/scripts/cohortCleanupAndNovemberSetup.ts:23-26 and :177-178 pg_dump appears only as a documented human precondition before a destructive operation
- scripts/syncDevSchemaFromProd.sh:110 pg_dump --schema-only, used as a drift-comparison engine rather than as a backup
- CLAUDE.md Failure-First Design requires every system to answer 'What is the recovery path if all retries are exhausted?' in writing
- CLAUDE.md Intern Safety Rules: 'No destructive scripts without confirmation'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The answer is 'unknown — no backup verification exists in this repository', with the search that establishes it; it never infers a position from the presence of pg_dump in unrelated scripts.

When every box above is ticked, stop and show the demo.
