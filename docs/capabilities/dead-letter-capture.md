# Dead-letter capture

**Story:** `platform.CAP.dead_letter_capture` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/deadLetterCapture.ts`, `src/inventory/timerHomes.ts` · **Tests:** `test/deadLetterCapture.test.ts`

Ellis reports what has been dead-lettered, by error class, and names the job families that cannot
dead-letter. An empty queue is never reported as a healthy fleet. Ellis reads the queue and never writes to
it.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## An empty queue is not a clean answer

With nothing dead-lettered, Ellis says:

> Nothing is dead-lettered in either mechanism. That does not mean the fleet is healthy. Only 11 of 202 jobs
> can dead-letter. The rest cannot, or Ellis cannot tell: wrapped_but_swallowed (87), dynamic_registry (11),
> inline (79), other_timers (14).

The coverage line appears beside any rows too. Exit code 4 means the queues are empty, so a script cannot
read an empty queue as a pass.

## The job families

Read from the platform's source at run time. Each family lists its jobs by name.

| Family | Can dead-letter | Why | Jobs at `bbde6ef` |
|---|---|---|---|
| `wrapped_but_swallowed` | no | wrapped, but the runner catches the failure and never rethrows, so the wrapper sees a success | 87 |
| `dynamic_registry` | no | not wrapped: `startDynamicTask` calls `instrumentCronJob` directly | 11 |
| `inline` | no | not wrapped: registered with `cron.schedule` | 79 |
| `other_timers` | no | not wrapped, and names no `instrumentCronJob` run, so listed by file and line | 14 |
| `unknown` | cannot tell | wrapped, but Ellis could not read how its runner handles a failure | 0 |
| `can_dead_letter` | yes | wrapped, and a failure reaches the wrapper | 11 |

Being wrapped is not enough. `wrapWithDeadLetter` counts only an error that reaches it
(`services/deadLetterService.ts:25-34`), and it is applied in `startStandardTask` only
(`services/aiOpsScheduler.ts:554`). What each runner does with a failure:

| Runner | What it does with a failure | Where |
|---|---|---|
| `runAgent` | catches it and returns null | `aiOrchestrator.ts:300`, `:333` |
| `runHealthScans` | catches it | `aiOrchestrator.ts:157` |
| `instrumentCronJob` with a row | catches it | `cronInstrumentation.ts:61` |
| `trackAgentRun` | rethrows it | `agentRunTracker.ts:98` |
| a workforce director | has no catch around its run | `workforce/directorActions.ts:41` |

If the wrapping moves, Ellis refuses to answer rather than report families that no longer hold. It checks
both task starters and looks for the wrapper anywhere else in the source.

## What is reported

- **`dead_letter_jobs`, by error class:** the row count, each job with its family, first and last time, and
  the row ids.
- **`publishing_jobs`, by error class:** rows with `dead_lettered_at` set, reported separately. These are
  two mechanisms with no shared view, so there are two answers.
- **Error messages, stacks and context are never repeated.** Only whitelisted fields leave the module.

## What every answer also says

- A row means at least three consecutive failures. The count clears after each write, so one long failure
  writes a row every third run.
- The count is in memory, so a restart starts it again (`deadLetterService.ts:19`). A job failing once per
  deploy never reaches three.
- `instrumentCronJob` rethrows only when the job has no `ai_agents` row (`cronInstrumentation.ts:29-38`), so
  such a job can still dead-letter. This report reads the code, not the rows.
- A job that catches its own errors inside its runner never reaches the wrapper. This report reads the
  wrapper layer only.
- `resolved` means nothing yet: no code sets it (`deadLetterService.ts:49-50`).

## How to run it

```
npm run dead-letters -- --source <platform checkout> --snapshot examples/dead-letters.example.json
```

The example uses real job names at `bbde6ef`, with hand-written rows, classes and times. It is not
production data. A snapshot missing either table is refused: a missing table is not an empty one.

Exit codes:
- 0: something is dead-lettered
- 4: the queues are empty
- 1: bad input, or the wrapping has moved

## Evidence

- **Named passing test:** "acceptance: the report names the unwrapped job families explicitly, so an empty
  queue is never read as a healthy fleet".
- **There are 10 tests in this file and 303 in the repo**, all passing under `npm test`.
- **Run on the platform's source at `bbde6ef`**, with the example rows: exit 0, and 11 of 202 jobs can
  dead-letter. With empty queues: exit 4, with the statement above. The 202 are read from the source, and the
  family counts come from how the code handles a failure, not from observed failures.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring the
  code. Each of these 23 edits failed at least one test:
  - dropping "does not mean the fleet is healthy", or the coverage line beside rows;
  - moving a swallowing runner into `can_dead_letter`, or `trackAgentRun` or a director out of it;
  - reading an unknown, dynamic or inline job as another family;
  - hiding a timer that passes a variable named `schedule`, listing the registry starters, or counting an
    inline timer twice;
  - ignoring moved wrapping, a wrapper elsewhere, or an unreadable starter;
  - reading a name inside a string as a wrapper call;
  - ignoring publishing dead letters, or counting every publishing job;
  - repeating raw rows;
  - dropping the limits;
  - counting unknown jobs as able to dead-letter;
  - reading `runAgent` with a constant name as unknown;
  - exiting 0 on empty queues;
  - accepting a missing table.
- **Not yet run on live records.** The first live check is one export of both tables. Any row for a job in
  `wrapped_but_swallowed` should be looked at: it would mean a failure reached the wrapper by a path this
  report does not describe, such as a job with no `ai_agents` row.
