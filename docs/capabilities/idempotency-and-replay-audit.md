# Idempotency and replay-safety audit

**Story:** `platform.CAP.idempotency_and_replay_audit` · **Autonomy:** starts R0, first release R1, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/sandbox/twiceRun.ts`, `src/sandbox/publishingJobs.ts`, `src/capabilities/idempotencyAudit.ts` (R1), `src/sandbox/platformJobs.ts`, `src/capabilities/replayVerdicts.ts` (R4) · **Tests:** `test/idempotencyAudit.test.ts`, `test/replayVerdicts.test.ts`

This first release builds the twice-run harness and its fixtures for one job family, publishing. It proves the
harness, not any platform job: every platform job stays unknown until it has been run twice in a sandbox.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How the harness works

Each job runs from a fresh copy of the same fixture, in memory:

1. **Once,** which captures the baseline end state.
2. **Twice in a row,** compared with the baseline.
3. **Twice at once,** compared with the baseline. The cron path has no overlap guard, so a job that passes step 2
   can still double up here.

End state means every row and every external effect. An effect is an entry in the harness's list, never a post.
Nothing here can reach a database, a provider or the network.

**If it cannot fail, it cannot pass:**
- A first run that changed nothing is unknown: a second run proves nothing.
- A run that threw is unknown: it never finished.
- If the deliberately unsafe job is not caught, or any fixture job gets the wrong verdict, the whole result is
  refused with exit 3.

## The fixture jobs

The publishing worker was chosen because it holds the one job-level defence on the cron path: an update
conditional on the state it read (`services/publishing/publishingWorker.ts:290-295`). These are models of that
code, not the code. Ellis finds the claim in the source on each run and refuses if it has moved.

| Job | Models | Twice in a row | At once | Verdict |
|---|---|---|---|---|
| `claimed_publish` | the worker's conditional claim | safe | safe | safe |
| `unclaimed_publish` | the worker without its claim | safe | unsafe | safe in sequence only |
| `unguarded_publish` | deliberately non-idempotent | unsafe | unsafe | unsafe |
| `nothing_to_do` | a run that changes nothing | unknown | unknown | unknown |
| `throws` | a run that fails | unknown | unknown | unknown |

## What every answer also says

- Verdicts here are about fixture models. An untested platform job is unknown, whatever its code looks like.
- A job that sends email or writes externally cannot be double-run to test it, so a later verdict on one rests on
  a sandbox or on inspection, and says which.
- Overlap is tested at the points a job awaits, in one fixed order, so a pass does not cover every timing.
- A crash between the external effect and the state write is not tested here.
- Remediation ships through a reviewed deploy by a person. Ellis changes no job.

## How to run it

```
npm run replay-harness -- --source <platform checkout>
```

The fixtures are built into the code and hold no production data.

Exit codes:
- 0: the harness is proven
- 3: it cannot fail, so its result is refused
- 1: bad input, or the claim has moved

## Evidence

- **Named passing test:** "acceptance: the harness detects a deliberately non-idempotent fixture job as unsafe;
  if it cannot fail, it cannot pass". The unsafe job posted `job-done` twice where one run posts it once.
- **There are 10 tests in this file and 357 in the repo**, all passing under `npm test`.
- **Run with the platform's source at `bbde6ef`:** exit 0, all 5 fixture jobs told apart, and the claim found at
  `publishingWorker.ts:292`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring the
  code. 27 of 29 edits failed at least one test. The other two changed no behaviour: swapping the yield between
  steps for an immediate one, because the interleaving comes from the awaits themselves, and loosening a check
  that was redundant, which has since been removed. The 27 covered:
  - sharing rows between runs, or dropping the conditional claim from the store;
  - leaving effects or rows out of the end state, or making it depend on order;
  - calling a run that changed nothing, or a repeat that threw, safe;
  - running once instead of twice, or in sequence instead of at once;
  - removing the claim or its check from the claimed job, or the guards from the fixtures;
  - dropping any step of the verdict;
  - accepting a harness that caught nothing, or one with a wrong verdict;
  - ignoring a moved claim, or reading it from a comment;
  - giving a platform job a verdict, or dropping the limits.
- **Not run on a real job.** The next step is running the worker's real code twice in a sandbox.

## R4: a verdict per job, across the job families

The rung's acceptance: **each verdict is safe, unsafe or untestable-in-sandbox with the reason; no job is reported
safe on the strength of a documented mechanism alone.**

`npm run replay-audit-sandbox -- --fixture examples/replay-audit.fixture.json` (exit 0 verified, 3 not, 1 bad input).

The R1 harness runs each job once, twice in a row, and twice at once, from a fresh copy of its fixture. R4 runs it
across five platform jobs from five families. Each job is modelled from the lines it cites at `29bdbb61b`, with an
await wherever the code awaits between a read and a write. A single SQL statement is one step.

| Job | Guard in its code | In a row | At once | Verdict |
|---|---|---|---|---|
| Publishing worker (`publishingWorker.ts:290-294`) | update conditional on the state it read | safe | safe | **safe** |
| Stale action recovery (`claimLease.ts:87-111`) | one UPDATE per outcome, conditional on `processing` | safe | safe | **safe** |
| Preview stack reaper (`previewStackReaper.ts:18-38`, `previewStackService.ts:299-308`) | `stopStack` returns early when not running | safe | unsafe | **unsafe** |
| Intelligence retention (`intelligenceRetention.ts:17`, `:50-55`, `:74-79`) | archive skips decisions already archived | safe | safe | **safe** |
| OpenClaw content response (`openclawContentResponseAgent.ts:99`, `:447`) | not read | | | **untestable in a sandbox** |

**Safe only from two runs.** A job is safe only when both comparisons ran and both ended where one run ends. A
comparison the harness could not settle (a first run that changed nothing, or a run that threw) is unknown, which is
not a verdict, and fails the job's check.

**The preview reaper has a guard and is still unsafe.** Two runs at once both read the stack as running before
either writes it stopped. Each then stops it with `docker compose`, and each logs a stop event: two stops and two
events where one run gives one of each. Its guard does work when a stack is stopped after the reaper has read its
candidates; a test shows that. It does not cover a second reaper, and the cron path has no overlap guard.

**Why the content agent is untestable.** Its end state holds text a model writes on each run (the chat completion at
`:447`). Two runs differ whether or not the job repeats itself. A stubbed model would test the stub, not the job.

**The control.** R1's deliberately unsafe job runs alongside and must come out unsafe. If nothing in the run is
unsafe, the run is not verified. With the publishing worker's claim taken away, the same harness finds the worker
unsafe at once.

**What this does not prove.**
- Each verdict is about a model of the job, built from the lines it cites. The job itself was not run.
- Overlap is tested at the job's awaits, in one fixed order. Two SQL statements truly at once under the database's
  isolation are not run.
- A crash between an external effect and the state write is not tested.
- The reaper's verdict is a finding for its owner, and any fix is a reviewed deploy by a person.

**Tested:** 12 tests, including the acceptance test named after the criterion. 36 deliberate breaks: 35 caught.
- **Fixed first.** The first model used a 90-day retention window. The platform's is 30 (`intelligenceRetention.ts:17`),
  and the fixture now has rows at 31 and 29 days.
- **Tests added.** For the sandbox world's insert and remove, and for the reaper's running check.
- **Removed.** A "safe only from two runs" check, which could not fail because the verdict rule already gives safe
  only then. And a condition inside a one-step SQL statement, which nothing could interleave.
- **The survivor.** Removing the archive's "not already archived" check changes nothing, because the archive table's
  copied key also refuses a duplicate.

Its rung story id is on the platform board but not yet in this repository's plan, so it is recorded here and in the
commit.
