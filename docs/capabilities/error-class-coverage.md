# Error classification coverage

**Story:** `platform.CAP.error_class_coverage` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/errorClassCoverage.ts`, `src/inventory/catchSites.ts` · **Tests:** `test/errorClassCoverage.test.ts`

Ellis reports how many recorded failures carry a specific error class, and names every catch site on the cron
path that records none. It reads and reports. The vocabulary of classes is K.D.'s decision, so Ellis measures
against none.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How coverage is measured

- **Over all recorded failures, not over classified ones.** The denominator is every failed row in
  `ai_agent_activity_logs` and every row in `dead_letter_jobs` inside the window (7 days by default). An
  activity row counts as failed when its result is `failed`, `failure` or `error`.
- **A generic class counts as unclassified.** `Error`, `Unknown`, `UnknownError`, `Exception`, an empty value
  and their other spellings all count against coverage. `deadLetterService.ts:46` falls back to `'Error'`,
  which is why a constructor name alone is coverage on paper only.
- **The activity log has no class column,** and `details` is null on the cron path
  (`cronInstrumentation.ts:96`). So Ellis reads `details.error_class` if a writer set one, and otherwise the
  row is unclassified.
- **No failures is unknown.** With nothing recorded, Ellis says coverage is unknown, not 100%.

Each class seen is listed with its rows and marked as named in the platform standard, a language built-in such
as `TypeError`, or other. A built-in counts as classified but is shown apart, because it names how code broke
rather than why.

## Catch sites on the cron path

Ellis reads the six cron wrappers and scheduler files whole, and in any other timer file only the handlers
inside a `cron.schedule` callback.

| Kind | Means | Counts as recording a class |
|---|---|---|
| `records_class` | names `error_class`, `errorClass` or `classifyError` | yes |
| `class_may_be_generic` | records one, but from a constructor name or a generic fallback | yes, and flagged |
| `records_no_class` | writes a failure record with no class | no |
| `rethrows` | passes it on and records nothing | no |
| `logs_only` | only writes to the console | no |
| `silent` | does nothing visible | no |
| `not_read` | hands over to a named function, so Ellis does not guess | no |

## What every answer also says

- Until K.D. decides the vocabulary, classified means only not generic.
- A failure written only to `ai_agents`, as `trackAgentRun` does, has no row here, so it is outside this measure.
- One failure can have both an activity row and a dead-letter row, so the total counts records.
- A runner in another file is not read.

## How to run it

```
npm run error-class-coverage -- --source <platform checkout> --snapshot examples/error-class-coverage.example.json
```

The example uses real job names at `bbde6ef`, with hand-written rows, classes and times. It is not production
data. A snapshot missing either table is refused: a missing table is not an empty one.

Exit codes:
- 0: every recorded failure is classified
- 3: at least one is not
- 4: no failure is recorded, so coverage is unknown
- 1: bad input

## Evidence

- **Named passing test:** "acceptance: coverage is a share of all recorded failures; a generic fallback counts
  as unclassified, not classified". A second, "acceptance: every catch site on the cron path that records no
  class is named", covers the other half.
- **There are 13 tests in this file and 347 in the repo**, all passing under `npm test`.
- **Run on the platform's source at `bbde6ef`,** read from a copy at run time: 162 catch sites across 10 files,
  with the kinds read from the code. With the example rows: exit 3, and 3 of 7 recorded failures classified
  (42.9%). That figure comes from hand-written rows and says nothing about production.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring the
  code. Each of these 38 edits failed at least one test:
  - treating `Error`, or a differently spelled generic value, as a class;
  - reporting no failures as 100%, or as measured;
  - dropping a store from the total or the classified count;
  - counting successes, or missing a failure spelling;
  - ignoring the window, or moving either edge;
  - counting route handlers as cron sites, or missing a wrapper or timer file;
  - counting a possibly generic class as no class;
  - losing a class kind, or claiming a vocabulary is decided;
  - misreading a handler's kind, or a fallback as a real class;
  - reading `catch` in a comment or string, or guessing at a named handler;
  - dropping the limits;
  - wrong exit codes, a missing table, or a bad window.
- **Not yet run on live records.** The first live check is one export of the two tables for a week.
