# platform.CAP.orchestration_auto_repair — Orchestration auto-repair

Known, bounded orchestration faults are repaired on a five-minute cadence so routine breakage does not wait for a human.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- The authorized repair set is not enumerated in any document or constant, so 'explicitly authorized action classes' (autonomy:R7) has no referent — Kesetebirhan Delele must enumerate it
- manager_has_no_admin_login: Kesetebirhan Delele cannot open /admin/intelligence to review repair history (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:52)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Orchestration auto-repair
**Domain:** Platform Automation & Reliability · **Capability:** `platform.orchestration_auto_repair`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Known, bounded orchestration faults are repaired on a five-minute cadence so routine breakage does not wait for a human.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Timer fires on the staggered five-minute offset
- runOrchestrationRepair identifies faults inside its authorized repair set
- Each repair is attempted and its outcome logged with an action string containing 'repair'
- The overview endpoint aggregates successful repairs for the day
**Inputs**
- orchestration fault signals
- ai_agents enabled/paused state
**Outputs**
- repair attempt record in AiAgentActivityLog
- repairsToday counter on the AI Ops overview
**Exceptions that must be handled**
- A fault outside the authorized repair set must be left alone and reported, not improvised on
- A repair that is not idempotent would double-apply on the next five-minute tick; replay safety is asserted nowhere today
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_agent_registry
- read_activity_log
- run_sandbox_job
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/overview
- GET /api/admin/ai-ops/activity
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/services/aiOpsService.ts
**Dependencies**
- platform.orchestration_health_watch
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R6**.
Why that ceiling: This writes repairs, so it cannot stop at read-only. R6 is the ceiling because a supervised production pilot is separately approved per capability (autonomyLadder.ts:156-159 flags production_requires_separate_pilot_approval); R7 would let it automate repair classes nobody has enumerated, and the authorized repair set is not written down anywhere today.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R4)**
Executes the full repair sequence against a sandbox fixture carrying a seeded fault and verifies the end state.

Acceptance: Running the same repair twice against the same fixture leaves one change, not two, and the second run reports no-op.
## Before you start
- The authorized repair set is not enumerated in any document or constant, so 'explicitly authorized action classes' (autonomy:R7) has no referent — Kesetebirhan Delele must enumerate it
- manager_has_no_admin_login: Kesetebirhan Delele cannot open /admin/intelligence to review repair history (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:52)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:204 { agentName: 'OrchestrationAutoRepairAgent', hardcodedSchedule: '3,8,13,18,23,28,33,38,43,48,53,58 * * * *', runner: runOrchestrationRepair }
- backend/src/services/aiOpsService.ts:33-38 repairsToday counted from AiAgentActivityLog where action ILIKE '%repair%' and result='success'
- legacy-slices/platform.json row OrchestrationAutoRepairAgent (cited aiOpsScheduler.ts:182 — stale; real line 204)

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Running the same repair twice against the same fixture leaves one change, not two, and the second run reports no-op.

When every box above is ticked, stop and show the demo.
