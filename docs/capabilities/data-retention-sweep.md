# Platform data retention sweeps

**Story:** `platform.CAP.data_retention_sweep` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/dataRetentionSweep.ts`, `src/retention/sweepCatalogue.ts` · **Tests:** `test/dataRetentionSweep.test.ts`

Ellis answers **"what is each table's retention window, and when was it last swept?"** Ellis only
reads. Deletion is irreversible, so production deletes stay with the platform's existing timers or a
person; an agent never runs them.

Platform facts cite the public Colaberry platform repository at upstream commit `769ff4e`.

## A window has to be stated, not found in code

A window counts only when a person can read it somewhere other than the code. Ellis accepts three
sources:

| Source | Example |
|---|---|
| An approved policy entry | `{ table, days, approved_by, approved_at }`, kept by Ellis; the platform has no such register |
| A run record that carries the window | `RETENTION_CYCLE` in `ai_system_events`, with `retention_days` (`backend/src/services/cory/intelligenceRetention.ts:141-147`) |
| The job's registry description | "deletes PageEvent records older than 90 days" (`backend/src/services/agentRegistrySeed.ts:161-170`) |

Each table's window gets one of three answers:
- **stated:** the sources agree, and each one is cited.
- **conflicting:** the sources disagree, and no number is chosen.
- **unknown:** no source states a window. Ellis never fills in a number from the code.

Separately, Ellis checks whether the code follows the stated window. For this check only, it uses the
number the code uses.

## The five sweeps

| Table | Job | What the sweep does | Window in the code |
|---|---|---|---|
| `page_events` | PageEventCleanup, daily 03:00 | Deletes | 90 days (`schedulerService.ts:2473-2488`) |
| `chat_messages` | ChatMessageCleanup, daily 03:30 | Deletes | 180 days (`schedulerService.ts:2490-2505`) |
| `intelligence_decisions` | IntelligenceRetentionCycle, daily 03:15 | Archives, then deletes up to 5,000 rows | 30 days (`intelligenceRetention.ts:17-18`) |
| `timeline_cards` (generated) | AiNewsRefresh, daily 03:15 | Archives (hides from the feed) | An environment setting, default 18 (`generatedContentRetention.ts:47`) |
| `proposed_agent_actions` | ProposalCleanupService, daily 02:00 | Marks pending proposals expired | No days in the job (`proposalCleanupService.ts:18-40`) |

All five jobs have an `ai_agents` row, so their runs are recorded (`agentRegistrySeed.ts:161`, `:205`,
`:238`, `:2363`, `:2473`). The brief listed this as not yet measured.

For each table, Ellis also reports:
- **When it was last swept:** swept, overdue, failed, disabled, never run, or untracked.
- **Rows removed:** only where a record keeps the count. Otherwise Ellis says the count is not recorded, never 0.
- **The risks below**, each with its file:line.

## What the code showed

1. **The intelligence cleanup can delete rows it never archived.** The archive step copies an unordered
   batch of 5,000 old rows. The delete step then removes a separate unordered batch of 5,000 old rows,
   without checking that they were archived (`intelligenceRetention.ts:50-55`, `:74-79`). The comment
   above the delete says "that have been archived" (`:68`). With more than 5,000 old rows, the two
   batches can differ.
2. **A failed intelligence cleanup is recorded as a success.** The job catches its own error and logs
   `RETENTION_ERROR`, so the cron wrapper records the run as successful (`intelligenceRetention.ts:152-158`).
   The archive table it writes to has no retention of its own (`:19`).
3. **The two biggest cleanups are one unbounded delete each, not batches.** Page events and chat
   messages are deleted in a single statement per run (`schedulerService.ts:2479-2481`, `:2496-2498`).
   The brief's workflow says batches. The deleted count goes only to the server log, and only when it
   is above 0 (`:2482-2484`, `:2499-2501`). The `chat_messages` index leads with `conversation_id`, so
   the age filter cannot use it (`ChatMessage.ts:62-63`).
4. **The stated window for generated cards does not match the code.** The registry description and the
   code comment both say 30 days (`agentRegistrySeed.ts:246`, `schedulerService.ts:2107`). The code
   uses `GENERATED_CONTENT_RETENTION_DAYS`, default 18 (`generatedContentRetention.ts:47`). A second
   daily prune at 03:45 runs outside any instrumented job and leaves no run record
   (`schedulerService.ts:2122-2137`). A failed news refresh skips the prune (`:2106-2107`).
5. **Proposal cleanup deletes nothing.** It marks pending proposals expired, so it does not bound the
   table (`proposalCleanupService.ts:21-29`).
6. **No retention window is written down as a policy.** Every window is a constant in code or an
   environment setting. Two of them are repeated in free-text registry descriptions, and one of those
   repeats is wrong (finding 4).

## How to run it

```
npm run retention-sweep -- --snapshot examples/retention-sweep.example.json
```

The example is not production data. Its registry descriptions are copied from the platform seed; its
runs and counts are invented. It shows:
- three windows stated by the registry or a run record;
- the generated-card window, stated as 30 days, which the code does not fix;
- proposals as unknown;
- a failed intelligence cycle that was recorded as a success;
- an overdue prune.

Exit codes:
- 0: every window is stated and every table was swept on time
- 3: otherwise
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: a table whose window is not recorded anywhere returns 'unknown', never a guessed number of days"
  - "acceptance: with no records at all, every table in the catalogue is unknown, with no days"

  There are 13 tests in this file and 89 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - filling an unknown window with the code's number of days fails 3 tests, including both acceptance tests;
  - accepting a malformed stated value fails 1;
  - ignoring `RETENTION_ERROR` fails 1;
  - picking the first window when the sources conflict fails 1.
- **Not yet run on live records.** There is no admin surface for retention yet. The first live check is
  one export of the five `ai_agents` rows, their recent activity rows and the `IntelligenceRetention`
  rows of `ai_system_events`.
