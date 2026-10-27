# 003: Pin every copied rule to the platform's code, and re-check it live

**Status:** in force since 2026-10-26 · recorded 2026-10-27

## Context
Ellis reproduces platform behaviour: who holds which grant, which thresholds raise an alert, how a health
score is computed. The platform repository changes many times a day, so a copied rule silently goes stale.

## Decision
- Every copied rule names the platform commit and the file and line it came from, for example
  `GRANTS_COMMIT = 'c860274'` (`src/grants/agentGrants.ts:6`) and `PINNED_AT` in the cron health and health
  scoring capabilities.
- Where the rule can be read from source, `--source <platform checkout>` re-reads it at run time, and a rule
  that has changed shape (not just value) is an error, never a silent fall back to the pinned copy
  (`readLiveThresholds` in `src/capabilities/cronHealthAlerting.ts`, `confirmLiveFormula` in
  `src/capabilities/agentHealthScoring.ts`).

## Alternatives considered
- **Call the platform's own code.** Rejected: Ellis holds no credentials and has no runtime dependency on the
  platform, by design.
- **Copy without a pin.** Rejected: nobody could tell which version an answer describes.

## Consequences
- Each pin is a maintenance point. Re-measuring against a new commit is part of the work, for example when an
  upstream fix changes how pause behaves.
- Answers state the version they describe, so a reviewer can check them against the platform.

## Evidence
- `test/cronHealthAlerting.test.ts`: live thresholds are read and used; a missing constant or a changed job
  selection is an error.
- `test/agentHealthScoring.test.ts`: a changed score formula in the live source makes the run fail.
