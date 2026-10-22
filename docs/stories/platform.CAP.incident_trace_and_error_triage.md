# platform.CAP.incident_trace_and_error_triage — Incident trace and error triage

A failure can be followed from the symptom back to the run that caused it using one identifier, and the resulting error record can be closed out, so incidents end in a diagnosis instead of a guess.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because untracked jobs produce no trace and the cron path records no error_class, so the single-correlation-id requirement in CLAUDE.md is not met for the whole fleet
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the errors or trace surfaces (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:60-77)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Incident trace and error triage
**Domain:** Platform Automation & Reliability · **Capability:** `platform.incident_trace_and_error_triage`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
A failure can be followed from the symptom back to the run that caused it using one identifier, and the resulting error record can be closed out, so incidents end in a diagnosis instead of a guess.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- An admin opens the errors tab and selects an unresolved error
- The error detail is fetched with its stack and its trace id
- The trace endpoint returns every activity row sharing that trace id in order
- Once diagnosed, the error is marked resolved
**Inputs**
- a trace id, activity id or error id
- an optional filter over unresolved errors
**Outputs**
- the ordered activity for one trace
- error detail with stack
- resolved error records
**Exceptions that must be handled**
- A trace exists only where instrumentCronJob ran with a registry row, so an untracked job produces no trace at all and its failures cannot be followed
- error_class is not recorded on the cron path, so errors cannot be grouped by class on this surface even though CLAUDE.md requires a stable error_class — only the dead-letter writer captures it
- Marking an error resolved does not verify the underlying cause is fixed, so a resolved record is a human claim, not evidence
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_activity_log
- read_cron_run_logs
- read_audit_log
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/trace/:traceId
- GET /api/admin/ai-ops/errors
- GET /api/admin/ai-ops/errors/:id
- PATCH /api/admin/ai-ops/errors/:id/resolve
- GET /api/admin/ai-ops/activity/:id
**Source modules**
- backend/src/services/aiOpsService.ts
- backend/src/routes/admin/aiOpsRoutes.ts
- frontend/src/components/admin/intelligence/tabs/ErrorsTab.tsx
**Dependencies**
- platform.cron_run_instrumentation
- platform.dead_letter_capture
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Tracing and diagnosing is reading and reasoning over records, which reaches shadow comparison against approved reference diagnoses. Marking an error resolved is a claim about reality and stays with a human, so it is excluded from this capability's grants.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Assembles the full trace for a given id and states the probable cause with the rows that support it.

Acceptance: Where no trace exists for a failure, the answer is 'not traceable — this job is untracked', never a reconstructed narrative.
## Before you start
- Marked partial because untracked jobs produce no trace and the cron path records no error_class, so the single-correlation-id requirement in CLAUDE.md is not met for the whole fleet
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the errors or trace surfaces (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:60-77)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:76 GET /api/admin/ai-ops/trace/:traceId, :75 GET /activity/:id, :77 GET /errors/:id
- backend/src/routes/admin/aiOpsRoutes.ts:60 GET /errors, :61 PATCH /errors/:id/resolve
- backend/src/services/aiOpsService.ts:279 getExecutionTrace, :294 getActivityDetail, :307 getErrorDetail, :160 resolveError
- backend/src/services/cronInstrumentation.ts:22-23 traceId = uuidv4() seeded into request context, persisted as trace_id at :96
- frontend/src/components/admin/intelligence/tabs/ErrorsTab.tsx and ExecutionTraceModal.tsx
- CLAUDE.md Observability Framework: 'If a failure cannot be traced from symptom back to root cause using a single correlation ID, the observability is incomplete.'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Where no trace exists for a failure, the answer is 'not traceable — this job is untracked', never a reconstructed narrative.

When every box above is ticked, stop and show the demo.
