# Stale action recovery

**Story:** `platform.CAP.stale_action_recovery` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/staleActionRecovery.ts` (R2), `src/capabilities/staleRecoveryRehearsal.ts` (R4) · **Tests:** `test/staleActionRecovery.test.ts`, `test/staleRecoveryRehearsal.test.ts`

At R2, Ellis answers **"what is stuck right now, for how long, and on which attempt?"** from the records,
and only reads. At R4, Ellis runs the platform's recovery against a sandbox queue and shows it does the
right thing. Recovering a live action changes work state and `production_database` is default-denied, so
the platform's own timer does the live recovering, never an agent.

Platform facts cite the public Colaberry platform repository at upstream commit `c150d4c48`. R2 was first
built against `4f6b4d5`; the platform changed its recovery on 27 October (`a2d4e6cd7`), and R2 now
reports what the current code does.

## R2: past the threshold is not past the cap

| State | When | May be recycled |
|---|---|---|
| in_flight | In `processing` no longer than the threshold | Not stuck |
| past_threshold | Past the threshold, with attempts left | Yes |
| past_attempt_cap | Past the threshold, on its last allowed attempt | **No** |
| unknown | No usable start time, or unusable attempt numbers | No |

Ellis counts the stuck run as an attempt, and so does the platform now. A row on attempt
`attempts_made + 1` of `max_attempts` is past the cap when that run was its last allowed one, because
recycling it would run it more times than allowed. For each row Ellis also reports what the platform
will do with it:

- `recycled_and_rerun`: back to pending with an attempt spent, and claimed again;
- `failed_not_recycled`: failed with the attempt counted, so it does not run again;
- `never_recovered`: no start time, so the timer never selects it;
- `left_alone`: still within the threshold.

The threshold defaults to the platform's 10 minutes (`backend/src/services/scheduling/claimLease.ts:32`)
and is labelled as the platform code value. The brief says K.D. must still state the intended value, so a
different one can be passed in. The cap is each row's own `max_attempts`.

**Slow or stuck.** The records show when a row was claimed, not whether its batch is still working on it.
Each answer gives its batch size (rows in `processing` with the same `processor_id`). A row in a batch of
more than one says it may still be waiting its turn.

The report also gives the timer's own run: ran, overdue, failed, disabled or untracked. The timer has an
`ai_agents` row (`backend/src/services/agentRegistrySeed.ts:217`), so its runs are recorded.

## R4: recovery run against a sandbox queue

The rung's acceptance: **the slow action is untouched, the cap-exceeded action is parked not recycled, and
two concurrent recovery runs produce one recovery, not two.**

Ellis mirrors the platform's recovery (`claimLease.ts:81-120`) on an in-memory copy of the queue, with
every write journaled. The race it runs:

1. Two recovery runs, A and B, read the queue at the same moment. Both see the same stale rows.
2. The slow row's owner is alive and renews its claim, as the platform's batch does before each send
   (`claimLease.ts:55-67`, called at `schedulerService.ts:539`).
3. Both runs write. Each write re-tests its condition at write time, as the platform's single `UPDATE ...
   WHERE` does, so run B finds the rows already taken and the renewed slow row no longer stale.

On the example fixture: the stuck row is requeued once, by run A, with one attempt spent; the row on its
last attempt is failed, never sent back to pending; the slow row, a fresh row and a pending row are
untouched; run B read the stuck row and recovered nothing.

**The harness can fail.** The same race is run again without the write-time re-check. It must then
recover a row twice and the slow row under its owner, or the rehearsal is not verified: a check that
cannot catch double recovery proves nothing. A fixture with no slow or no capped row is also not
verified, because that part of the rung was not exercised.

**What this does not prove.** Concurrency is modelled as read-then-write with a re-check; it shows the
logic holds, not the database's locking. One interleaving is run. What a requeued row does when it is
next claimed is not run here. Each answer states these limits.

## What the code showed (at `4f6b4d5`), and what happened

All four were fixed upstream on 27 October in `a2d4e6cd7`.

1. **The recovery ignored the attempt cap and never counted the stuck run,** so a row that hung every
   time was recycled every 15 minutes with no limit. Recovery now spends an attempt and fails a row with
   none left (`claimLease.ts:81-120`).
2. **A slow row could be recovered while its batch was still working on it, and sent twice,** landing on
   the lead who had just replied. The batch now renews its claim before each send and skips a row
   recovered meanwhile (`claimLease.ts:55-67`, `schedulerService.ts:539`). A waiting row can still be
   recovered, but it is no longer sent twice.
3. **The recovery kept no record of what it recovered.** It now logs the ids of every row it touched
   (`schedulerService.ts:848-858`). The ids go to the server log only, not to a table.
4. **The platform's recovery tests never called the recovery.** They were deleted and replaced by tests
   against the real function (`backend/src/__tests__/services/schedulerConcurrency.test.ts:108-118`).

The brief's approval example is a different queue: this timer only touches `scheduled_emails`.

## How to run it

```
npm run stale-actions -- --snapshot examples/stale-actions.example.json [--threshold-minutes 10]
npm run stale-recovery-sandbox -- --fixture examples/stale-recovery.fixture.json
```

The R4 command exits 0 when the rehearsal is verified, 3 when it is not, and 1 for bad input. The R2
command's codes are below.

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
  - R2: "acceptance: the answer separates 'past the threshold' from 'past the attempt cap', and the second is not recyclable"
  - R2: "acceptance: a single-attempt action (the platform default) stuck once is past its cap, and the platform fails it rather than rerunning it"
  - R4: "acceptance (R4): the slow action is untouched, the cap-exceeded action is parked not recycled, and two concurrent runs produce one recovery, not two"

  There are 12 tests for R2 and 11 for R4, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - R2: using a cap reached only once `attempts_made + 1 > max_attempts` fails both acceptance tests;
    removing the cap check fails 3; accepting a cap of 0 fails 1; treating a row exactly at the threshold
    as stuck fails 1; not escalating past-cap rows fails 1; treating a row with no start time as in flight
    fails 1; reporting a requeued row as failed fails 1, and a capped row as rerun fails 2.
  - R4: removing the write-time re-check fails 4; an off-by-one cap fails 4; recycling the capped row
    fails 4; a requeue that spends no attempt fails 1; letting any processor renew fails 1; a slow owner
    that never renews fails 3; halving the threshold fails 1; a harness check that always passes fails 1;
    not recording what each run read fails 1. A third, sequential run was removed: after the race nothing
    is stale, so it could not fail, and run B already shows a second run changes nothing.
- **R4 is sandbox only.** The queue is an in-memory copy; nothing reaches a database. Its rung story id is
  on the platform board but not yet in this repository's plan, so it is recorded here and in the commit.
- **Not yet run on live records.** No admin screen lists rows in `processing`. The first live check for R2
  is one read-only export of `id, channel, status, attempts_made, max_attempts, processing_started_at,
  processor_id` from `scheduled_emails` where `status = 'processing'`, with the timer's `ai_agents` and
  activity rows.
