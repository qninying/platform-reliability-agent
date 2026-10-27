# Agent health scoring

**Story:** `platform.CAP.agent_health_scoring` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/agentHealthScoring.ts` · **Tests:** `test/agentHealthScoring.test.ts`

Ellis reports **each agent's health score the way the registry tab computes it, worst first**, and states
which scores rest on zero runs. A score derived from `run_count` 0 is labelled **unscored**, never 100. It is
read-only.

Platform facts cite the public Colaberry platform repository at upstream commit `4443087`.

## Why 100 is the wrong answer for a job that never ran

The registry tab's score is
`max(0, round(100 - (error_count / max(run_count, 1)) * 200 - (status 'error' ? 30 : 0)))`
(`backend/src/services/aiOpsService.ts:466-484`). With no runs and no errors that is 100, shown in green
(`AgentRegistryTab.tsx:67-71`). A timer that never fires and a flawless agent look the same.

What a never-run agent should score is K.D.'s decision. Until K.D. decides, Ellis does not invent a number:
it labels the agent unscored, and still shows what the tab displays.

## The three states

| State | When | What Ellis reports |
|---|---|---|
| **scored** | at least one run counted, and the agent's failures can reach the counters | the tab's score, with notes where it misleads |
| **unscored** | `run_count` is 0 | no score; "no run recorded", or "0 runs counted, but N failures recorded" |
| **score cannot fall** | runs counted, no errors, and every timer for the row uses `trackAgentRun` | no score: that wrapper never adds to `error_count` or sets status (`agentRunTracker.ts:58-70`), so the tab shows 100 whatever happens |

Timers with no `ai_agents` row are listed separately as having no score at all, because the score is read
only from rows (`aiOpsService.ts:466-467`). Each one says what its wrapper does when it finds no row.

## Worst first

The registry lists agents by category, then name (`aiOpsService.ts:245`), not by score. Ellis orders them:

1. agents with failures on record and no score: an agent that throws every time has `run_count` 0, because
   a thrown failure adds to `error_count` but not `run_count` (`aiOrchestrator.ts:158-166`, `:300-306`).
   Labelling it unscored must not bury it, so it goes first;
2. scored agents from the lowest score, ties broken by the higher error rate. The score floors at 0 once
   errors reach half the run count, so many failing agents share 0.

Unscored agents with no failures are not ranked, because there is nothing to rank them by.

## Notes on a scored agent

Ellis adds a note when:
- `error_count` exceeds `run_count`: thrown failures were counted as errors but not runs, so the tab's error
  rate is not a share of runs;
- the agent's wrapper is `instrumentCronJob`, which always writes status idle (`cronInstrumentation.ts:74`),
  so it never takes the 30-point penalty a `runAgent` agent would;
- several timers on different schedules share the row, as Dara's three do, so one score covers all of them;
- no timer in the inventory's scope records under the row.

The answer also says what it cannot tell:
- how an agent is doing now, because both counters are lifetime totals;
- whether a 100 after a repair reflects a run, because the planner's default repair sets `error_count` to 0
  and status idle without running the agent (`ActionPlannerAgent.ts:43`, `ExecutionAgent.ts:45-48`).

## What the code showed

**New**

1. **Reporting gap. The score means different things for different wrappers.**
   - A thrown failure adds to `error_count` but not `run_count` under `runAgent`. So an agent that throws
     every time shows a score of 0 next to an error rate of 0 (`aiOpsService.ts:470-473`). Mixed failures
     give an error rate above 1.
   - `instrumentCronJob` counts every failure as a run and never writes status error, so the same failures
     cost a `runAgent` agent 30 more points.
   - The score floors at 0, so 50% and 100% failing read the same.
   - No test covers `getAgentHealthScores`. Its only consumer is the registry tab (`AgentRegistryTab.tsx:99`).
2. **Reporting gap. The registry tab shows 100 in green when the health request fails.** `fetchHealth` logs
   the error and leaves the list empty (`AgentRegistryTab.tsx:97-103`), and a missing score is shown as 100
   (`:241`). The same happens before the health call returns, and for any agent missing from the response.
3. **Reporting gap. Nothing orders agents by score.** Worst-first triage means scanning every badge.

**Added to earlier findings**
- **The four `trackAgentRun` agents score 100 whatever happens** (finding 54 covers their missing error
  counts; this is the effect on the score).
- **The default repair returns the score to 100 with no run in between** (finding 21 covers its effect on
  tickets). The decision monitor judges the repair by the before and after states stored at the moment of
  the reset (`ExecutionAgent.ts:57`, `:152`; `MonitorAgent.ts:65-67`, `:105`), so it always reads as improved.
  That part is latent: no timer in the inventory's scope runs the monitor.

**Already known:** a never-run agent scores 100. The capability brief states it and leaves the decision to K.D.

## How to run it

```
npm run agent-health -- --snapshot examples/cron-health.example.json
npm run agent-health -- --snapshot examples/cron-health.example.json --source <platform checkout>
```

It reads the same snapshot as cron health alerting: the real fleet as built from platform source at
`4443087`. With `--source`, Ellis first confirms that the checkout's `aiOpsService.ts` still computes the
formula it reproduces; a changed formula is an error. Without it, the pinned copy is named in the answer.

On that fleet: 259 rows, all 259 unscored, and the tab would show 100 for all 259. 41 timers have no row.
7 rows belong to director gates that record no run, so their `run_count` can never move. The example has
no run history; a live export does.

A row without `run_count` or `error_count` is refused: a missing counter is not a zero.

Exit codes:
- 0: every agent is scored
- 4: an agent has failures on record and no score
- 3: some agent is unscored, cannot fall, or has no row
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: every score derived from run_count 0 is labelled unscored rather than 100", over never-run,
    disabled, error-status, always-throwing and director-gate rows;
  - "acceptance, on the real fleet: all 259 rows created in code at 4443087 have run_count 0, and none is
    scored 100";
  - "a zero-run agent with failures on record is unscored but put first in triage, not buried".
  - There are 12 tests in this file and 262 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - leaving zero-run agents with errors scored fails 3;
  - keeping the tab's number for unscored agents fails 2;
  - leaving failing zero-run agents out of triage fails 1;
  - dropping the cannot-fall state fails 1;
  - dropping the error-rate tie break fails 1;
  - a wrong multiplier fails 2, and a wrong penalty fails 1;
  - noting a shared row only from three schedules fails 1;
  - dropping timers with no row fails 2;
  - counting disabled idle agents in the overview fails 1;
  - accepting a missing counter fails 1;
  - never exiting 4 fails 1;
  - not flagging failures behind no score fails 2;
  - saying an unscored `trackAgentRun` agent can fall fails 1.
- **Not yet run on live records.** The first live check is one export of `ai_agents` with `run_count`,
  `error_count` and `status`, compared with what the registry tab shows at the same time.
