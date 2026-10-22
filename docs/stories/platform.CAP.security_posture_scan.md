# platform.CAP.security_posture_scan — Static security posture scanning

Committed code, dependency manifests and secret material are scanned on a fixed cadence so a vulnerability or leaked credential is found by the platform rather than by an outsider.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- secret_exfiltration is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy policy_gate), so a finding may name a location but never carry the secret value
- Rotation requires production credentials a run never holds (production_database and production_deploy are default-denied, executionPolicy.ts:33-42); a human performs every rotation
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the findings surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:60)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Static security posture scanning
**Domain:** Platform Automation & Reliability · **Capability:** `platform.security_posture_scan`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Committed code, dependency manifests and secret material are scanned on a fixed cadence so a vulnerability or leaked credential is found by the platform rather than by an outsider.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Each of the three timers fires on its own cadence
- The scanner walks its input surface and classifies findings by severity
- Findings are written as records and, where warranted, as tickets
- A clean scan is recorded as explicitly clean, not as absence of output
**Inputs**
- repository source tree
- package manifests and lockfiles
- known-CVE data
**Outputs**
- finding records per scan
- security tickets
- activity-log rows per run
**Exceptions that must be handled**
- A detected live secret is an incident, not a finding: rotation is a human action and the value must never be echoed into a log or ticket body
- A dependency CVE with no available patched version needs a recorded accepted-risk decision rather than an open loop
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- read_dependency_manifest
- static_secret_scan
- create_ticket
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/errors
- GET /api/admin/ai-ops/activity
**Source modules**
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.cron_run_instrumentation
- platform.agent_ticket_auto_resolution
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Scanning is read-only and can reach shadow comparison against an approved reference finding set. Remediation — rotating a credential, bumping a dependency, rewriting history — is a different capability with production consequences and is deliberately excluded from this one.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'what did the last scan of each kind find, and when' from stored findings.

Acceptance: A scan that has never run returns 'unknown' rather than 'no findings'.
## Before you start
- secret_exfiltration is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy policy_gate), so a finding may name a location but never carry the secret value
- Rotation requires production credentials a run never holds (production_database and production_deploy are default-denied, executionPolicy.ts:33-42); a human performs every rotation
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the findings surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:60)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:330 CodeSecurityAuditAgent '0 3 * * *'
- backend/src/services/aiOpsScheduler.ts:329 SecretDetectionAgent '0 */4 * * *'
- backend/src/services/aiOpsScheduler.ts:331 DependencySecurityAgent '0 4 * * *'
- CLAUDE.md Security Enforcement Layer: 'If a secret is accidentally committed, treat it as compromised: rotate immediately, then clean history.'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A scan that has never run returns 'unknown' rather than 'no findings'.

When every box above is ticked, stop and show the demo.
