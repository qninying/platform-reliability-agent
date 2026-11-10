# 007: Shadow evaluation is judged only against K.D.'s limits and approved references

**Status:** harness built on 2026-11-10 · limits in `governance/shadow-criteria.json` not set by K.D. yet

## Context
R5 is "evaluate in shadow mode against approved reference outcomes". The next step for the monitoring
capabilities is R5, and K.D. has not yet set how many misses and false alarms are acceptable. The comparison
itself does not depend on those numbers, so it can be built and tested now.

## Decision
- A shadow run scores Ellis's recorded verdicts only against references a named person approved.
- It judges a tool only against limits K.D. wrote in `governance/shadow-criteria.json`. Any unset limit means
  `not_judged`, naming what is missing. The file ships with every limit unset.
- An Ellis `unknown` on a real problem counts as a miss. Being honest about a blind spot does not mean the
  problem was caught.
- No rate is given from an empty denominator, and every rate carries its counts.

## Alternatives considered
- **Default limits (for example 5% misses) until K.D. decides.** Rejected: a default would read as an approved
  threshold, and setting thresholds is K.D.'s decision at every level.
- **Count unknowns apart and leave them out of the miss rate.** Rejected: it would let a tool improve its miss
  rate by saying unknown more often.
- **Score unapproved references, flagged.** Rejected: the rung requires approved references, and a flagged
  number still gets quoted.

## Consequences
- Every shadow run is `not_judged` until K.D. sets limits and references are approved.
- A tool that is often unknown scores worse, which pushes toward seeing more rather than hedging more.

## Evidence
- `test/shadowEvaluation.test.ts` and the mutation list in `docs/shadow-evaluation.md`.
