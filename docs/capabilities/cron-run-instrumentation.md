# Cron run instrumentation

**Story:** `platform.CAP.cron_run_instrumentation` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/cronRunInstrumentation.ts` · **Tests:** `test/cronRunInstrumentation.test.ts`

Ellis answers **"did this job run, when, how long did it take, and did it fail"** from what the cron
wrappers recorded, and it names the jobs it cannot answer for. It reads the instrumentation; it never
becomes it. It is read-only.

Platform facts cite the public Colaberry platform repository at upstream commit `bb1d3c3`.

## No record is not "did not run"

A job whose name has no `ai_agents` row still runs. The wrapper finds no row, runs the job and returns with
no log, warning or counter (`backend/src/services/cronInstrumentation.ts:34-38`). So for that name Ellis
says **"not instrumented, no record exists"**, never "did not run". The absence of a record says nothing
about whether the job ran.

| Answer | Means |
|---|---|
| **not instrumented** | no `ai_agents` row; nothing about its runs can be said. Ellis also names the timer by that name, its schedule and source line, or the row it records under instead |
| **run recorded** | a row with at least one run: when it last finished, how long it took, whether it failed, its trace id |
| **no run recorded** | a row with nothing recorded on it. Never "did not run" either: a disabled or paused job's skips leave no record |
| **ambiguous** | two rows share the name, so no single history can be given |

## What each answer says it cannot say

Every answer lists what the records cannot show, with the line that explains why:
- **The error class.** It is never recorded, only the message (`cronInstrumentation.ts:62-65`,
  `agentRunTracker.ts:61`, `aiOrchestrator.ts:298`).
- **Skipped ticks** for a disabled or paused job. The skip writes no activity row (`cronInstrumentation.ts:46-51`),
  although `skipped` is in the activity log's vocabulary (`backend/src/models/AiAgentActivityLog.ts:4`).
- **Each run's duration and outcome** for the four timers on `trackAgentRun`. That wrapper keeps counters
  only. Ellis reads a failure from `last_error_at` landing with `last_run_at`
  (`agentRunTracker.ts:57-63`), and says 0 errors does not mean no failures.
- **The current run** when status is `running`. Its start time is not recorded: `last_run_at` is the
  previous run's finish.
- **Whether a failed run started its job.** A failure to mark the row running is recorded the same way as
  the job failing (`cronInstrumentation.ts:59-66`).
- **Which timer a run came from** when several record under one row (Dara's three).
- **Counted runs with no run row** in the export, since an activity write can fail without failing the
  run (`cronInstrumentation.ts:101-103`).

A run's start is derived as its finish minus its duration, and Ellis labels it that way.

`--coverage` groups every timer in the snapshot: per run, counters only, not instrumented, or unknown.
On the real inventory (capability 13), 33 timers are not instrumented, matching the platform's own baseline
name for name (`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts`,
`KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW`).

## What the code showed

None of these is a live risk. All are gaps in what gets recorded.

**New**

1. **Four timers' failures are counted nowhere the alerts look.** `trackAgentRun` writes no activity row
   and never increments `error_count` (`agentRunTracker.ts:40-65`). The cron health check reads failures
   from the last 10 activity rows and needs at least 5 (`cronHealthAlertService.ts:150-156`, `:47-48`, `:60`). So
   AutonomousEngine (six runs an hour), AICOOStrategicCycle, MetaAgentLoop and CoryEvolutionCycle can fail
   every run with no error-rate alert, and their error count stays 0. Not baselined:
   `agentRunTracker.test.ts:40` checks the failure path but asserts nothing about `error_count` or an
   activity row.
2. **A failed status write is recorded as a failed run of a job that never started.** Setting status
   `running` sits inside the job's own try (`cronInstrumentation.ts:59-61`). If that write fails, the job
   never runs, but the row gains a run and an error and the activity log says `failed` with the database
   error as the reason (`:62-100`). Not pinned: no case in `cronInstrumentation.test.ts` makes that write
   fail.
3. **The dead-letter wrapper can never fire for the five aiOps timers routed through instrumentCronJob.**
   `startStandardTask` wraps those timers in `wrapWithDeadLetter` (`aiOpsScheduler.ts:551-554`), but
   `instrumentCronJob` catches the job's error and returns normally (`cronInstrumentation.ts:62-66`). So
   the dead-letter queue, the one writer that records an error class (`deadLetterService.ts:46`), never
   sees their failures. They are AutonomousRequirementExpansion, ProposalCleanupService and Dara's three
   timers (`aiOpsScheduler.ts:115-128`, `:367`, `:369`, `:375`). This is the "5 uninstrumented" A.M. counted
   in reply to finding 35. Not pinned: `deadLetterService.test.ts` tests the
   wrapper alone.

**Already known**

4. **No row, no record.** This is the brief's own first exception, and the 33 timers are in the platform's
   baseline.
5. **No error class, skips not persisted, no overlap guard.** These are the brief's other three exceptions.
   The lost run count when two runs overlap is A.M.'s note on finding 33.
6. **A failed registry lookup also runs the job untracked** (`cronInstrumentation.ts:28-31`). This is
   finding 35, pinned by a named test.
7. **"Running for" is measured from the previous run's finish.** This is finding 3. The same pattern is
   at `cronInstrumentation.ts:60`, so it applies to these timers too.

## How to run it

```
npm run cron-runs -- --snapshot examples/cron-runs.example.json --name ReliabilityAlerting --name AutonomousEngine
npm run cron-runs -- --snapshot examples/cron-runs.example.json --coverage
```

The example is not production data. Names, schedules, timer wiring and which rows exist are the platform's;
counts, times and run rows are illustrative. Its timer list is a subset, and Ellis states that scope. It
covers:
- two timers with no row (ReliabilityAlerting, BlogRefresh);
- a counters-only timer whose last run failed (AutonomousEngine);
- a failed run with its reason (ProposalCleanupService);
- a pooled row that is running now (Dara);
- a disabled row with nothing recorded (MarketingPublishingWorker);
- a healthy per-run timer (ReesePresenceHeartbeat).

Exit codes:
- 0: every name has a recorded run (with `--coverage`: every timer records per run)
- 3: any does not
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: for an untracked timer the answer is 'not instrumented, no record exists', never 'did
    not run'";
  - "acceptance, positive control: a name known to have no ai_agents row returns the not-instrumented
    answer". The control is ReliabilityAlerting, taken from the real inventory and listed in the
    platform's baseline of scheduled names with no row. The test first checks that no row exists, so the
    control cannot pass by accident.
  - A third test asks about every untracked timer in the real inventory (33) and gets the same answer for
    each.
  - There are 18 tests in this file and 231 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - saying "did not run" fails 3;
  - answering a name with no row as if it had one fails 7;
  - matching names by prefix fails 1;
  - reading a row with no trace as a run fails 1;
  - widening the failure window fails 1;
  - adding the did-it-start caveat to every wrapper fails 1;
  - reporting the oldest run as the latest fails 1;
  - dropping the error-count caveat fails 1;
  - dropping the skip caveat fails 2;
  - reading a counters-only timer as per-run fails 2;
  - counting a missing row as per-run in coverage fails 2;
  - dropping the running caveat fails 1;
  - dropping the pooled caveat fails 1;
  - not flagging counted runs with no run row fails 1;
  - not deriving the start time fails 1;
  - answering two rows as one fails 1.
- **Not yet run on live records.** The first live check is one export of `ai_agents` and the last day of
  `ai_agent_activity_logs`, with the timer inventory from capability 13.
