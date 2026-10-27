# Agent enable, disable, pause and resume control

**Story:** `platform.CAP.agent_enable_disable_control` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/agentEnableDisableControl.ts` · **Tests:** `test/agentEnableDisableControl.test.ts`

Ellis answers **"should this agent be stopped, why, and what would stopping it actually stop?"**

**Stopping a live timer is a human decision at every autonomy level.** Ellis recommends and shows the
evidence. It never calls the control route, and every recommendation says a person performs the disable.

Platform facts cite the public Colaberry platform repository at upstream commit `a284987`.

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
scheduled timers:

| Wrapper | Timers | Disable | Pause | When the row is missing |
|---|---|---|---|---|
| `runAgent` (`backend/src/services/aiOrchestrator.ts:177-191`) | 83 | stops | stops | does not run at all |
| `instrumentCronJob` (`backend/src/services/cronInstrumentation.ts:34-52`) | 16 | stops | stops | runs anyway, untracked |
| `trackAgentRun` (`backend/src/services/agentRunTracker.ts:28-36`) | 4 | stops | **ignored** | runs anyway, untracked |
| workforce director gate (`backend/src/services/workforce/workforceAgentRuntime.ts:66-73`) | 7 | stops the writes | stops the writes | writes nothing |
| CampaignHealthScanner's own check (`aiOrchestrator.ts:108-112`) | 1 | stops | **ignored** | runs anyway, untracked |

Ellis takes this wiring as an inventory (each timer, its schedule and every row that can stop it) rather
than guessing from names.

## What the code showed

1. **A timer's name and the row its switch lives on can differ.**
   - 33 of the 109 scheduled timer names have no seeded `ai_agents` row.
   - For 24 of them, the timer checks a row with a different name. For example, timer
     `AdmissionsAssistant` checks row `AdmissionsAssistantAgent` (`aiOrchestrator.ts:539-541`).
   - For the other 8 (the six Skool timers, WeeklyReport and WorkforceIntelligence), the row they check
     is not seeded at all. Unless one was created outside the seed, `runAgent` finds no row and returns
     without running (`aiOrchestrator.ts:177-181`), and there is no flag to disable. The platform's own
     baseline notes WeeklyReport has no seed row (`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:195`).
2. **Pause is ignored by five timers.** `trackAgentRun` reads only `enabled` (`agentRunTracker.ts:33`),
   which covers AutonomousEngine, AICOOStrategicCycle, MetaAgentLoop and CoryEvolutionCycle, and so does
   CampaignHealthScanner's own check (`aiOrchestrator.ts:109`). Pausing them does nothing.
3. **A pause clicked during a run is undone when the run ends.** Every wrapper writes the status back to
   `idle` or `error` at the end of a run (`aiOrchestrator.ts:234`, `cronInstrumentation.ts:75`). So for a
   misbehaving agent that is running, pause does not contain it. Ellis recommends disable.
4. **Dara's directors have two switches, and the scheduler comment says otherwise.** The comment says the
   directors gate on Dara's own row (`backend/src/services/aiOpsScheduler.ts:118-128`). The code gates
   them on `WorkforceCurriculumDirector` and `WorkforceCertificationDirector`
   (`backend/src/services/workforce/directorActions.ts:71`, `:73`). Disabling one of those rows leaves the
   timer firing, Dara's row counting a successful run, and nothing written.
5. **A disable is not fail-safe.** If the registry lookup throws, `instrumentCronJob` runs the job anyway
   (`cronInstrumentation.ts:28-31`), so a disabled agent can still run during a database fault.
6. **Most skips are not the structured event the brief describes.** Only `instrumentCronJob` logs
   `cron_job_skipped_disabled`. `runAgent` and `trackAgentRun` log a plain console line, and the director
   gate returns a reason with no log.
7. **The audit row does not say what changed.** A control call is recorded as action `create` on entity
   `registry`, with the request body and `old_values` null (`backend/src/middlewares/auditMiddleware.ts:56-90`).
   So "who disabled this, and was it on before?" needs the body. Without it, a disable that was never
   re-enabled cannot be told from a row seeded off.

## How to run it

```
npm run disable-recommendation -- --snapshot examples/disable-recommendation.example.json
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

## Evidence

- **Named passing tests:**
  - "acceptance: a recommendation for a shared agent_name lists all timers that share it"
  - "acceptance: a recommendation for an unregistered name states that no disable flag exists rather than proposing one"

  There are 11 tests in this file and 160 in the repo, all passing under `npm test`.
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
- **Not yet run on live records.** K.D. cannot reach the control route (`backend/src/routes/admin/aiOpsRoutes.ts:72`).
  The first live check is one export of `ai_agents` and `cron_schedule_configs`, checked against this
  inventory.
