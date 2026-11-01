# Reliability briefing for the accountable manager

**Story:** `platform.CAP.reliability_briefing_for_manager` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/reliabilityReport.ts`, `src/cli/reliabilityReport.ts` · **Tests:** `test/reliabilityReport.test.ts`

This first release produces the briefing on request: what ran, what failed, what nobody can measure, and which decisions
need a person. It composes the answers of capabilities already built and recounts nothing. Ellis never sends it:
`live_email` is default-denied (`delivery/execution/executionPolicy.ts:33-42`), so delivery stays with the platform's
briefing service (`services/executiveBriefingService.ts`).

**The scope is a proposal.** The data analyst duties this is meant to absorb are not documented in the platform
repository, so this is not an inherited job description. K.D. has yet to state the scope, and the briefing says so.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run reliability-report -- --source <platform checkout> [--snapshot <health.json>] [--drift-log <log copy>] [--produced-at <ISO date>] [--json]
```

It prints text a person can read with no login, or JSON. Exit code 0 when records were read, 4 when it was produced
without them, 1 for bad input. The snapshot has the same shape as `examples/cron-health.example.json`.

## What it says, in order

**1. Not measured, first.** A report of only what is measurable reads as healthier than the platform is, because
untracked timers add nothing to the run figures. So this comes before any number, and the headline points to it. The
untracked timers and phantom crons are always listed by name, and stay listed at zero.

| Item | Comes from |
|---|---|
| Untracked timers, phantom crons, timers with no name | `npm run registry-reconcile`, from source |
| Alert outcomes, retry counts, latency percentiles | Nothing records these, and the briefing says so |
| Schema comparisons nobody makes, and schema drift if unknown | `npm run schema-drift` |
| Recovery position | `npm run backup-position` |
| Agents with no score, timers with no row, jobs the check cannot evaluate | `npm run agent-health`, `npm run cron-health`, with records |
| Runs, failures and alerts | Listed here when no records were supplied: unknown, not zero |

**2. Measured.** Every figure names its source. With no records, the run figures read `unknown`.

**3. Decisions waiting on a person.** Each names who decides and what evidence they need: the scope of this briefing,
whether a skipped tick counts as a missed run, the backup policy, and who owns approval for production changes.

## The rules on figures

- **No percentage without its count.** A percentage prints as `7.5% (3 of 40 runs)`, always.
- **Never from an empty list.** With zero runs there is no failure rate: the line reads `0 runs`.
- **No overall verdict.** The briefing never calls the platform healthy. An unknown is not a good result.
- **No links.** K.D. has no admin login, so the briefing links to no admin page and stands on its own.

## Limits, stated in every briefing

- Untracked timers and phantom crons are measured from source. Which of them are live on production is not read here.
  That needs runtime cron drift detection, which is on hold.
- Every count comes from the capability cited beside it, so the briefing shares each one's limits.
- Run and failure counts are lifetime counters on each agent row, not figures for a period.
- An unknown is not a good result.

## Evidence

- **Acceptance:** `no percentage appears without the record count behind it`, and `the unmeasured section names the
  untracked timers and the phantom crons`, in `test/reliabilityReport.test.ts`.
- **Each rule can fail:** 41 of 41 deliberate breaks were caught, starting from a passing suite. Six survived the first
  pass and led to stronger tests. A seventh changed nothing, because a null is caught a step later either way, so it was
  set aside.
- **On the real source:** run at `bbde6ef` with no records, it named 66 untracked timers, 79 phantom crons and 14 timers
  with no name, and reported run figures as unknown, exit 4. With the example snapshot it read 259 agent rows and no
  failures, and gave no failure rate, because the example holds zero runs.
- **Not done:** it has never read production records, and nothing delivers it. A period figure needs a run log by date.
