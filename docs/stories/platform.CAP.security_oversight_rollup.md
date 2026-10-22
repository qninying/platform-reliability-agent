# platform.CAP.security_oversight_rollup — Security oversight rollup

The separate security scanners are rolled up every ten minutes into one state a human can act on, so nobody has to read six timers' outputs to know whether the platform is safe.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial, not implemented, because a rollup that cannot distinguish 'scanner clean' from 'scanner silent' is not doing the job its name claims — and the scanners it reads include timers with no run count
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the rollup (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:44)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Security oversight rollup
**Domain:** Platform Automation & Reliability · **Capability:** `platform.security_oversight_rollup`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** inherited
## The business outcome
The separate security scanners are rolled up every ten minutes into one state a human can act on, so nobody has to read six timers' outputs to know whether the platform is safe.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires every ten minutes
- Each contributing scanner's most recent run and result is collected
- A scanner that has not run inside its own expected interval is marked unknown, not green
- The rollup verdict is emitted with the per-scanner contributions that produced it
**Inputs**
- findings from the five security scanners
- runtime threat and access findings
- agent behaviour findings
**Outputs**
- a single rolled-up security posture verdict
- escalation when the rollup is itself not trustworthy
**Exceptions that must be handled**
- A rollup over scanners that did not run must not render as healthy — the supervisor audit found exactly this class of unfalsifiable green verdict
- A scanner whose timer carries no ai_agents row contributes no last_run_at, so its contribution is structurally unknown
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_activity_log
- read_health_metrics
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/overview
- GET /api/admin/ai-ops/health
**Source modules**
- backend/src/services/aiOpsScheduler.ts
**Dependencies**
- platform.security_posture_scan
- platform.runtime_threat_and_access_watch
- platform.agent_behavior_safety_watch
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: A rollup's only output is a judgement. Shadow comparison against an approved reference verdict is exactly the right top rung, and is also the only rung that would have caught the unfalsifiable-green defect the supervisor audit found.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports the current rollup with every contributing scanner listed as clean, dirty or unknown.

Acceptance: A scanner with no last_run_at renders as unknown; the rollup can never be green while any contribution is unknown.
## Before you start
- Marked partial, not implemented, because a rollup that cannot distinguish 'scanner clean' from 'scanner silent' is not doing the job its name claims — and the scanners it reads include timers with no run count
- manager_has_no_admin_login: Kesetebirhan Delele cannot open the rollup (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:44)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:328 SecurityDirectorAgent '*/10 * * * *'
- docs/architecture/ai-workforce-management/SUPERVISOR_HEALTH_AUDIT_2026-10-06.md — super-agent health verdicts are unfalsifiable for broken departments
- legacy-slices/platform.json row SecurityDirectorAgent (cited aiOpsScheduler.ts:306 — stale; real line 328)

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A scanner with no last_run_at renders as unknown; the rollup can never be green while any contribution is unknown.

When every box above is ticked, stop and show the demo.
