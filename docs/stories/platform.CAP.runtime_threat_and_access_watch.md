# platform.CAP.runtime_threat_and_access_watch — Runtime threat and access-control watch

Live access-control state and runtime threat signals are evaluated continuously so a privilege drift or an active attack is caught while it is still happening.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Revoking or granting a login touches admin_users in production; production_database is default-denied (executionPolicy.ts:33-42), so a human performs every access change
- manager_has_no_admin_login: the manager who should review access drift cannot himself reach the surface that reports it (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:64)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Runtime threat and access-control watch
**Domain:** Platform Automation & Reliability · **Capability:** `platform.runtime_threat_and_access_watch`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Live access-control state and runtime threat signals are evaluated continuously so a privilege drift or an active attack is caught while it is still happening.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The runtime monitor samples live signals every five minutes; the access guardian runs a full sweep daily at 05:00
- Current access state is compared against the expected role-to-section mapping
- Divergences and threat signals are recorded with the identity and route involved
- Findings are surfaced to the security oversight rollup
**Inputs**
- admin_users roles and mgmt_role values
- runtime request and auth signals
- agent tool grants
**Outputs**
- access-drift findings
- runtime threat alerts
- activity-log rows
**Exceptions that must be handled**
- An identity with an org_members row and no admin_users row is not a drift — it is the known manager-access gap and must not be auto-resolved by creating a login
- A deliberate temporary grant needs an expiry, or it reads as drift on every subsequent sweep
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_audit_log
- read_agent_registry
- emit_alert
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/events
- GET /api/admin/ai-ops/errors
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/middlewares/authMiddleware.ts
**Dependencies**
- platform.security_oversight_rollup
- platform.manager_scoped_authorization
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Detection only. Changing anyone's access is a privilege grant, which is the single thing an agent in this domain must never do on its own authority, so the ladder stops below any action rung for this capability.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'who holds which admin section today, and what changed since the last sweep' from audit records.

Acceptance: The answer distinguishes 'no admin_users row' from 'admin_users row with no sections', because they have different remedies.
## Before you start
- Revoking or granting a login touches admin_users in production; production_database is default-denied (executionPolicy.ts:33-42), so a human performs every access change
- manager_has_no_admin_login: the manager who should review access drift cannot himself reach the surface that reports it (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:64)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:332 RuntimeThreatMonitorAgent '*/5 * * * *'
- backend/src/services/aiOpsScheduler.ts:333 AccessControlGuardianAgent '0 5 * * *'
- backend/src/middlewares/__tests__/mgmtRbac.test.ts:30-34 the mgmt_role model already anticipates Kes as mgmt_role 'admin' with inbox_content withheld

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The answer distinguishes 'no admin_users row' from 'admin_users row with no sections', because they have different remedies.

When every box above is ticked, stop and show the demo.
