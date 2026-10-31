# Idempotency and replay-safety audit

**Story:** `platform.CAP.idempotency_and_replay_audit` · **Autonomy:** starts R0, first release R1, ceiling R4 · **Approver:** K.D.
**Code:** `src/sandbox/twiceRun.ts`, `src/sandbox/publishingJobs.ts`, `src/capabilities/idempotencyAudit.ts` · **Tests:** `test/idempotencyAudit.test.ts`

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
