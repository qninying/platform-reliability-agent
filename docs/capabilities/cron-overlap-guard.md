# Cron overlap guard

**Story:** `platform.CAP.cron_overlap_guard` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/cronOverlapGuard.ts`, `src/inventory/claimSites.ts`, `src/cli/overlapGuard.ts` · **Tests:** `test/cronOverlapGuard.test.ts`

This first release answers from records and source. It names every timer whose recorded duration can exceed its
own interval, gives both figures, and says which jobs hold their own claim. It changes no timer. Applying a guard
is a deploy, and that stays a person's.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How it decides

For each timer, Ellis takes the shortest gap between fires and compares it with what was recorded.

| Verdict | Means |
|---|---|
| `can_overlap` | Two recorded runs really overlapped, or the worst run or the average exceeds the interval |
| `not_seen_to_overlap` | The worst recorded run fits. This is not "safe" |
| `unassessable` | Ellis cannot tell, and says why |

**Worst run, not average.** A job that usually takes 5 seconds and once took 5 minutes is the job that overlaps.
The worst run comes from `duration_ms` on each activity row. The average on the `ai_agents` row is weaker:
`instrumentCronJob` writes it from a copy read before the run (`services/cronInstrumentation.ts:28`, `:68-72`), so
overlapping runs overwrite each other's counters. An average alone can flag a timer, but it can never clear one.

**Real overlaps, as well as predicted ones.** Each activity row is written after the run, so its start is
`created_at - duration_ms`. Two runs of one job whose spans cross are a recorded overlap, with both row ids. This
also catches a job on two timers, which an interval comparison cannot see.

**Reasons a timer is unassessable**

| Reason | Means |
|---|---|
| `no_agents_row` | The job runs with no record (`cronInstrumentation.ts:36-39`) |
| `no_run_name` | The timer names no run Ellis can read |
| `no_row_named` | The registry entry records under no row Ellis can read |
| `no_duration_recorded` | There is a row, but no duration on it |
| `average_only` | The row has an average and no per-run record, as with `trackAgentRun` |
| `schedule_not_read` | The schedule is not a literal cron expression |

## Which jobs hold their own claim

Ellis reads source text for three kinds of claim: an update conditional on the state it read
(`services/publishing/publishingWorker.ts:290-295`), `FOR UPDATE SKIP LOCKED`, and a Postgres advisory lock. It
follows each timer one hop, into the function it imports. A claim deeper than that is listed as not tied to a timer.

A claim never changes the verdict. A job with a claim can still overlap; the claim is what stops the two runs
competing for the same work, and only for the part of the job it covers.

## What a guard would need

This is for whoever applies the guard. Adding `noOverlap: true` to these timers would not be enough, for two reasons.

1. **The callback must return the run.** node-cron 4.2.1 blocks a tick only while the promise from the callback
   is unsettled (`scheduler/runner.js:70`, `:113`). The usual shape here is
   `() => { instrumentCronJob(...).catch(...); }`, which returns nothing, so the task looks finished at once.
   Each timer's answer carries `callback_holds_run`.
2. **It is per process.** A job that can run on two instances needs a database claim instead.

Each timer's answer shows both fields, so the work per timer is visible before anyone starts.

## How to run it

```
npm run overlap-guard -- --source <platform checkout> --snapshot <records.json> [--window-days 30]
```

The snapshot holds `ai_agents`, `ai_agent_activity_logs` and `cron_schedule_configs`. A missing table is refused:
it is not an empty one. `examples/overlap-guard.example.json` shows the shape with invented names.

Exit 0: every timer assessed, none can overlap. Exit 3: at least one can. Exit 4: none can, but some cannot be
assessed, so the answer is not "all clear". Exit 1: bad input.

## Failure paths

| What goes wrong | What happens |
|---|---|
| A table is missing from the snapshot, or the JSON or date is bad | Refused, exit 1, nothing reported |
| The checkout is missing or not the platform | Refused, exit 1 |
| No records at all | Every timer is unassessable, exit 4, never all clear |
| A row has no duration | It is skipped for the worst run and still counted in `runs_in_window` |
| A file a timer needs cannot be read | Refused, exit 1, rather than a partial list |

There is nothing to retry: one read, no network and no writes. Running it twice gives the same answer.

## How it was tested

All tests ran on 2026-10-31 with `node --test` and `tsc --noEmit`.

- **Fixture tests:** `test/cronOverlapGuard.test.ts` runs 23 tests over a small checkout shaped like the platform.
  They cover the acceptance criterion, exact boundaries, the window, governance overrides, claim tracing, the CLI
  exit codes and repeatability.
- **Mutation pass:** I made 40 deliberate edits to the three source files, ran the tests after each, then
  restored the files and compared them byte for byte. The first pass caught 32 of 40; I added tests for the
  survivors and removed one redundant import merge. The final pass, also 40 edits, caught all 40.
- **Source run:** against a copy of platform `bbde6ef` with an empty snapshot, it found 204 timers, exit 4. All 204
  were unassessable, as they should be with no records, and it tied the publishing worker's claim to
  `MarketingPublishingWorker`.

**Not tested:** it has not run against production records, so no real duration, interval comparison or observed
overlap has been read yet. That needs a snapshot taken by someone with access.

## Limits

- Not seen to overlap is not safe: it means no recorded run exceeded the interval in the window.
- A job that ran few times has a worst run drawn from few runs; `runs_in_window` says how few.
- The interval is the shortest gap in UTC over the next eight days. The platform schedules in America/Chicago, so
  a gap across a clock change can differ by an hour.
- A run that never finished has no row, so an overlap with it is not seen.
- A claim is read from text, not proved. `none_found` does not prove there is none.
- Whether the platform runs each timer in one process is not read here.
- Timers with no `ai_agents` row stay unassessable until they are registered.

## Decisions left open

**K.D.:** should a skipped tick be recorded as a missed run? It changes what the missed-run detector reports. The
answer carries this as `policy_open`, and Ellis assumes nothing.

## What comes next

The later steps on the ladder build the guard and prove it in the sandbox: force a long run and confirm the second
tick is skipped. The twice-run harness from the idempotency audit is the starting point. Applying it to live timers
stays a reviewed deploy, so the ladder stops at R4.
