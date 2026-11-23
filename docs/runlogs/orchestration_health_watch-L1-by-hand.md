# Run log: Orchestration health watch, L1 (do it by hand)

Story: `platform.CAP.orchestration_health_watch.L1-BY-HAND`. Capability now titled "Curriculum content health scan".
Accountable human: K.D. Shared with A.M. by email on 14 Nov; committed here on 23 Nov so the board can credit it.

| | |
|---|---|
| Date | 2026-11-14 |
| Done by | Q.N. (Forward Deployed Engineer) |
| Method | By hand, from the platform source (main, 13 Nov). The portal view was not reachable (see Exceptions). |
| Time it actually took | About 15 minutes (not timed on the day; estimated by Q.N. on 23 Nov) |

## Finding 1: the brief and the code describe two different agents

The capability record describes a **scheduler watchdog**. The code is a **curriculum content health scorer** that has
"Orchestration" in its name.

- **What the record promises:**
  - It checks the scheduler and the agent-orchestration layer.
  - Its inputs are the schedule registry, the `ai_agents` rows and the activity log.
  - It raises an alert when the verdict is degraded.
- **What the code does:**
  - `OrchestrationHealthAgent` calls `generateHealthReport` (`services/healthReportService.ts`).
  - The findings it scores fall in six categories: Curriculum, Prompts, Skills, Backfill, Pipeline and Integrity.
  - Those findings roll up into component scores for curriculum, prompts, artifacts, students and gating.
  - Neither file reads `SCHEDULE_REGISTRY`, the `ai_agents` rows or the activity log. The agent writes to the activity
    log (one `finding_<severity>` action per finding) but never reads it.
  - On a status change it calls `logAiEvent('orchestration_health', 'status_change', ...)` and nothing else. No code
    path notifies anyone.
- **Portal placement agrees with the code:** the results sit under Curriculum (Health tab), not under operations.

**Consequence:** today nothing watches whether the scheduler and the agents are running, even though the record says
something does. If later rungs (L2 to L4) are built from the brief, they would automate a check that does not exist. If
they are built from the code, the capability's name and record need to change. Which way to go is a call for K.D. and
A.M.

**Outcome (14 Nov):** A.M. corrected the capability the same day. It is now titled "Curriculum content health scan",
and a separate capability was filed to track the scheduler check, which exists nowhere today.

## Claims tested

| # | The brief claims | What the code shows | Holds? |
|---|---|---|---|
| 1 | Checks the scheduler and agent-orchestration layer | Scores course content only (six finding categories, five component scores) | **No** |
| 2 | Runs every 5 minutes | `*/5 * * * *` (`aiOpsScheduler.ts:192`), registry row present | Yes, in code. Not seen running (no portal access) |
| 3 | Writes a verdict per run | Snapshot in `orchestration_health`: score 0 to 100, status healthy / degraded / critical, findings | Yes, in code |
| 4 | Result in the activity log under the agent name | One action `finding_<severity>` per finding | Yes, in code |
| 5 | A degraded verdict raises an alert | Only a `status_change` event; no alert send | **No** |
| 6 | A disabled or paused row skips and logs `cron_job_skipped_disabled` | Shared scheduler behaviour, not specific to this agent | Yes, in code. Not seen |
| 7 | Inputs: schedule registry, `ai_agents` rows, activity log | None of the three is read | **No** |

## Steps I really performed

1. Read the capability brief and listed its claims.
2. Tried to open the agent in the portal. Both rooms showed No Access (see Exceptions).
3. Read `orchestrationHealthAgent.ts` and `healthReportService.ts` on platform main and checked every claim against
   them.
4. Found where the portal files the results: sidebar Curriculum, Health tab. That matches the code, not the brief.

Steps that could not be done without access: the last run time, run gaps, the actual verdict, and the status history.

## My answer

- **Healthy right now?** Not answerable by hand without portal or database access. Even if it were, the agent's verdict
  says whether the course content is healthy, not whether orchestration is healthy.
- **Last status change, and when:** not answerable without access.

## Judgment calls

| Call I made | What I based it on |
|---|---|
| Treated the mismatch as the result of this rung rather than a blocker | A.M., 14 Nov: write the run log with the mismatch as finding one; do not hold the story waiting on access |
| Counted "writes to the activity log" as different from "reads the activity log" | The record lists the log as an input; the code only writes to it |

## Harder, slower or more ambiguous than the workflow implies

- The name misleads. "Orchestration health" reads as scheduler health, and a person checking by hand would trust a
  healthy verdict that says nothing about the scheduler.
- At the time, viewing and controlling shared one permission, so a view-only grant was not possible. A.M. separated
  them on 15 Nov, citing this run log.

## Mechanical vs judgment (feeds the L3 tool request)

| Mechanical | Needs judgment |
|---|---|
| Read the last snapshot: score, status, findings, time | Whether the score means anything for the question being asked (content vs scheduler) |
| Compare the last run time with now (within 5 minutes?) | Whether a gap is a real outage or a disabled or paused row |
| List status changes from the event log | Whether a status change needed someone told, since nothing tells them today |

## Exceptions hit

- **2026-11-14, no portal access.** On the Program floor, Curriculum and AI Organization both show No Access; only My
  Domain and Change Requests open. I asked A.M. for read-only access, with K.D. copied.
  - **A.M.'s reply:** there was no read-only grant yet; a scoped read role was being built (separated on 15 Nov).
  - This rung was done from the code instead.

## What the read role has to cover (asked for by A.M.)

**Curriculum, Health tab.**
- *What I expected to see:*
  - The latest health snapshot: score, status and the time it was taken.
  - The findings list with severity and category.
  - The component scores.
  - The history of snapshots over time.
- *What I would have checked once inside:*
  - Is the latest snapshot less than 5 minutes old?
  - Are there gaps in the history (missed runs)?
  - What is the current status, and when did it last change?
  - Do the findings match what the code says the agent checks?

**AI Organization, Orchestration Health agent page (/admin/agents/:id).**
- *What I expected to see:*
  - The agent's registry row: enabled or disabled, paused, schedule and category.
  - The last run time and the run outcome.
  - Recent errors.
  - The agent's activity log entries.
- *What I would have checked once inside:*
  - Is it enabled and on `*/5`?
  - Did the last run succeed?
  - Are there `cron_job_skipped_disabled` entries?
  - Does the activity log show `finding_*` actions and a `status_change` event at the times the Health tab says the
    status changed?
  - Is anything there an alert, or only a log line?

**What the role must not include:** enable, disable, run now, or any edit. Viewing only.
