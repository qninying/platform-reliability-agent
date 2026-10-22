# platform.CAP.agent_health_scoring — Agent health scoring

Each agent carries a single comparable health number so the fleet can be triaged by worst-first instead of by whoever complains loudest.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because a never-run agent scores 100, which inverts the surface's purpose; Kesetebirhan Delele must decide what a zero-run agent should score
- manager_has_no_admin_login: he cannot open the scoring surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:82)

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Agent health scoring
**Domain:** Platform Automation & Reliability · **Capability:** `platform.agent_health_scoring`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
Each agent carries a single comparable health number so the fleet can be triaged by worst-first instead of by whoever complains loudest.
Intended users: Kesetebirhan Delele, platform on-call admin.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The endpoint loads every ai_agents row
- A score is computed from the error-to-run ratio with a penalty for an error status
- Scores are returned per agent with the error rate and category
- The registry tab renders them for worst-first triage
**Inputs**
- ai_agents run_count, error_count and status
**Outputs**
- health score per agent
- error rate per agent
- fleet overview counts
**Exceptions that must be handled**
- An agent whose timer never fires has run_count 0 and error_count 0, so it scores a perfect 100 — a never-run job is indistinguishable from a flawless one on this surface
- The score is derived only from counters, so an agent with no ai_agents row has no score at all
- Three timers pooling into one Dara row produce one score for three different schedules
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_agent_registry
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/health/agents
- GET /api/admin/ai-ops/overview
**Source modules**
- backend/src/services/aiOpsService.ts
- backend/src/routes/admin/aiOpsRoutes.ts
**Dependencies**
- platform.cron_run_instrumentation
- platform.agent_registry_read_surface
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Scoring is computation over records, so R2 covers reporting it and R4 covers producing and verifying a corrected score over a sandbox fixture. Replacing the live score is a change to what a human sees when triaging, which belongs to a reviewed change rather than to an autonomy rung.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Reports health scores and states explicitly which scores rest on zero runs.

Acceptance: Every score derived from run_count 0 is labelled unscored rather than 100.
## Before you start
- Marked partial because a never-run agent scores 100, which inverts the surface's purpose; Kesetebirhan Delele must decide what a zero-run agent should score
- manager_has_no_admin_login: he cannot open the scoring surface (requireAdmin, backend/src/routes/admin/aiOpsRoutes.ts:82)
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/routes/admin/aiOpsRoutes.ts:82 GET /api/admin/ai-ops/health/agents
- backend/src/services/aiOpsService.ts:428-447 getAgentHealthScores: healthScore = 100 - (error_count / max(run_count,1)) * 200 - (status==='error' ? 30 : 0)
- backend/src/services/aiOpsService.ts:12-38 getOverview counts running, idle, paused, disabled, errored and derives repairsToday
- frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx:99 fetches ai-ops/health/agents

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every score derived from run_count 0 is labelled unscored rather than 100.

When every box above is ticked, stop and show the demo.
