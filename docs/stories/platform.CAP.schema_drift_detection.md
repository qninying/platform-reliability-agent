# platform.CAP.schema_drift_detection — Schema drift detection between environments

Schema divergence between development and production is detected nightly, so a column that exists in one environment and not the other is found before it breaks a release.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Applying a schema change is a human decision and a governance boundary under CLAUDE.md Autonomy Model
- production_database is default-denied (executionPolicy.ts:33-42, enforcedBy runner_isolation), so a run cannot even read the production schema to compare it
- Marked partial because the protected model list covers none of this domain's own tables, and code-versus-database drift is not measured at all

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Schema drift detection between environments
**Domain:** Platform Automation & Reliability · **Capability:** `platform.schema_drift_detection`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
Schema divergence between development and production is detected nightly, so a column that exists in one environment and not the other is found before it breaks a release.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The nightly script dumps both schemas and diffs them
- An email is sent only when drift exists, so silence means agreement
- At boot, the runtime reconciler adds missing nullable columns for the protected model list only
- Everything outside that list is left to the ensure-schema modules
**Inputs**
- the development schema
- the production schema
- Sequelize model definitions
**Outputs**
- a drift report when divergence exists
- additively added columns at boot for the protected models
**Exceptions that must be handled**
- The runtime reconciler is additive only — it never drops or alters, so a type change or a removed column is not healed and may not be reported either
- The protected model list excludes every table this domain depends on, so a new column on ai_agents or cron_schedule_configs will not land on an existing production table
- Drift detection compares development to production; neither is compared to the ensure-schema modules, so code-versus-database drift is a third, unmeasured axis
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_schema_metadata
- read_source_tree
- sandbox_database
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- scripts/schemaDriftCheck.sh
- backend/src/config/schemaReconcile.ts
- backend/src/server.ts
**Dependencies**
_none recorded_
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R3**.
Why that ceiling: Detecting drift is reading metadata, and R3 covers an approved user-initiated comparison in a sandbox. Resolving drift is a schema change, which CLAUDE.md lists as an escalation boundary and which the platform's own risk vocabulary rates R3 for schema_security_or_external_side_effect — so remediation never belongs to this capability.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Reports known drift from the latest drift run and names the axes that are not measured.

Acceptance: Where no drift run has completed, the answer is 'unknown — last run not found', never 'no drift'.
## Before you start
- Applying a schema change is a human decision and a governance boundary under CLAUDE.md Autonomy Model
- production_database is default-denied (executionPolicy.ts:33-42, enforcedBy runner_isolation), so a run cannot even read the production schema to compare it
- Marked partial because the protected model list covers none of this domain's own tables, and code-versus-database drift is not measured at all
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- scripts/schemaDriftCheck.sh — nightly dev-versus-prod drift alarm, dry-run over syncDevSchemaFromProd.sh, emails only when drift exists (:1-22), suggested crontab '0 6 * * *' at :18
- scripts/syncDevSchemaFromProd.sh:110 the pg_dump --schema-only engine it reuses read-only
- backend/src/config/schemaReconcile.ts:41-85 reconcileMissingColumns — additive-only runtime column self-heal, per-column non-fatal catch at :75-80, rationale at :8-29 citing two outages from enrollments drift
- backend/src/server.ts:3074-3083 CRITICAL_MODELS covers 8 models, none of which is AiAgent, CronScheduleConfig, AiAgentActivityLog or DeadLetterJob
- backend/src/db/ — roughly 105 idempotent ensure*Schema.ts files; there is no migrations directory
- CLAUDE.md Production Readiness Principles: 'Schema drift between environments is a defect.'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Where no drift run has completed, the answer is 'unknown — last run not found', never 'no drift'.

When every box above is ticked, stop and show the demo.
