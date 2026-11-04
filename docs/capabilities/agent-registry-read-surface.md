# Agent registry read surface

**Story:** `platform.CAP.agent_registry_read_surface` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/registryReadSurface.ts` · **Tests:** `test/registryReadSurface.test.ts`

Ellis answers questions about any agent's **registration, state, schedule and run history** from
`ai_agents`, the activity log and the timer inventory (capability 13). It is read-only.

Platform facts cite the public Colaberry platform repository at upstream commit `bb1d3c3`.

## Three facts, never merged

| Fact | Means | When Ellis says it |
|---|---|---|
| **not registered** | there is no `ai_agents` row | no row by that name; Ellis then gives no enabled state and no run count at all |
| **disabled** | a row exists and `enabled` is false | only for a registered row |
| **no recorded runs** | a row exists, its run count is 0 and it has no activity rows | only for a registered row |

A name with no row can still be running. For each answer, Ellis also says:
- **whether a timer by that name exists,** for example "AliPersonalOutreach (`20 14-22 * * 1-5`,
  `schedulerService.ts:3234`): with no row, its wrapper runs it anyway, untracked";
- **whether that timer checks a differently named row,** for example "AdmissionsAssistant checks row
  AdmissionsAssistantAgent; ask about that";
- **which registered names look similar.** It never answers for them.

For a registered agent, Ellis also reports:
- **The live schedule:** the timers that read the row, with any governance override. It says when the
  declared schedule is not what fires, or when no timer in the inventory reads the row at all.
- **Run attribution.** A row shared by several timers has pooled runs (Dara's three). A row that is only
  an inner gate (WorkforceCurriculumDirector) has its runs counted under an earlier row, so 0 there is not
  "never ran". A row no timer reads is not run on a schedule.
- **Two rows with one name** give no single answer.

## What the code showed

None of these is a live risk.

**New: reporting gaps with no runtime consequence**

1. **The registry's "next run" is off by the server's UTC offset for timers registered in Chicago time.**
   - Those timers fire in Chicago time: every timer in `backend/src/services/aiOpsScheduler.ts` (`:559`,
     `:570`), and the 21 of the 70 in `schedulerService.ts` that pass the Chicago option. The other 49 fire
     in the container's own time, so the page's next run is right for them.
   - The registry computes the next run with `calculateNextRun`, which ignores its timezone argument
     (`backend/src/utils/cronNextRun.ts:7-9`), so it uses the server's clock.
   - The production container runs UTC with TZ unset, which A.M. read from the running container on
     2026-10-28. `backend/.env.example:19` says `TZ=America/Chicago`, so the template is wrong about it.
   - So for an hour-specific schedule, the page's next run is 5 hours early (6 after 1 November).
     WorkforceCurriculumDirector's row says 06:10 (`agentRegistrySeed.ts:2258`): the job fires at 06:10
     Chicago time and the page shows 06:10 UTC. Dara's own row shows no next run at all, because its
     schedule is empty (`:2529`).
   - Display only: the timers fire at the right time. The same function feeds a ticket's next check
     (`ticketAutoCheckService.ts:205-206`), per A.M.
2. **"Next run" is shown whether or not anything will run.** It is computed from the row's own schedule field
   for any row that has one (`backend/src/services/aiOpsService.ts:249-251`). The page shows it next to the
   "off" badge (`frontend/src/pages/admin/ai-settings/AgentRegistryTab.tsx:270`, `:277`). It also shows a
   next run every 15 minutes for TicketManagementAgent, a row with no timer behind it. A governance
   override of the timer's schedule (`aiOpsScheduler.ts:647-652`) never reaches the page.
3. **An inner-gate row reads "Never" and 0 runs while its work runs daily.** The page shows "Never" for an
   empty `last_run_at` (`AgentRegistryTab.tsx:57`, `:276`) and the raw run count (`:278`).
   WorkforceCurriculumDirector's gate is checked every morning inside Dara's timer, which counts the run
   under Dara. This extends A.M.'s note on finding 34 (two gates, two names, one counter) to what the page
   shows.
   - **Conditional.** This stands only while Dara's row is switched on. The seed ships it off
     (`agentRegistrySeed.ts:2544`) and never changes `enabled` afterwards; while it is off, Dara's timer
     skips its work and "Never" is accurate. A.M. is reading the live value. Findings 56 and 60 rest on
     the same flag.
   - The platform measured the same thing on a sibling row: WorkforceResearchDirector had run_count 0
     beside 12 activity rows (`workforce/scheduledAgentHealth.ts:16-18`).

**Already known**

4. **A timer with no row is absent from the listing entirely.** The listing returns only rows
   (`aiOpsService.ts:239-255`), and the detail view looks agents up by id (`:257-260`), as the brief says.
   The 33 cron timers with no row are in the platform's baseline (`cronRegistryBaseline.ts:114-130`).
5. **Dara's run count is pooled across three timers.** This is audit finding D7, recorded in the baseline
   (`cronRegistryBaseline.ts:214-222`).
6. **K.D. cannot open this surface.** Every route is behind `requireAdmin`, and K.D. has no admin row, as the
   brief says.

## Before anyone presses "discover"

Added 2026-11-04, when A.M. folded the agent discovery sync story into this capability. The registry tab's
discover button (`POST /api/admin/ai-ops/discover`) can switch timers on, so pressing it stays a person's
decision. Ellis answers **"which rows would it create, would each arrive enabled, and what would that start?"**
before anything is written. Read from the platform at `cc1ebc5`:

1. **It discovers from the seed, not from what runs.** It re-runs the registry seed and creates a row for each
   seed entry with none (`aiOpsService.ts:451-464`, `agentRegistrySeed.ts:3291-3296`). A timer whose row is in
   neither the registry nor the seed is never discovered, however long it runs.
2. **A new row arrives enabled unless its entry says otherwise,** because the column defaults to true
   (`models/AiAgent.ts:423-427`). ContentOptimizationAgent and the two retired agents are switched off right
   after (`agentRegistrySeed.ts:3342-3345`, `:3253-3289`).
3. **That can start a timer that does nothing today.** A runAgent timer with no row returns without running;
   once its row exists and is enabled, it runs. A tracked-cron timer runs today untracked; a new enabled row only
   starts tracking it, and a new disabled row stops it.
4. **`new_agents` is a change in the table's row count,** floored at zero, so anything else creating or deleting
   rows during the run changes it.
5. **The same seed runs whenever the AI Ops scheduler starts** (`aiOpsScheduler.ts:715`). On a platform whose
   scheduler started, discover usually creates nothing; it matters when that start never happened, or for entries
   added since.

The example registry below has six rows, so against the seed read from code the preview would create 248 rows,
228 arriving enabled. That is the shape of a platform whose scheduler never started, not a production figure.

## How to run it

```
npm run registry-ask -- --snapshot examples/registry-ask.example.json --name AliPersonalOutreach --name Dara
npm run registry-ask -- --snapshot examples/registry-ask.example.json --discovery-preview --seed examples/timer-inventory.example.json
```

The example is not production data. Names, schedules and timer wiring are the platform's; counts and times
are illustrative. Its timer list is a subset, and Ellis states that scope in every "no timer" answer. It
covers:
- a timer that runs untracked with no row (AliPersonalOutreach);
- a timer that checks a differently named row (AdmissionsAssistant);
- a disabled row (MarketingPublishingWorker);
- a row with no runs and no timer (TicketManagementAgent);
- an inner-gate row (WorkforceCurriculumDirector);
- a pooled row (Dara).

Exit codes:
- 0: every name registered
- 3: any name not registered or ambiguous
- 1: bad input

With `--discovery-preview`: 0 when discover would create no row, 3 when it would create any.

## Evidence

- **Discovery preview** (`src/capabilities/discoveryPreview.ts`, `test/discoveryPreview.test.ts`, 9 tests). Named
  test: "acceptance: the report names each row that would be created and states whether each would arrive
  enabled". Ten deliberate breaks, each caught by a named test: ignoring the forced-off rows, treating every row
  as enabled, counting governance rows as seed entries, missing a dead timer it would start, listing seeded timers
  as never discovered, counting a duplicated entry twice, ignoring the inventory's timers, dropping the row-count
  caveat, leaving citations unsorted, and cutting off output longer than a pipe buffer.
- **Named passing test:** "acceptance: a question about a name with no ai_agents row returns 'not
  registered', never 'disabled' and never 'zero runs'". It asks about a timer that runs untracked, a timer
  that checks another row and a name nothing knows. In each case the answer has no enabled state, no run
  count and no "disabled" or "no runs" wording. It also checks that a disabled row and a never-run row each
  keep their own fact. There are 10 tests in this file and 213 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - giving a name with no row an enabled state of false fails 1;
  - giving it a run count fails 1;
  - describing it as disabled fails 1;
  - not explaining an untracked timer fails 1;
  - not pointing a timer to the row it checks fails 1;
  - dropping similar names fails 1;
  - not pooling a shared row fails 1;
  - reading an inner gate's 0 as never ran fails 1;
  - ignoring activity rows fails 1;
  - not flagging a row no timer reads fails 1;
  - never comparing the declared schedule fails 1;
  - ignoring a governance override fails 1;
  - not noting a governance row that turns a timer off fails 1;
  - answering for a name with two rows fails 1;
  - reporting the oldest activity as the latest fails 1;
  - reading an inner gate as deciding the run fails 1.
- **Not yet run on live records.** K.D. cannot open the registry surface. The first live check is one
  export of `ai_agents` and the last day of `ai_agent_activity_logs`, with the timer inventory from
  capability 13.
