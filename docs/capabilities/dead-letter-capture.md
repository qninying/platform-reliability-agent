# Dead-letter capture

**Story:** `platform.CAP.dead_letter_capture` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/deadLetterCapture.ts`, `src/inventory/timerHomes.ts` (R2), `src/capabilities/deadLetterRehearsal.ts` (R4) · **Tests:** `test/deadLetterCapture.test.ts`, `test/deadLetterRehearsal.test.ts`

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

## R4: the capture path, exercised in a sandbox

The rung's acceptance: **three consecutive failures write exactly one row; a restart between failures two and three
writes none. The second case is the positive control for the in-memory counter's real behaviour.**

`npm run dead-letter-sandbox -- --fixture examples/dead-letter.fixture.json` (exit 0 verified, 1 bad input).

This rung builds no new guard. It runs the platform's own capture logic, as it stands at `350243226`, against a
sandbox job seeded to fail and a sandbox `dead_letter_jobs` table. The logic:
- counts consecutive failures in memory (`backend/src/services/deadLetterService.ts:19`);
- resets the count on a success (`:32`);
- writes one row when the count reaches 3 (`:17`, `:39-51`);
- records the error class as the class name, then the error's name, then `Error` (`:46`);
- clears the count after the write, whether the write succeeded or not (`:53-59`).

The sandbox job throws a `TimeoutError`. Five cases run:

| Case | Rows written | With a durable counter |
|---|---|---|
| Three failures in a row | 1, error class `TimeoutError` | 1 |
| Two failures, a restart, one failure | **0** | 1 |
| Two failures, a success, one failure | 0 | 0 |
| Six failures in a row | 2, each at a count of 3 | 2 |
| Two failures, a failed table write, three more failures | 1; the failed write left no row and no error | 1 |

**The contrast.** A counter that survives a restart runs on the same steps. It writes the row the in-memory counter
loses, so the restart case can tell the two apart. With the counters swapped, the restart case fails. The platform's
file calls the reset on restart intended (`deadLetterService.ts:11-13`). This rung records the behaviour and does not
propose a change.

**What the error class records.** The class's name comes first. An `Error` whose `name` was changed is still recorded
as `Error`, and a thrown string is recorded as `String`.

**What this does not prove.** The real wrapper and the real table were not run. One job and one error class are run;
two processes failing the same job, each with its own counter, are not. Nothing on the platform reads
`dead_letter_jobs`, so a row written is recorded, not seen. Reading it is the triage capability.

**Tested:** 11 tests, including the acceptance test named after the criterion. 32 deliberate breaks: 31 caught. The
first run caught 28 of 41. Three changes fixed most of the rest:
- The seeded error now has a real class, so the tests can tell the class name from the error name. Before, both were
  the same.
- Each check now compares a case's rows with the number expected for it. Before, the checks were written out by hand,
  and a valid fixture could never fail them.
- Two adapter breaks had hit another adapter's identical line, and now target this one.

Two breaks are left out because they cannot change the result: the count never passes 3, so `>=` against `===`, and
the recorded count against the constant 3, behave the same.

The one survivor is the command's exit code 3. Every valid fixture verifies, because the rehearsal runs fixed logic;
only a change to the code can make it fail.

Its rung story id is on the platform board but not yet in this repository's plan, so it is recorded here and in the
commit.
