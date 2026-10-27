# Stale action recovery

**Story:** `platform.CAP.stale_action_recovery` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/staleActionRecovery.ts` · **Tests:** `test/staleActionRecovery.test.ts`

Ellis answers **"what is stuck right now, for how long, and on which attempt?"**
Ellis only reads. Recovering an action changes work state, and `production_database` is default-denied,
so the platform's own timer does the recovering, never an agent.

Platform facts cite the public Colaberry platform repository at upstream commit `4f6b4d5`.

## Past the threshold is not past the cap

| State | When | May be recycled |
|---|---|---|
| in_flight | In `processing` no longer than the threshold | Not stuck |
| past_threshold | Past the threshold, with attempts left | Yes |
| past_attempt_cap | Past the threshold, on its last allowed attempt | **No** |
| unknown | No usable start time, or unusable attempt numbers | No |

Ellis counts the stuck run as an attempt, as the brief's workflow does. A row on attempt
`attempts_made + 1` of `max_attempts` is past the cap when that run was its last allowed one, because
recycling it would run it more times than allowed. The platform does not count a run that hangs
(finding 1), so for each row Ellis also reports what the platform will do with it:

- `recycled_and_rerun`: reset to pending and claimed again;
- `recycled_but_unclaimable`: reset to pending, where the processor never claims it again;
- `never_recovered`: no start time, so the timer never selects it;
- `left_alone`: still within the threshold.

The threshold defaults to the platform's 10 minutes (`backend/src/services/schedulerService.ts:833`) and
is labelled as the platform code value. The brief says K.D. must still state the intended value, so a
different one can be passed in. The cap is each row's own `max_attempts`.

**Slow or stuck.** The records show when a row was claimed, not whether its batch is still working on it.
Each answer gives its batch size (rows in `processing` with the same `processor_id`). A row in a batch of
more than one says it may still be waiting its turn (finding 2).

The report also gives the timer's own run: ran, overdue, failed, disabled or untracked. The timer has an
`ai_agents` row (`backend/src/services/agentRegistrySeed.ts:184`), so its runs are recorded.

## What the code showed

1. **The recovery ignores the attempt cap and never counts the stuck run.** Every row in `processing` for
   more than 10 minutes goes back to `pending`, whatever its attempts (`schedulerService.ts:832-845`).
   `attempts_made` goes up only when a run finishes (`:793-811`, `:1100-1105`), and the claim only checks
   `attempts_made < max_attempts` (`:457`). So a row that hangs every time is recycled every 15 minutes
   with no limit, which is the unbounded retry loop the brief rules out. `max_attempts` defaults to 1
   (`backend/src/models/ScheduledEmail.ts:112-116`), so most single-attempt actions that hang run again.
2. **A slow row can be recovered while its batch is still working on it.**
   - A batch claims up to 40 rows at once (`:461`) and works them one at a time, at least 5 seconds apart
     (`:783`), plus up to 180 seconds of campaign pacing each (`:786-789`). A full batch with pacing runs
     well past 10 minutes.
   - The recovery resets those waiting rows (`:833`). The processor runs every 5 minutes with no overlap
     guard (`:1757-1760`), so a second batch can claim them.
   - The first batch sends from its in-memory copy and marks it sent without re-reading the row
     (`:1100-1105`). The only remaining guard is one outbound message per lead per day, which is lifted
     when the lead replied that day (`:680-695`).
   - So the duplicate does not land on an arbitrary lead. It lands on the lead who just answered: the
     warmest person in the list. That makes this a commercial defect, not only a scheduling one.

   Found by reading the code; not tried.
3. **The recovery keeps no record of what it recovered.** The count goes only to the server log (`:843`);
   the recovered rows are not recorded anywhere, and the run is recorded as a success either way.
4. **The platform's recovery tests never call the recovery.** Both tests build the query in the test and
   check their own values (`backend/src/__tests__/services/schedulerConcurrency.test.ts:113-152`).
   The claim test next to them checks for `FOR UPDATE SKIP LOCKED` in a string it wrote itself
   (`:157-174`). The code's own comment says that clause is not in the claim (`schedulerService.ts:425-428`).
5. **The brief's approval example is a different queue.** This timer only touches `scheduled_emails`.
   Approvals that are marked performed when they were not are a separate replay path, which this timer
   never reaches.

## How to run it

```
npm run stale-actions -- --snapshot examples/stale-actions.example.json [--threshold-minutes 10]
```

The example is not production data. It shows:
- one row within the threshold;
- one row past the threshold with an attempt left, the only recyclable one;
- a single-attempt row and a last-attempt row, both past the cap;
- a row with no start time, which the platform never recovers.

Exit codes:
- 0: nothing stuck and nothing unknown
- 3: something past the threshold or unknown
- 4: something past its attempt cap
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: the answer separates 'past the threshold' from 'past the attempt cap', and the second is not recyclable"
  - "acceptance: a single-attempt action (the platform default) stuck once is past its cap, even though the platform would rerun it"

  There are 12 tests in this file and 112 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - using the platform's rule (cap reached only once `attempts_made + 1 > max_attempts`) fails both acceptance tests;
  - removing the cap check fails 3;
  - accepting a cap of 0 fails 1;
  - treating a row exactly at the threshold as stuck fails 1;
  - not escalating past-cap rows fails 1;
  - treating a row with no start time as in flight fails 1.
- **Not yet run on live records.** No admin screen lists rows in `processing`
  (`getSchedulerStatus` gives counts only, `schedulerService.ts:3634-3637`). The first live check is one
  read-only export of `id, channel, status, attempts_made, max_attempts, processing_started_at,
  processor_id` from `scheduled_emails` where `status = 'processing'`, with the timer's `ai_agents` and
  activity rows.
