# Dead-letter triage

**Story:** `platform.CAP.dead_letter_triage` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/deadLetterTriage.ts` · **Tests:** `test/deadLetterTriage.test.ts`

Ellis puts both dead-letter stores into one queue, grouped by error class, and proposes what to do with each
entry. A person decides at every autonomy level: replaying, abandoning and marking resolved are never Ellis's.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## An empty queue

With nothing open, Ellis says:

> The queue is empty, and here is what could not have reached it. 191 of 202 jobs could not have reached it:
> wrapped_but_swallowed (87), dynamic_registry (11), inline (79), other_timers (14). Also out of reach: a job
> in a can_dead_letter family that failed fewer than three times in a row; a failure count cleared by a
> restart, because the count is held in memory; a job that catches its own errors inside its runner. This is
> not a healthy fleet.

The families and their job names come with the answer, from [dead-letter capture](dead-letter-capture.md).
Exit code 4 means the queue is empty, so a script cannot read it as a pass.

## How the queue is built

- **One group per error class, across both stores.** Each group gives its rows, jobs and stores.
- **Open means open.** A `dead_letter_jobs` row is open until `resolved` is set. A publishing job is open in
  state `failed` or `dead_lettered`. Cancelling leaves `dead_lettered_at` set
  (`publishingReceiptService.ts:95-113`), so cancelled jobs are listed as closed, not queued.
- **A class is not proof of one fault.** Each group counts its distinct errors, comparing messages with ids
  and numbers removed. `Error`, `TypeError` and an unrecorded class are flagged as too broad. Several jobs
  sharing one error are flagged as one fault to look for first.
- **Row ids, never message text.** Messages, reasons and stacks stay in the store; a person reads them by id.

## What Ellis proposes

| Entry | Evidence | Proposal |
|---|---|---|
| Job ran without error since its last dead letter | `ran_clean` | abandon, once a person checks the failed work did not matter |
| Job's last run failed | `still_failing` | fix and replay |
| Job has not run since | `no_run_since` | read first |
| No run Ellis can read, as with a director | `not_readable` | read first |
| No timer carries the name | not in source | abandon |
| Publishing job in state `failed` | the worker called it permanent | fix and replay |
| Publishing job in state `dead_lettered` | attempts exhausted | recover by replay |

The evidence comes from `ai_agents`. `trackAgentRun` moves `last_run_at` on every run and `last_error_at` only
on a failure (`agentRunTracker.ts:53`, `:90-96`), so stamps within 5 seconds of each other are a failed run.

## What every answer also says

- **Replay is unproven for every entry.** Running a job again re-fires its side effects, and per-job
  idempotency is a separate capability, not yet built.
- **How a person acts.** A `dead_letter_jobs` row holds no payload (`deadLetterService.ts:48`), so the job's
  next scheduled run is the replay. Marking it resolved is a production write by a person, and the row has no
  reason column. A publishing job is retried or cancelled on the admin routes
  (`routes/admin/publishingRoutes.ts`); retrying publishes outward.
- **`ran_clean` reads the last run only.** It does not mean the failed work was redone.

## How to run it

```
npm run dead-letter-triage -- --source <platform checkout> --snapshot examples/dead-letter-triage.example.json
```

The example uses real job names at `bbde6ef`, with hand-written rows, messages, stamps and times. It is not
production data. A snapshot missing any of its three tables is refused: a missing table is not an empty one.

Exit codes:
- 0: entries are open
- 4: the queue is empty
- 1: bad input, or the dead-letter wrapping has moved

## Evidence

- **Named passing test:** "acceptance: an empty queue is reported as 'empty, and here is what could not have
  reached it', never as a healthy fleet".
- **There are 19 tests in this file and 322 in the repo**, all passing under `npm test`.
- **Run on the platform's source at `bbde6ef`.** With empty tables: exit 4, with the statement above. With the
  example: exit 0, 7 open in 4 error classes, and one cancelled job listed as closed.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring the
  code. Each of these 38 edits failed at least one test; two needed a new assertion first:
  - dropping any part of the empty statement, or naming the wrong families;
  - queueing resolved rows, cancelled jobs or every lettered job, or dropping either publishing state;
  - dropping publishing from the count, or a store from the distinct errors;
  - measuring from the first dead letter, or moving the no-run boundary;
  - always or never reading a failed run, or shrinking its 5-second gap;
  - reading a job under its registry name instead of its `ai_agents` row;
  - changing any proposal in the table above;
  - not removing ids or numbers from messages, or counting a missing message;
  - dropping the broad-class flag, or calling one job's error a shared fault;
  - calling replay proven, or dropping the limits;
  - mixing publishing providers, or changing the sort;
  - exiting 0 on an empty queue, or accepting a missing table.
- **Not yet run on live records.** The first live check is one export of `dead_letter_jobs`,
  `publishing_jobs` and `ai_agents`.
