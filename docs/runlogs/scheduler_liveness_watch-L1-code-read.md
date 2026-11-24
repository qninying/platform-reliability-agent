# Run log: Scheduler and agent liveness watch, step 1 (code-only part)

Capability id: `scheduler_liveness_watch`. Accountable human: K.D.
The board has no step stories for this capability yet (0 criteria). It was started on 23 Nov as the second candidate
while the Curriculum content health scan waits on decisions that are not mine
([step 0.3 run log](orchestration_health_watch-L0-ask-for-a-screen.md)).

| | |
|---|---|
| Date | 2026-11-23 |
| Done by | Q.N., code read (assisted), from platform main at a2d44750b (23 Nov) |
| Method | Platform source only. No portal, no database, no runtime data. |
| Time | Not timed. One sitting on 23 Nov. |
| Result | **Partly answerable.** Which timers exist, and which of them the existing detector can or cannot see, is answerable from code. Whether any agent is silent right now is not, because that needs `last_run_at` from the database. |

## Finding 1: a missed-run detector already exists, so the brief's absence evidence does not hold

The brief says "no module in backend/src was found that compares a scheduled agent's last_run_at against its cron
expression and raises on the difference", and lists "tolerance_undefined" as a blocker. Both are contradicted by the code:

- `services/cronHealthAlertService.ts` (capability `platform.cron_health_alerting`): `checkAllCronJobHealth()` reads
  every `ai_agents` row with `trigger_type = 'cron'` and `enabled = true`, and compares `last_run_at` with the
  expected interval of `ai_agents.schedule`.
- **Tolerance is set:** warning at 2x the expected interval, critical at 4x (`MISSED_RUN_WARNING_MULTIPLIER`,
  `MISSED_RUN_CRITICAL_MULTIPLIER`), "per Ali's decision on BC #10095928858, 2026-07-15, Kes's discretion".
- **It runs:** `schedulerService.ts:3919`, at minutes 10, 25, 40 and 55, 24/7.
- **One alert per silence:** `alertService.ts` dedups on the open condition, not on a time window.

So the capability is not "absent". It is **partly built, with coverage gaps**. The gaps below are the real work.

## Finding 2: what the detector cannot see (from code; the database may differ)

The code registers **115 scheduled timers** under **113 agent names**: 101 in `SCHEDULE_REGISTRY` and 14 in
`DYNAMIC_SCHEDULE_REGISTRY` (`aiOpsScheduler.ts`). Pairing them with the rows seeded in `agentRegistrySeed.ts`:

| Gap | Count | What it means |
|---|---|---|
| Timer name has no seeded `ai_agents` row | **34** | The detector never evaluates them, and nothing says so. The brief requires these to be reported as unmeasurable. |
| ...of which a near-named row exists (`OpenclawSupervisor` vs `OpenclawSupervisorAgent`) | 21 | Timer, governance toggle and agent row use different names, so it is unclear which row, if any, gets `last_run_at`. |
| ...of which no row of any similar name is seeded | 13 | Skool (6), GovOpportunity (2), AdmissionsHighIntentDetection, AdmissionsInsightsAggregation, OpenclawInfrastructureMonitor, WeeklyReport, WorkforceIntelligence |
| One name, three timers (`Dara`: 06:10, 06:15, 06:30) | 3 timers, 1 row | Any one of the three updates `last_run_at`, so two can stop and the row still looks on time. Its row is also `event_driven`, so the detector skips it. |
| Code schedule differs from the seeded `ai_agents.schedule` | 2 | ApolloWeeklyEnrollmentAgent (code weekdays, row Mondays), WeeklyStrategicBriefing (code 07:45, row 06:45). The detector judges against the row, not the schedule actually running, and a governance DB override (`cron_schedule_configs`) can differ again. |
| Seeded disabled | 8 | Correctly skipped. |
| Timers outside both registries | at least 1 | System Auto-Response (every minute, `aiOpsScheduler.ts`), plus the `cron.schedule` calls in `schedulerService.ts`, including the detector itself, which its own comment says is not instrumented. Nothing watches the watcher. |

**Never-run agents:** with `last_run_at` null, the detector skips the missed-run check, so an agent that never ran
never alerts. The brief wants a one-interval grace for new agents, not silence forever.

**The check itself is not recorded:** the detector writes alerts, but no activity-log row for the check. The brief
asks for one so the watcher is auditable.

## Related piece already in the code

`scripts/auditScheduledAgentHealth.ts`: a manual, read-only script that names catalog agents advertised as scheduled
but not running (`never_ran`, `stalled` after 8 days). It is run by hand, not on a schedule.

## Steps I really performed

1. Read the brief and listed its claims and blockers.
2. Read `aiOpsScheduler.ts` (registries, boot loop, the instrumentation set and the live task list).
3. Listed every timer's name and schedule from both registries.
4. Paired the names with `agentRegistrySeed.ts`, then searched the rest of `backend/src` for each unmatched name.
5. Found `cronHealthAlertService.ts` through a comment in `cronInstrumentation.ts`, and read it, its caller and the
   alert dedup.

## Judgment calls

| Call | Based on |
|---|---|
| Used `agentRegistrySeed.ts`, not `agentRegistrySeed-Ali-AI.ts` | The `-Ali-AI` file looks like a copy; the canonical seed is the one the others import |
| Did not count `seedGovernanceConfig.ts` as creating rows | It creates `cron_schedule_configs` rows (schedules), not `ai_agents` rows |
| Reported counts as "from code" | Rows can also exist in production without being in a seed (marketing.json mentions a legacy `SkoolSupervisor` row) |
| My first count was wrong (67 with no row) | The parser read a second `agent_name` inside `config`; fixed and re-run before writing this |

## Harder, slower or more ambiguous than the workflow implies

- "Pair each registry entry with its ai_agents row" assumes the names match. For 21 timers they differ by a suffix.
- "Compute the expected next run from its cron expression" assumes one schedule. There are three sources: the code,
  the `ai_agents.schedule` row and the governance override, and they do not always agree.

## What step 1 could not answer without access

Which agents are silent right now, and since when. That needs `ai_agents.last_run_at` and the recent
`ai_agent_activity_logs` rows from production, the same wall as the curriculum scan.

## For K.D. and A.M.

The brief's absence evidence and its "tolerance undefined" blocker should be corrected: the detector exists
(`platform.cron_health_alerting`), with 2x and 4x tolerances. What is missing is coverage: about 34 timers it cannot
see, shared and mismatched names, never-run agents, and no record of the check itself.

## Confirmation, 24 Nov

A.M. replied that the gap is real and that the platform measured it independently from the other direction. A new
page shows it: **System > Platform Operations** (`/admin/system/operations`), Fleet tab. Q.N. opened it on 24 Nov and
read, without changing anything:

- "151 scheduled agents in the registry, 120 of them reporting and 31 silent about themselves for 30 days. 122 timers
  in the source, 84 of them watched by nothing."
- **Live fleet** marks a row red when it claims a schedule and has not fired, and amber when nothing has ever reported
  on it ("that is us not watching, which is not the same as dead").
- **WeeklyStrategicBriefing: Has not fired**, registry "Mondays at 07:45 (override)". This is one of the two schedule
  mismatches in Finding 2, now visible on screen.
- **Untracked timers** lists timers firing under no registry row, each with a proposed row (enabled off) for a person to
  accept or reject.

The page's 84 of 122 is larger than this read's 34 of 115. The counts use different rules: the page counts a timer as
unwatched when nothing reports on it, while this read counted only timers with no seeded row. When this capability
gets its steps, the page is the source of truth and this read explains why the gaps exist.

