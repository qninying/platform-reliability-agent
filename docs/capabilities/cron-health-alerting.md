# Cron health alerting

**Story:** `platform.CAP.cron_health_alerting` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/cronHealthAlerting.ts`, `src/inventory/cronExpression.ts` · **Tests:** `test/cronHealthAlerting.test.ts`

Ellis answers **"which cron jobs are error-spiking or overdue right now, and which cannot be evaluated at
all"**, using the live check's thresholds and its own selection. It reproduces what the platform's check
would raise; it never raises an alert itself. It is read-only.

Platform facts cite the public Colaberry platform repository at upstream commit `4443087`.

## No alert is not healthy

The live check selects only `ai_agents` rows with `trigger_type` cron and `enabled` true
(`backend/src/services/cronHealthAlertService.ts:143-145`). A job outside that selection can never raise an
alert, however it is doing. So every answer has four lists, and a job is in exactly one:

| List | Means |
|---|---|
| **alerting** | the check would raise an error-spike or missed-run alert now, with the numbers that trigger it |
| **clear** | both checks ran and neither fired |
| **evaluated in part** | selected, but one check cannot run: fewer than 5 recorded rows, or no run ever recorded (a job that has never run cannot be overdue, `:90`) |
| **not evaluated** | outside the selection, with the reason: no row (and what its wrapper then does), a disabled row, a row that is not trigger_type cron, a timer that checks no row, or a runner Ellis cannot trace to a row |

Ellis says "clear" only when every scheduled job is on the first two lists. Otherwise the answer is
`clear_with_blind_spots` and says that no alert is not the same as healthy.

On the real fleet (169 timers, 259 rows created in code), this lists 52 jobs as not evaluated:
- the 41 timers with no row: the 33 in `schedulerService.ts` and 8 in `aiOpsScheduler.ts`;
- 9 disabled cron rows;
- Dara, whose row is not trigger_type cron;
- one timer whose runner Ellis cannot trace to a row (DeptCampaignPerformanceAgent).

WeeklyReport is listed as "returns without running", and PaySimplePaymentSync as "runs it anyway,
untracked", because the wrapper decides which one is true.

## How the answer is decided

- **Thresholds.** With `--source`, they are read from the checkout's `cronHealthAlertService.ts` at run time
  (`:47-52`, K.D.'s discretion per `:44-45`). Ellis also confirms the selection is still trigger_type cron
  and enabled. A missing constant or a changed selection is an error, never a quiet fall back. Without
  `--source`, the copy pinned at `4443087` is used and named in the answer.
- **Error rate.** It uses the newest 10 activity rows of any kind once there are 5, as the check does
  (`:151-157`, `:60-63`). Rows that are not run results (skips, an agent's own action rows) count as runs
  in the check, so Ellis counts and names them.
- **Missed run.** The expected interval is the gap between the schedule's next two fires, as
  `calculateExpectedIntervalMs` computes it (`utils/cronNextRun.ts:21-31`). Ellis reads cron expressions
  itself, in UTC like the container. It was compared with cron-parser 5.5.0 (the platform's version) on all
  131 schedules in the fleet at five reference times, including a weekend, a year end and February: 655
  comparisons, no difference.
- **What the check cannot see on a selected row.** Ellis adds a note when:
  - its timer records no run on the row (a director gate);
  - its timer writes counters only (`trackAgentRun`);
  - its schedule has uneven gaps;
  - the schedule that fires gives a different interval from the row's.

## What the code showed

**New**

1. **Reporting gap. AutonomousRampEvaluator reads as stopped every weekday afternoon and all weekend.**
   - **The mismatch.** Its row says every 2 hours (`agentRegistrySeed.ts:452`). Its timer fires once a
     weekday at 13:00 UTC, through `instrumentCronJob`, which records `last_run_at`
     (`schedulerService.ts:3258-3259`).
   - **The effect.** The check reads the row's schedule (`cronHealthAlertService.ts:161`, `:91`). So 4
     hours after each run it warns, and 8 hours after it raises a critical "has likely stopped running
     entirely" alert. That is critical about 16 hours of every weeknight, and from Friday evening to
     Monday.
   - **Not recorded anywhere.** The platform's classification records the 2-hour schedule as wired
     (`docs/architecture/ai-workforce-management/LEGACY_AGENT_CLASSIFICATION.csv:205`). The baseline's
     schedule disagreements compare only `aiOpsScheduler.ts` with the seed
     (`__tests__/fixtures/cronRegistryBaseline.ts:201-204`).
   - **Caveat.** This is as seeded; a production row created earlier may hold another schedule.
2. **Latent. Dara's three daily duties do not run while her row is off, and could not raise a cron alert
   if it were on.**
   - **They do not run.** The row ships `enabled: false` (`agentRegistrySeed.ts:2544`), so the timer's
     gate returns before the work. The seed says this is deliberate until later validation. A.M. is reading
     the live value; findings 53 and 56 rest on the same flag.
   - **Three separate exclusions from the check**, each enough on its own: `trigger_type: 'event_driven'`
     (`:2528`), `enabled: false`, and an empty schedule (`:2529`), which skips the missed-run test.
     Switching the row on would leave two of them in place.
   - Already known in part: the baseline records the row's trigger type and its effect on the dashboard
     (`cronRegistryBaseline.ts:214-222`).
   - New: its effect on alerting, for timers at 06:10, 06:15 and 06:30.
3. **Live. A schedule with uneven gaps is judged against its next gap only** (`utils/cronNextRun.ts:21-27`).
   - OpenclawLinkedInCommentMonitorAgent's row says `0 8,12,16 * * 1-5` (`agentRegistrySeed.ts:1610`). Its
     timer (`aiOpsScheduler.ts:255`) runs it through `runAgent` under the row's own name
     (`aiOrchestrator.ts:627`), so the row records runs and the check selects it.
   - Overnight and at weekends the next gap is 4 hours, so a stop is warned at 8 hours and critical at
     16. Friday's 16:00 run reads as critical from Saturday 08:00 until Monday, and every weeknight it
     warns from midnight.
   - First filed as latent on the belief that no such row records runs. A.M. showed this one does; the
     other, OpenclawLinkedInFlowAgent (`:1594`), does not.
   - Not pinned: every schedule in the check's tests is `*/15`.
   - Ellis adds a caution to any alert that falls inside the schedule's longest normal gap.
4. **Reporting gap. A cron alert stays open after the job recovers, and an escalation opens a second one.**
   - Alerts are closed only by hand: the one caller of `resolveAlert` is an admin route
     (`routes/admin/alertRoutes.ts:121`). So a recovered job still shows an open alert.
   - Repeats fold into the open alert by title and type (`alertService.ts:58-65`). A warning that becomes
     critical therefore opens a second alert beside the first.
   - The escalation path (`:71`) cannot fire for these alerts, because each type has a fixed severity
     (`cronHealthAlertService.ts:68`, `:79`).

**Added to finding 54 (sent with 51-56, corrected after A.M.'s review).** Besides the four
`trackAgentRun` timers, the workforce directors scheduled under their own names never set `last_run_at`:
- Their gate only reads the row (`workforce/workforceAgentRuntime.ts:66-69`). Their runners run bare
  (`aiOpsScheduler.ts:551-553`), and their failures reach only the dead-letter queue.
- They do write activity rows, for a success or a skip (`workforceAgentRuntime.ts:164`, `:170-173`), but
  none for a failure. So the error-rate sample fills with successes and a failing director reads 0
  percent, and with no `last_run_at` it can never be overdue.
- Two more director rows, WorkforceCurriculumDirector and WorkforceCertificationDirector, are enabled cron
  rows whose work is registered under Dara instead (`aiOpsScheduler.ts:367`, `:369`), so nothing ever
  records against them.
- The four `trackAgentRun` timers are worse than first written: a failed run also sets `last_run_at` and
  adds to the run count (`agentRunTracker.ts:64`), so a job that fails every run reads as healthy and busy.
  Their failures do reach the dead-letter queue after three in a row, but nothing reads that table.
- **Already known in substance.** The platform's own audit of scheduled agents records that these runners
  never write back to their row (`workforce/scheduledAgentHealth.ts:16-18`). It also records that the
  four `trackAgentRun` timers write no activity rows (`:19-22`).
- That audit is a manual script (`scripts/auditScheduledAgentHealth.ts`), not an alert. The scheduler
  closes the gap for Dara only (`aiOpsScheduler.ts:118-128`).

**Already known**

5. **The selection is blind to no-row, disabled and non-cron jobs.** The migration matrix
   (`MIGRATION_MATRIX.md:48`) and the seed's own comments (`agentRegistrySeed.ts:2603-2607`, `:3241-3243`)
   record it.
6. **A job that has never run cannot be overdue, and fewer than 5 rows is never judged.** Both are pinned
   by the check's own tests (`cronHealthAlertService.test.ts:118`, `:41`).
7. **The check records no run of its own**, by design (`schedulerService.ts:3397-3399`). So Ellis cannot
   say whether the check itself is running, and says so.

**On the brief's figure of 19 phantom crons.** That is a production figure, which Ellis cannot confirm from
code. From code: 74 enabled cron rows have no timer in the inventory's scope recording under them. The
platform's baseline lists 79 seed rows that advertise cron with no timer under their own name
(`cronRegistryBaseline.ts:27-112`). Ellis lists each such row as evaluated in part: never run, so never
overdue.

## Also fixed in Ellis

The seed reader behind the timer inventory (capability 13) read the nine domain agents as enabled. They
spread a shared default that seeds them disabled (`agentRegistry/domainAgents.ts:66-72`). They have no
timers, so no earlier answer changed; the inventory is rebuilt at `4443087`.

## How to run it

```
npm run cron-health -- --snapshot examples/cron-health.example.json
npm run cron-health -- --snapshot examples/cron-health.example.json --source <platform checkout>
```

The example is the real fleet as built from platform source at `4443087`:
- every timer in `aiOpsScheduler.ts`'s fixed list, `schedulerService.ts` and `growthJourneyCrons.ts`, with
  the wrapper its runner uses and the row it reads;
- every row created in code, with `trigger_type`, `schedule` and `enabled` as seeded.

It has no run history, which only a live export has, so every selected row is evaluated in part. Timers
named at run time are not included, and the answer says so.

Exit codes:
- 0: no job alerts and every scheduled job is evaluated on both checks
- 4: any job alerts
- 3: none alerts, but some job is evaluated in part or not at all
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: jobs excluded by the trigger_type and enabled filter are listed as not evaluated, with
    the reason, never omitted";
  - "acceptance on the real fleet: every timer and every scheduled row is accounted for, and the 41
    timers with no row are named". It checks that each of the 169 timers and every scheduled row
    appears exactly once.
  - There are 12 tests in this file and 250 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - dropping disabled rows fails 2;
  - dropping timers with no row fails 2;
  - needing 6 rows instead of 5 fails 2;
  - moving the 50% boundary fails 1;
  - sampling the oldest rows fails 1;
  - reading blind spots as clear fails 3;
  - skipping the selection check fails 1;
  - not flagging a schedule that alarms on normal gaps fails 1;
  - dropping the director note fails 1;
  - dropping the uneven-gap caution fails 1;
  - requiring both day fields to match fails 1;
  - going critical at 2x fails 1;
  - reading domain agents as enabled fails 1 in `test/cronSites.test.ts`.
- **Not yet run on live records.** The first live check is one export of `ai_agents` (with `trigger_type`,
  `schedule` and `last_run_at`) and the newest 10 activity rows per cron agent. Ellis's answer is then
  compared with the alerts the check actually raised in the same window.
