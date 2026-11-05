# Dead-letter triage

**Story:** `platform.CAP.dead_letter_triage` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/deadLetterTriage.ts` (R2), `src/capabilities/deadLetterReplayRehearsal.ts` (R4) · **Tests:** `test/deadLetterTriage.test.ts`, `test/deadLetterReplayRehearsal.test.ts`

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

## R4: a replay, verified end to end in a sandbox

The rung's acceptance: **replaying the same entry twice produces one set of side effects; if it produces two, the
entry is reported as not replay-safe rather than replayed.**

`npm run dead-letter-replay-sandbox -- --fixture examples/dead-letter-replay.fixture.json` (exit 0 verified, 3 not, 1 bad input).

**The job family is publishing.** Publishing jobs dead-letter on their own row (`backend/src/models/PublishingJob.ts:108-109`
at `350243226`) and carry an `idempotency_key` (`:98`) that the worker passes to the provider
(`services/publishing/publishingWorker.ts:226`). The other store, `dead_letter_jobs`, keeps no job input, only
`last_failed_at` (`services/deadLetterService.ts:48`), so it has nothing to replay.

**How Ellis triages an entry.** Before replaying, Ellis replays the entry twice on a throwaway copy of its provider
account. It then counts the posts carrying its content, including any post the failed attempt made before the job
was dead-lettered.
- **One post:** the entry is replay-safe. It is replayed once on the sandbox queue and marked resolved.
- **More than one:** it is reported as not replay-safe. It is not replayed, and stays open with the queue as it was.

The sandbox providers follow the platform's three behaviours:
- **Keyed** returns the earlier post for the same key at any age (`services/publishing/dryRunAdapter.ts:22`).
- **Text window** is Meta. It has no idempotency key (`metaAdapter.ts:198-199`); its flows return a post with the same
  text from the last six hours instead of posting again (`metaPublish.ts:22`, `:68`, `:106`, `:240`).
- **None** posts every time.

| Entry | Provider | Earlier post | Posts after two trial replays | Verdict |
|---|---|---|---|---|
| `pjob-keyed-1` | keyed | none | 1 | replay-safe, replayed once |
| `pjob-keyed-posted` | keyed | 8 hours before | 1 | replay-safe, replayed once |
| `pjob-window-recent` | text window | 3 hours before | 1 | replay-safe, replayed once |
| `pjob-window-stale` | text window | 8 hours before | 2 | not replay-safe, not replayed |
| `pjob-unkeyed` | none | none | 2 | not replay-safe, not replayed |

`pjob-window-stale` is the case that matters for this platform. A Meta post that landed before the job failed is
protected only for six hours. A replay after that puts the same text on the Page a second time. At exactly six
hours, the earlier post is outside the window.

**The control.** A triage that replays without the trial runs on the same entries. It puts a second post on
`pjob-window-stale` and `pjob-unkeyed`. Graded as the subject instead of Ellis's triage, it misjudges every entry and
leaves duplicates.

**What this does not prove.**
- No real provider was called.
- Each sandbox account holds only the entry's own posts, so other content on the same Page is not run.
- A side effect here is a post. Event rows and attempt counts repeat on every run by design and are not counted.
- The trial runs both replays at triage time. A replay much later than its trial can fall outside the window the
  trial relied on.
- Replaying in production re-fires real side effects, so it stays a person's decision, and the ladder stops at R4.

**Tested:** 10 tests, including the acceptance test named after the criterion. 37 deliberate breaks, all caught. The
first run caught 36 of 43. Six survivors were parts of two checks that held by construction: a safe verdict always
replays once, and an unsafe one never does. Both were replaced by one check on the outcome: no entry ends with a
duplicate post. The seventh was the text condition in the window, which the sandbox accounts never exercise. It is
named as a limit instead. Its rung story id is on the platform board but not yet in this repository's plan, so it is
recorded here and in the commit.
