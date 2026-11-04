# Platform data retention sweeps

**Story:** `platform.CAP.data_retention_sweep` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/dataRetentionSweep.ts`, `src/retention/sweepCatalogue.ts` (R2), `src/capabilities/retentionSweepRehearsal.ts` (R4) · **Tests:** `test/dataRetentionSweep.test.ts`, `test/retentionSweepRehearsal.test.ts`

Ellis answers **"what is each table's retention window, and when was it last swept?"** Ellis only
reads. Deletion is irreversible, so production deletes stay with the platform's existing timers or a
person; an agent never runs them.

Platform facts cite the public Colaberry platform repository at upstream commit `769ff4e` for R2 and `c150d4c48`
for R4.

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

## R4: the sweep run end to end in a sandbox

The rung's acceptance: **rows exactly at the boundary are handled per the stated rule, dependents survive,
and a second run deletes zero rows.**

Ellis sweeps a sandbox copy of `intelligence_decisions`, the one table here that is archived before it is
deleted and that other tables reference. Its sweep:

- applies a **stated** rule, given with the fixture (30 days, `older_than`, so a row exactly 30 days old is
  kept). With no stated rule it does not run, and the answer is unknown: no window for this table is
  approved anywhere, so the fixture's rule is a test input, not a policy;
- **holds back any row another table references**: `strategic_actions.decision_id`
  (`backend/src/models/StrategicAction.ts:37-41`) and `company_directives.cory_decision_id`
  (`CompanyDirective.ts:29`, read at `companyToCoryAdapter.ts:79-80`);
- **archives before it deletes, and deletes only rows it can see in the archive**, so a row whose archive
  write fails is kept, and tried again on the next run rather than in a loop;
- works in **bounded batches**, and a second run deletes zero.

The seed puts rows one second either side of the boundary and one exactly on it, two old rows that are
referenced, and one old row whose archive write fails.

**The control.** The platform's cycle (`backend/src/services/cory/intelligenceRetention.ts`, unchanged since
`c99021d`) runs on the same seed. It archives up to 5,000 old rows and deletes up to 5,000 old rows, each in
no stated order and with no check that a row was archived or is referenced (`:49-55`, `:71-77`). On the
seed, with "no stated order" modelled as two different orders, it deletes three rows never archived,
including the one whose archive write failed, and removes a row a strategic action references. If the
control lost nothing on a seed, the seed would not exercise the checks, so the rehearsal is not verified.
These losses appear in Ellis's answer as the control's, not as Ellis's verdict.

**What this does not prove.** The rule is the fixture's, not an approved one. Only the two references the
code shows are checked. Whether the foreign key is enforced in production cannot be read from source,
because schema sync is off (`backend/src/config/schemaReconcile.ts:10`); if it is, the platform's delete
fails for the whole batch instead. Each answer states these limits.

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
6. **The written retention policy disagrees with the code, and does not run.** A central policy lists nine
   PII classes, each with a time to live and an action (`backend/src/services/retentionReportService.ts:35-45`).
   It says `chat_messages` purge at 24 months (`:37`). The scheduler deletes the same table at 180 days
   (`schedulerService.ts:2490-2505`). So one table has two authorities that differ fourfold, and the
   shorter one is the one that runs. The enforcement service behind the policy is on no schedule: it
   runs only from an admin endpoint (`backend/src/routes/admin/trustRoutes.ts:39`,
   `backend/src/controllers/trustController.ts:125`). The policy file's own header says these tables
   have no retention at all (`retentionReportService.ts:4-5`). Every other window is a constant in
   code or an environment setting.

## How to run it

```
npm run retention-sweep -- --snapshot examples/retention-sweep.example.json
npm run retention-sweep-sandbox -- --fixture examples/retention-sweep.fixture.json
```

The R4 command exits 0 when verified, 3 when not (including no stated rule), and 1 for bad input. The R2
command's codes are below.

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
  - R4: "acceptance (R4): rows exactly at the boundary are handled per the stated rule, dependents survive, and a second run deletes zero rows"

  There are 13 tests for R2 and 11 for R4, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - filling an unknown window with the code's number of days fails 3 tests, including both acceptance tests;
  - accepting a malformed stated value fails 1;
  - ignoring `RETENTION_ERROR` fails 1;
  - picking the first window when the sources conflict fails 1.
  - R4: ignoring the rule's boundary fails 6; dropping the dependent check fails 4; deleting without the
    archive check fails 5; never archiving fails 5; an unbounded batch fails 1; one batch per run fails 4;
    a control check that always passes fails 1; ignoring the directive reference fails 5; running with no
    stated rule fails 2; making the control safe fails 2; not requiring a row at the boundary fails 1;
    retrying a failed archive in a loop fails 1; not requiring an archive failure fails 1. The
    delete-without-archive break first survived, because the sweep always archived just before deleting;
    seeding an archive write that fails is what made that check real.
- **R4 is sandbox only.** Nothing reaches a database. Its rung story id is on the platform board but not
  yet in this repository's plan, so it is recorded here and in the commit.
- **Not yet run on live records.** There is no admin surface for retention yet. The first live check is
  one export of the five `ai_agents` rows, their recent activity rows and the `IntelligenceRetention`
  rows of `ai_system_events`.
