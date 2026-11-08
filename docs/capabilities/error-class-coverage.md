# Error classification coverage

**Story:** `platform.CAP.error_class_coverage` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/errorClassCoverage.ts`, `src/inventory/catchSites.ts` (R2), `src/capabilities/errorClassRehearsal.ts` (R4) · **Tests:** `test/errorClassCoverage.test.ts`, `test/errorClassRehearsal.test.ts`

Ellis reports how many recorded failures carry one of the six standard error classes, and names every catch
site on the cron path that records none. It reads and reports.

**K.D. decided on 2026-11-08:** keep the six standard classes (`TimeoutError`, `RateLimitError`, `AuthError`,
`ValidationError`, `UpstreamUnavailable`, `ContractViolation`), with "unclassified" for the rest, for now. K.D.
revisits the set once there are real failure counts. Until that day Ellis counted any class that was not generic;
it now counts only the six, spelled exactly.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How coverage is measured

- **Over all recorded failures, not over classified ones.** The denominator is every failed row in
  `ai_agent_activity_logs` and every row in `dead_letter_jobs` inside the window (7 days by default). An
  activity row counts as failed when its result is `failed`, `failure` or `error`.
- **A generic class counts as unclassified.** `Error`, `Unknown`, `UnknownError`, `Unclassified`, `Exception`, an empty value
  and their other spellings all count against coverage. `deadLetterService.ts:46` falls back to `'Error'`,
  which is why a constructor name alone is coverage on paper only.
- **The activity log has no class column,** and `details` is null on the cron path
  (`cronInstrumentation.ts:96`). So Ellis reads `details.error_class` if a writer set one, and otherwise the
  row is unclassified.
- **No failures is unknown.** With nothing recorded, Ellis says coverage is unknown, not 100%.

Each class seen is listed with its rows and marked as one of the six, a language built-in such as `TypeError`, or
other. Only the six count as classified. Each store's count of unclassified rows is split into no class, a generic
class, and a named class outside the six (`outside_the_six`), so a library name such as `SequelizeTimeoutError`
shows up by name rather than disappearing into a total.

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

- Classified means one of the six standard classes, as K.D. decided on 2026-11-08 for now.
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
  with the kinds read from the code. With the example rows: exit 3, and 1 of 7 recorded failures classified
  (14.3%) under the six-class rule (3 of 7, 42.9%, under the earlier not-generic rule). That figure comes from hand-written rows and says nothing about production.
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
- **The six-class rule (2026-11-08):** one new test covers each of the six, a class outside them, the three kinds
  of unclassified, and that case and padding matter. Eight deliberate breaks, across this check and the R4
  rehearsal; the first pass left one uncaught (a padded name accepted), which gained a test, and all eight are caught.
- **Not yet run on live records.** The first live check is one export of the two tables for a week.

## R4: the cron path, classified in a sandbox

The rung's acceptance: **seeded timeout, rate-limit and validation failures land in three distinct classes and none in
the generic class.**

`npm run error-class-sandbox -- --fixture examples/error-class.fixture.json` (exit 0 verified, 3 not, 1 bad input).

**Today, at `bc936a315`.** The cron path records the message and stack and no class
(`backend/src/services/cronInstrumentation.ts:63-64`), and writes `details: null` (`:96`). The one rule that records a
class is the dead-letter path's `err?.constructor?.name || err?.name || 'Error'` (`deadLetterService.ts:46`).

**Ellis's classifier** reads what a failure is, not the class it was thrown as, and maps it to the six classes the
platform standard names (`CLAUDE.md:672`). The rules apply in a fixed order:
- a class already set from the vocabulary;
- a timeout code or name, or HTTP 408, is a timeout;
- HTTP 429 is a rate limit;
- HTTP 401 or 403 is an auth failure;
- a validation error name, or HTTP 400 or 422, is a validation failure;
- a connection code, or HTTP 500 and above, is an upstream failure;
- `ContractViolation` keeps its name.

Anything else is recorded as `Unclassified`, which counts as generic. Messages are not parsed, because a guess from
wording would group wrongly. A sandbox cron wrapper persists the class in `details.error_class`, beside the message.

**Seeds.** Eleven failures, each an instance of the class its library throws, with that library's fields:
- three timeouts (axios, fetch, undici);
- two rate limits (axios, and an SDK that throws `RateLimitError`);
- three validation failures (zod, Sequelize, an HTTP 422);
- an auth failure, and a refused connection;
- a plain `Error` that says "timed out" only in words.

| | Timeout | Rate limit | Validation | Coverage over all 11 |
|---|---|---|---|---|
| Ellis's classifier | `TimeoutError` | `RateLimitError` | `ValidationError` | 10 (91%); the plain `Error` is `Unclassified` |
| The platform's rule | `AxiosError`, `DOMException`, `HeadersTimeoutError` | `AxiosError`, `RateLimitError` | `ZodError`, `ValidationError`, `AxiosError` | 2 (18%) under the six-class rule; 9 (82%) counting any name |

**The control.** The platform's rule names a class for 9 of the 11, only 2 of them among the six, and it groups nothing: `AxiosError` covers a
timeout, a rate limit, a validation failure and an auth failure. This is the story's "coverage on paper only", shown
on seeds rather than assumed. It is right on two seeds, the ones whose library class already matches the vocabulary.
Graded as the subject, it fails the acceptance and the other nine seeds.

**What this does not prove.** The vocabulary is the standard's six classes, which K.D. kept on 2026-11-08 for now. A failure
carrying no code, status or library name stays `Unclassified`. The seeds follow common libraries; an error from
another library may carry its signal elsewhere. Persisting the class on the platform is a change to
`cronInstrumentation.ts`, shipped by a reviewed deploy, so the ladder stops at R4.

**Tested:** 11 tests, including the acceptance test named after the criterion. 56 deliberate breaks, all caught. The
first run caught 55 of 58. One survivor gained a test (a vocabulary class set under `error_class`). Two were a
"class persisted" check that compared each row with a value read back from the same row, so it could not fail; it was
removed, and the test of the wrapper's persisted row stays.

Two corrections came before the tests. Three seeds first used a plain `Error` where the real library throws a named
class (`HeadersTimeoutError`, an SDK's `RateLimitError`, Sequelize's `ValidationError`). That understated the
platform's rule, and they now follow the libraries. The R2 measure now also counts `Unclassified` as generic.

Its rung story id is on the platform board but not yet in this repository's plan, so it is recorded here and in the
commit.
