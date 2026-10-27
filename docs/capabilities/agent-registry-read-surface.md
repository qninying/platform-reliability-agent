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

1. **The registry's "next run" is off by the server's UTC offset for most of the fleet's daily timers.**
   - The scheduler fires its timers in Chicago time (`backend/src/services/aiOpsScheduler.ts:559`, `:570`).
   - The registry computes the next run with `calculateNextRun`, which ignores its timezone argument
     (`backend/src/utils/cronNextRun.ts:7-9`), so it uses the server's clock.
   - The production container runs UTC, as the platform's own code notes
     (`backend/src/scripts/lib/renderPaysimpleReport.js:53`, `backend/src/scripts/lib/compileFamilyBriefingData.js:26`).
   - So for every hour-specific schedule, the page's next run is 5 hours off (6 in winter). Dara's 06:10
     run fires at 06:10 Chicago time; the page predicts 06:10 UTC.
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

**Already known**

4. **A timer with no row is absent from the listing entirely.** The listing returns only rows
   (`aiOpsService.ts:239-255`), and the detail view looks agents up by id (`:257-260`), as the brief says.
   The 33 cron timers with no row are in the platform's baseline (`cronRegistryBaseline.ts:114-130`).
5. **Dara's run count is pooled across three timers.** This is audit finding D7, recorded in the baseline
   (`cronRegistryBaseline.ts:214-222`).
6. **K.D. cannot open this surface.** Every route is behind `requireAdmin`, and K.D. has no admin row, as the
   brief says.

## How to run it

```
npm run registry-ask -- --snapshot examples/registry-ask.example.json --name AliPersonalOutreach --name Dara
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

## Evidence

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
