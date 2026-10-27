# Agent enable, disable, pause and resume control

**Story:** `platform.CAP.agent_enable_disable_control` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/agentEnableDisableControl.ts` · **Tests:** `test/agentEnableDisableControl.test.ts`

Ellis answers **"should this agent be stopped, why, and what would stopping it actually stop?"**

**Stopping a live timer is a human decision at every autonomy level.** Ellis recommends and shows the
evidence. It never calls the control route, and every recommendation says a person performs the disable.

Platform facts cite the public Colaberry platform repository at upstream commit `a284987`. Corrections from
A.M.'s review on 2026-10-27 cite `7c70f0a`.

## What a recommendation contains

- **The flag.** The `ai_agents` row the control route would change, or a statement that none exists. For a
  name with no row, Ellis says **"No disable flag exists... Ellis does not propose creating one."**
- **Every timer the disable would stop,** including every timer that shares the name. For Dara that is
  all three: the curriculum director, the certification director and the research sweep.
- **Every timer it would not stop,** with the reason. Examples: the timer is named this but checks a
  different row; its wrapper never reads the row; how its wrapper treats the row is not known.
- **The evidence** the request gave. With no evidence, or for an agent already disabled, there is no
  recommendation.
- **Other switches.** The governance schedule row (`cron_schedule_configs`) can stop a timer outright.
  Ellis names it as a separate switch.
- **Warnings about pause,** because pause is weaker than disable (findings 2 and 3).

## Which timers obey the switch

A disable only stops a timer if the wrapper it runs through reads the row. At `a284987`, of the 111
timers registered in `backend/src/services/aiOpsScheduler.ts`:

| Wrapper | Timers | Disable | Pause | When the row is missing |
|---|---|---|---|---|
| `runAgent` (`backend/src/services/aiOrchestrator.ts:177-191`) | 83 | stops | stops | does not run at all |
| `instrumentCronJob` (`backend/src/services/cronInstrumentation.ts:34-52`) | 16 | stops | stops | runs anyway, untracked |
| `trackAgentRun` (`backend/src/services/agentRunTracker.ts:28-36`) | 4 | stops | **ignored** | runs anyway, untracked |
| workforce director gate (`backend/src/services/workforce/workforceAgentRuntime.ts:66-73`) | 7 | stops the writes | stops the writes | writes nothing |
| CampaignHealthScanner's own check (`aiOrchestrator.ts:108-112`) | 1 | stops | **ignored** | runs anyway, untracked |

**This table covers `aiOpsScheduler.ts` only.** The cron wrapper also runs 66 timers in
`backend/src/services/schedulerService.ts` and 3 in `backend/src/services/scheduling/growthJourneyCrons.ts`
(`:48`, `:69`, `:90`), so about 85 timers in all go through `instrumentCronJob`. Ellis's inventory does not
yet include those 69.

Ellis takes this wiring as an inventory (each timer, its schedule and every row that can stop it) rather
than guessing from names.

## What the code showed

1. **A timer's name and the row its switch lives on can differ.**
   - 33 of the 109 scheduled timer names have no seeded `ai_agents` row.
   - For 24 of them, the timer checks a row with a different name. For example, timer
     `AdmissionsAssistant` checks row `AdmissionsAssistantAgent` (`aiOrchestrator.ts:539-541`).
   - For the other 8 (the six Skool timers, WeeklyReport and WorkforceIntelligence), the row they check
     is not seeded at all. Unless one was created outside the seed, `runAgent` finds no row and returns
     without running (`aiOrchestrator.ts:177-181`), and there is no flag to disable.
   - **Already known:** the platform's cron registry baseline lists these names under a guard that fails
     on new rot and on stale entries (`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:114-116`,
     `:195-196`). One difference: the baseline says they run. WeeklyReport goes straight to `runAgent`
     (`aiOpsScheduler.ts:266`, `aiOrchestrator.ts:661-662`), which returns without running when the row is
     missing. So unless production has a row the seed does not create, it does not run.
2. **Pause is ignored by five timers.** `trackAgentRun` reads only `enabled` (`agentRunTracker.ts:33`),
   which covers AutonomousEngine, AICOOStrategicCycle, MetaAgentLoop and CoryEvolutionCycle, and so does
   CampaignHealthScanner's own check (`aiOrchestrator.ts:109`). Pausing them does nothing.
   Pause writes only `status` and leaves `enabled` true (`backend/src/services/aiOpsService.ts:296-297`), so
   pause, the control an operator reaches for first, is the one these five cannot see. They include
   AutonomousEngine and MetaAgentLoop, the self-modification loop. Live risk, and the first to fix.
3. **A pause clicked during a run is undone when the run ends.** A pause set while the agent is idle
   holds, because both wrappers check for it before running. But every wrapper writes the status back to
   `idle` or `error` at the end of a run (`aiOrchestrator.ts:234`, `cronInstrumentation.ts:75`). For a job
   that runs for minutes, mid-run is exactly when someone reaches for pause. The fix is a closing write that
   only sets the status if it is still `running`. The same write computes `run_count` from the row loaded
   at the start (`aiOrchestrator.ts:236`), so a concurrent increment is lost. Live risk; it has to follow
   finding 2, because a pause checked at the start of a run is worthless if the last run's closing write
   erased it. Ellis recommends disable.
4. **Dara's directors have two switches, and the scheduler comment is false.** The comment says the
   directors gate on Dara's own row (`backend/src/services/aiOpsScheduler.ts:118-128`). The code gates
   them on `WorkforceCurriculumDirector` and `WorkforceCertificationDirector`
   (`backend/src/services/workforce/directorActions.ts:71`, `:73`). Disabling one of those rows leaves the
   timer firing, Dara's row counting a successful run, and nothing written.
5. **A disable is not fail-safe, by design.** If the registry lookup throws, `instrumentCronJob` runs the
   job anyway (`cronInstrumentation.ts:28-31`). This is deliberate and pinned by the test "failure path: a
   registry lookup failure still runs the job untracked rather than skipping it"
   (`backend/src/services/__tests__/cronInstrumentation.test.ts:98`). A fail-closed version once stopped
   CoryEvolutionCycle from ever running (`backend/src/services/agentRunTracker.ts:22-24`).
   - Failing closed everywhere would be the wrong fix. A brief lookup error would halt about 85 timers,
     including the recovery jobs, and cron does not replay a skipped tick.
   - The real exposure is narrow: a partial fault where only the gate's read fails and the job's own
     work still succeeds. In a full outage most of these jobs fail on their own first query.
   - The platform already has the right pattern: a lenient and a strict kill-switch reader over one key
     (`backend/src/services/launchSafety.ts:124`, `:144`). Only jobs with an irreversible external effect
     (outreach, messaging, publishing, posting) need the strict reading.
6. **Most skips are not the structured event the brief describes.** Only `instrumentCronJob` logs
   `cron_job_skipped_disabled`. `runAgent` and `trackAgentRun` log a plain console line, and the director
   gate returns a reason with no log.
7. **The audit row does not say what changed.** A control call is recorded as action `create` on entity
   `registry`, with the request body and `old_values` null (`backend/src/middlewares/auditMiddleware.ts:56-90`).
   So "who disabled this, and was it on before?" needs the body. Without it, a disable that was never
   re-enabled cannot be told from a row seeded off.

## Which controls actually contain an agent

Added after A.M.'s review, which suggested it. For any agent, Ellis answers **"if I press disable, or
pause, does this agent actually stop?"**, timer by timer:

| Effect | Meaning |
|---|---|
| stops | the run does not start |
| stops writes only | an inner gate: the timer fires and an earlier row counts the run, but nothing is written |
| holds only between runs | a pause set during a run is undone when that run ends, because the wrapper writes the status back (`aiOrchestrator.ts:234`, `cronInstrumentation.ts:75`) |
| does not stop | the wrapper reads only `enabled`, and pause leaves `enabled` true (`aiOpsService.ts:296-297`) |
| unknown | how the wrapper treats the row is not known |

It sums these up for disable and for pause (yes, only between runs, partly, no, unknown), names the timers
where pause is inert, and says "use disable, not pause" when that is the honest advice. A name with no row
gets "no control contains it". The governance schedule row is listed as a separate switch.

It also lists every registered agent that pause does not fully contain, so an operator knows before
reaching for it. In the example that is AutonomousEngine and CampaignHealthScanner (pause does nothing),
and Dara and AdmissionsAssistantAgent (pause holds only between runs). Like the table above, this covers
the timers in `aiOpsScheduler.ts` only.

## How to run it

```
npm run disable-recommendation -- --snapshot examples/disable-recommendation.example.json
npm run disable-recommendation -- --snapshot examples/disable-recommendation.example.json --agent AutonomousEngine
npm run disable-recommendation -- --snapshot examples/disable-recommendation.example.json --pause-gaps
```

The example is not production data. It uses the real wiring for:
- Dara's three timers;
- a timer gated by a differently named row (AdmissionsAssistant);
- a name with no row (WeeklyReport);
- a wrapper that ignores pause (AutonomousEngine).

Exit codes:
- 0: every request yields a disable recommendation
- 3: any request yields none (no flag, already disabled, or no evidence)
- 1: bad input

With `--agent`: 0 when pause contains the agent as fully as disable, 3 otherwise. With `--pause-gaps`: 0
when every agent is fully contained by pause, 3 when any is not.

## Evidence

- **Named passing tests:**
  - "acceptance: a recommendation for a shared agent_name lists all timers that share it"
  - "acceptance: a recommendation for an unregistered name states that no disable flag exists rather than proposing one"

  There are 17 tests in this file and 177 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - listing only the first timer of a shared name fails 1;
  - proposing an action for an unregistered name fails 2;
  - counting a missing row as stoppable fails 1;
  - matching on the timer name instead of the row fails 2;
  - treating an inner gate as stopping the run fails 1;
  - not flagging a wrapper that ignores pause fails 1;
  - counting a wrapper that never reads the row fails 1;
  - counting an unknown wrapper fails 1;
  - recommending with no evidence fails 1;
  - recommending for an agent already disabled fails 1;
  - dropping the governance switch fails 1;
  - leaving requests unsorted fails 1.

  For containment:
  - ignoring the cron wrapper's closing write fails 2;
  - ignoring runAgent's closing write fails 1;
  - counting an inner gate as a full stop fails 1;
  - counting a wrapper that reads only `enabled` as stopping a pause fails 3;
  - reading "partly" as "yes" fails 1;
  - ignoring an unknown wrapper fails 2;
  - treating a name with no row as containable fails 1;
  - dropping the list of timers where pause is inert fails 1;
  - listing fully contained agents as pause gaps fails 1;
  - dropping the "use disable, not pause" advice fails 1;
  - changing the no-row statement fails 1.
- **Not yet run on live records.** K.D. cannot reach the control route (`backend/src/routes/admin/aiOpsRoutes.ts:72`).
  The first live check is one export of `ai_agents` and `cron_schedule_configs`, checked against this
  inventory.
