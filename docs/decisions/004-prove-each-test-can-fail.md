# 004: Prove each key test can fail

**Status:** in force since 2026-10-26 · recorded 2026-10-27

## Context
A test that passes first time proves little: it may not exercise the rule it is named after. Ellis's
answers decide what a person looks at first, so a rule that is silently untested is a real risk.

## Decision
For every capability, each key rule is deliberately broken in the code, the tests are run, and a named test
is confirmed to fail before the code is restored. The list of mutations and how many tests each one fails is
part of every capability write-up, under "The tests catch defects". A mutation that no test catches is
treated as a missing test and closed before the capability is committed.

## Alternatives considered
- **A mutation-testing framework.** Deferred: Ellis has no runtime dependencies, and hand-chosen mutations
  target the rules that matter rather than every operator.
- **Coverage figures.** Rejected as the bar: coverage shows a line ran, not that a wrong answer would be noticed.

## Consequences
- Each capability takes longer to finish, and the mutation lists must be kept honest by hand.
- Surviving mutations have found real test gaps, for example a tie break that the original test data
  happened to satisfy either way (`docs/capabilities/agent-health-scoring.md`, Evidence).

## Evidence
- The "Evidence" section of each write-up in `docs/capabilities/`.
