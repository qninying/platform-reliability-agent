# On-demand platform bug fix dispatch

**Story:** `platform.CAP.platform_bug_fix_dispatch` · **Autonomy:** starts R0, first release R1, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/bugBaseline.ts`, `src/sandbox/baselineRunner.ts` · **Tests:** `test/bugBaseline.test.ts`

For a reported bug, Ellis **prepares an isolated reproduction and a baseline test, and changes nothing
else.** It does not attempt a fix. Fixing, merging and deploying are for a person at every autonomy level.

Platform facts cite the public Colaberry platform repository at upstream commit `c35fbc5`.

## How a baseline is prepared and judged

1. **Only a bug ticket with a stated reason.** The ticket must be of type `bug`, and the reported reason is
   written down as the failure it must produce: the error's name and a fragment of its message. Anything
   else is refused before anything runs.
2. **An isolated reproduction.** The platform lines the defect lives in are copied from a read-only checkout
   into a fresh sandbox folder, each with a hash of the exact lines. The checkout itself is never written.
   File names are checked, so nothing can be written outside the sandbox.
3. **Run under Node's permission model.** The test can read and write only its own sandbox. It cannot start
   other programs or open the network, and a write outside is refused, not just discouraged.
4. **Run twice.** The failure has to repeat the same way.

The baseline is accepted only when every run fails, every failure is the reported one, and the runs agree:

| Verdict | Meaning | Accepted |
|---|---|---|
| `baseline_confirmed` | fails for the reported reason on every run | yes |
| `passes_before_fix` | the test passes, so it proves nothing | no |
| `fails_for_another_reason` | it fails, but with another error or message, or some failures are not the reported one | no |
| `did_not_run` | the file could not load, a test timed out, no tests ran, or the run was killed | no |
| `sandbox_violation` | the test tried to reach outside its sandbox and was refused | no |
| `unreproducible` | the reported failure appeared on some runs and not others, or the reason is marked timing-dependent and the test passed; kept on its own list, never read as "not a defect" | no |
| `inconsistent` | the runs disagree in another way: different failing tests, or a sandbox violation on one run | no |
| `not_repeated` | fewer than two runs | no |
| `refused` | not a bug ticket, or no reported reason | no |

**Unreproducible is not "not a defect".** Added after A.M.'s review (2026-10-27). A check that accepts only a
reproducible failure would quietly reject the hard half: a race, a recovery that fires only after ten minutes,
a breaker that resets when a window drains. So a failure seen on some runs and not others, or a defect whose
reported reason is marked `timing_dependent` that this test did not show, is `unreproducible`. Each record
says how many runs showed the failure (`seen_in`), and `byList` keeps three lists: confirmed, unreproducible
and rejected. An unreproducible ticket waits for a person to reproduce it another way.

**A failure to load is not the defect.** Node's test runner reports a file that cannot load as an ordinary
failing test: in a child process with an `exitCode` and the error "test failed", and in process with the
load error's own name (for example `SyntaxError`). Ellis tells them apart: a real test failure always
carries a `failureType`, and a file that never loaded does not. A naive "it failed" check would accept a typo
as proof of the defect.

## A real reproduction

`examples/bug-baseline/risk-tier.spec.json` reproduces a defect in the platform's work-graph router. A
ticket whose risk tier is not in the router's vocabulary scores 0, the read-only tier, so it clears every
ceiling (`backend/src/services/workGraph/capabilityRouter.ts:28-31`). Ellis copies lines 26-36 of the router
into the sandbox and runs the baseline twice:
- the test "an unrecognised ticket risk tier does not clear a read-only ceiling" fails with `AssertionError`
  ("unrecognised tier cleared the R0 ceiling") on both runs;
- the control test, "a recognised tier above the ceiling is refused", passes, so the harness itself works;
- the sandbox holds only the copied lines and the test, and the checkout is unchanged.

Run against the same lines with the defect fixed, the same test passes and Ellis rejects it as
`passes_before_fix`. That pair is the acceptance test.

## What the code showed

**Live risk**

1. **The fix agent tells reviewers a fix was applied when none was.** PlatformFixAgent asks a model for a
   diagnosis from the ticket's title and description only, with no code, reproduction or test
   (`backend/src/services/agents/platformFixAgent.ts:49-57`). If the model rates its own confidence at 0.8
   or more and its risk "low" (`:70`), the agent comments "✅ Auto-fix has been applied. Moving to review."
   (`:91`). Nothing is applied. The dispatcher then moves the ticket to `in_review`
   (`backend/src/services/ticketAgentDispatcher.ts:303-305`). A reviewer sees a bug in review with a note
   that it was fixed, and can close a real defect. Its header and registry row both describe it as
   auto-fixing (`platformFixAgent.ts:3`, `agentRegistrySeed.ts:1090`). No test covers this agent.
   **Confirmed by A.M. (2026-10-27, at `c699e58`), sharper:** the agent records its own action as
   `auto_fix_proposed` (`platformFixAgent.ts:74`), so the code already knows it only proposed; the one
   untrue sentence is the one addressed to a person. There is no file write, process, git call or patch
   anywhere in the agent. The promotion is the dispatcher's rule, not the agent's: any agent that returns no
   errors goes to review (`ticketAgentDispatcher.ts:303-306`). The fix is two changes: the comment says a
   diagnosis was proposed, and promotion stops for this agent. It heads a family of four where an agent
   reports work it did not do, and it is the only one a person reads and acts on.

**New: reporting gap**

2. **The guard written for unrecognised tiers is never called.** `assertNoAutonomyInRiskTierColumn` calls
   itself the enforcement point (`backend/src/services/agentDomain/autonomyLadder.ts:110-124`), but only its
   own tests call it. Its tests also confirm it lets an unrecognised tier such as `R99` through
   (`backend/src/services/agentDomain/__tests__/autonomyRiskTierGuard.test.ts:127`). Confirmed by A.M.,
   in the same family: an enforcement point nothing enforces with.

**Already known**

3. **An unrecognised tier clears every ceiling.** The platform documents this in the guard's test header
   (`autonomyRiskTierGuard.test.ts:19-26`). A ticket with no tier at all is unrestricted by design
   (`capabilityRouter.ts:34`).
4. **Every bug ticket matches.** The entry's predicate is any ticket of type `bug`
   (`backend/src/services/workGraph/capabilityRegistry.ts:87-101`), as the brief says.
5. **Dispatch is manual.** The admin route dispatches one ticket at a time
   (`backend/src/routes/admin/ticketRoutes.ts:271`, behind `requireAdmin` at `:60`). The automatic dispatcher,
   TicketManagementAgent, has no caller; the platform already records it as a phantom
   (`backend/src/services/agentDomain/capabilities/platform.json:4978`).

Before any rung above R1 means anything, K.D. has to state which defect classes this may attempt.

## How to run it

```
npm run bug-baseline -- --spec examples/bug-baseline/risk-tier.spec.json --source <platform checkout> --sandbox <empty dir>
```

The example ticket was written for this demonstration; the copied lines are real platform code.

Exit codes:
- 0: baseline confirmed
- 4: unreproducible (kept on its own list)
- 3: rejected (passes, fails for another reason, did not run, sandbox violation, inconsistent, refused)
- 1: bad input

## Evidence

- **Named passing test:** "acceptance: the baseline test fails for the reported reason before any fix and is
  shown to fail; a test that passes before the fix proves nothing". It runs the real runner twice against the
  defective router lines (confirmed) and twice against the fixed lines (`passes_before_fix`). Also "a defect
  seen on some runs and not others is unreproducible, on its own list, never "not a defect"". There are 14
  tests in this file and 238 in the repo, all passing under `npm test`.
- **Real runner output.** The parser tests read real node test-runner output (v25) for an assertion, a thrown
  error, a passing test, a syntax error, a missing import (in process and in a child process), a timeout and
  a refused write, saved in `test/fixtures/tap/`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - reading an in-process load error as a failure fails 1;
  - reading a child-process load error as a failure fails 1;
  - counting a timeout as a failure fails 1;
  - reading a refused access as a thrown error fails 2;
  - accepting a passing test fails 1;
  - accepting one matching failure among others fails 1;
  - not checking the message fails 1;
  - not checking the error name fails 1;
  - accepting a single run fails 1;
  - accepting different failing tests across runs fails 1;
  - preparing a ticket that is not a bug fails 1;
  - accepting an empty reason fails 1;
  - dropping the sandbox permissions fails 2;
  - not enforcing the checkout boundary fails 1;
  - not checking file names fails 1;
  - not resolving a symlinked sandbox fails 1.

  For the unreproducible outcome:
  - folding an intermittent failure into `inconsistent` fails 3;
  - rejecting a timing-dependent pass fails 1;
  - making every pass unreproducible fails 3;
  - letting a sandbox violation count as unreproducible fails 1;
  - listing unreproducible as rejected fails 2;
  - accepting an unreproducible baseline fails 1;
  - miscounting the runs that showed the failure fails 2;
  - leaving the lists unsorted fails 1.

  One mutation cannot fail: letting any failure kind match the reported reason. Load errors, timeouts and
  refusals are already ruled out before that check, so it is a backstop, not a separate rule.
- **Live demonstration** on the platform checkout at `c35fbc5`: the example above, confirmed on both runs.
