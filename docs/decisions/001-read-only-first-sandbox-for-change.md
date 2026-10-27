# 001: Read-only first; any change runs on a sandbox copy

**Status:** in force since 2026-10-26 · recorded 2026-10-27

## Context
Ellis watches a production platform with more than a hundred scheduled agents. Every capability in the
platform's build plan starts at autonomy R0 (`docs/discovery/01-system-classes.md`), and K.D. signs off on any
agent action in production. Reading the platform's code turned up repairs that undo a person's decision and
fixes that report work they did not do, so an unproven change is a real risk, not a theoretical one.

## Decision
- Every capability reads through an interface that has no write method (`src/readSource.ts`).
- The only capabilities that change anything act on a sandbox copy: the repair and ticket-close sandboxes
  journal every write (`src/sandbox/sandboxStore.ts`, `src/sandbox/ticketSandbox.ts`), and bug baselines run
  under Node's permission model, able to touch only their own directory (`src/sandbox/baselineRunner.ts:57`).
- Moving any capability into production is a separate, reviewed step, not an autonomy setting Ellis changes.

## Alternatives considered
- **Act in production behind a feature flag.** Rejected: a flag limits who is affected, not whether a wrong
  change happens, and the platform's own repairs showed how a plausible change can be wrong.
- **Dry-run mode in production.** Rejected: a dry run cannot show that a second run changes nothing, which is
  the property that matters for a repair that runs on a timer.

## Consequences
- Ellis cannot fix anything live today. Its value is evidence: what is wrong, what a fix would change, and
  proof that the fix is safe to repeat.
- A sandbox copy can drift from production. Each fixture names its shape source (for example
  `sandboxStore.ts` mirrors `aiEventService.ts:14-26`), and every capability that reads records lists its first live export as
  outstanding in its write-up.

## Evidence
- `test/orchestrationAutoRepair.test.ts`: a second run makes no change, counted from the journal.
- `test/agentTicketAutoResolution.test.ts`: a close and its evidence comment land as one journal entry.
