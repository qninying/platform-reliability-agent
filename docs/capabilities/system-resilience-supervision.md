# System resilience supervision

**Story:** `platform.CAP.system_resilience_supervision` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/systemResilienceSupervision.ts` · **Tests:** `test/systemResilienceSupervision.test.ts`

Ellis answers **"how resilient is the platform right now, and what is each part's state and the age of its
last signal?"** It is read-only: it restarts nothing and changes nothing.

Platform facts cite the public Colaberry platform repository at upstream commit `a284987`. Corrections from
A.M.'s review on 2026-10-27 cite `7c70f0a`.

## How the posture is decided

Ellis reports 13 subsystems, each with a state, the reason, its last signal time and that signal's age:

| Subsystem | Signal | Expected every |
|---|---|---|
| The eight department supervisors (`backend/src/services/aiOpsScheduler.ts:347-354`) | the latest `department_reports` row each one wrote | 30 minutes |
| PromptMonitorAgent, OrchestrationHealthAgent, OrchestrationAutoRepairAgent (`:192`, `:203`, `:204`) | the agent's `ai_agents` row | 1, 5 and 5 minutes |
| Dara's three morning timers (`:367`, `:369`, `:375`) | one shared `ai_agents` row | daily |
| OpenClaw circuit breakers | an export of `GET /api/admin/openclaw/circuit-status` | 30 minutes |

**A subsystem with no signal is unknown, and any unknown subsystem keeps the overall verdict off
"healthy".** No signal includes:
- no row at all;
- a signal older than two of its own intervals;
- a time that is unreadable or in the future;
- a supervisor that could not read its agents, or that reports on 0 agents.

The overall verdict is `unknown` if any subsystem is unknown, otherwise `degraded` if any reports a
problem, otherwise `healthy`. Known problems are still listed when the verdict is unknown.

**Attribution is reported, never guessed.** Dara's three timers write to one row, so Ellis marks that
subsystem's attribution "unavailable". A recent run there shows only that at least one of the three ran.

The report also shows the platform supervisor's own latest verdict and flags when it says healthy and
Ellis does not.

## What the code showed

1. **The "System Resilience" supervisor watches three course-content agents and nothing else.**
   - Its group holds OrchestrationHealthAgent, OrchestrationAutoRepairAgent and PromptMonitorAgent
     (`backend/src/services/agentRegistrySeed.ts:3411-3413`). It reads that group, so its cycle is not blind.
   - Its header names ErrorRecovery, SystemHealth, DatabaseOptimizer and CacheManager agents
     (`backend/src/services/agents/departments/superAgents/systemResilienceSuperAgent.ts:4`), which match no
     registered agent. That is a stale comment, not a defect.
   - It reads no security, timer or circuit-breaker signal, and nothing correlates failures across
     subsystems. The business outcome in the brief is not built yet.
2. **One hour of silence is allowed for every agent.** The staleness rule is one hour whatever the
   schedule (`superAgents/superAgentHealth.ts:99`, `:197`). The prompt monitor runs every minute
   (`aiOpsScheduler.ts:203`), so it can be silent for 59 minutes and the department still reads healthy.
   Ellis measures each signal against twice its own interval. The example shows it: the supervisor says
   healthy while the prompt monitor has been silent for 20 minutes.
3. **The department report tells the truth, and the supervisor's agent row does not.** When a supervisor
   cannot read its agents, its report says health unknown with the error class, stores `collection_ok`
   false and logs the outcome as partial (`superAgents/superAgentBase.ts:134`, `:152-153`, `:167`). But all
   eight supervisors' wrappers return `errors: []` (`systemResilienceSuperAgent.ts:15-17`), and a run only
   counts as failed when it returns errors (`backend/src/services/aiOrchestrator.ts:231`). So the
   supervisor's own `ai_agents` row goes back to idle with its error count untouched.
4. **Circuit breaker state cannot be read from any record.**
   - It is held in server memory and lost on restart (`agents/openclaw/openclawCircuitBreaker.ts:42-43`).
   - A breaker with fewer than 5 tasks in the hour reads `CLOSED` (`:61-63`), so CLOSED means both "fine"
     and "too little to judge". Ellis counts a CLOSED breaker only when it had at least 5 tasks.
   - Reading the status recomputes it. The status route (`backend/src/routes/admin/openclawRoutes.ts:2133-2136`)
     calls `checkCircuitBreaker` for every platform (`:206-214`), which can open a breaker and send a
     critical alert (`:151`, `:159`). Opening a dashboard can change what it shows. It only applies a change
   the error counts already justify, so it cannot trip a healthy breaker, but it can be what sends the alert.
   - **It can also reset an open breaker.** The small-sample check returns `CLOSED` before the cooldown is
     looked at (`openclawCircuitBreaker.ts:61`, `:68`), and `CLOSED` deletes the stored state (`:186`). Once
     an open breaker's task window drains below 5, the next read, a dashboard view included, silently
     resets it mid-cooldown.
5. **Three timers still share one counter.** Dara's curriculum, certification and research timers all
   write one row (`aiOpsScheduler.ts:367`, `:369`, `:375`), so a failure in one cannot be told from
   success in the others. This is the platform's own audit finding D7, still open at `a284987`, and already
   recorded in the cron registry baseline (`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:214-222`).

Not in this release: cross-subsystem failure patterns. They need failure records with a shared error
class and time, which the supervisors do not keep.

## How to run it

```
npm run resilience-posture -- --snapshot examples/resilience-posture.example.json [--now <ISO time>]
```

The example is not production data. It shows:
- a supervisor that never reported;
- a supervisor whose last report is 140 minutes old;
- a degraded supervisor;
- a one-minute timer silent for 20 minutes;
- three timers on one row;
- breakers too thin to judge.

Exit codes:
- 0: healthy
- 3: any subsystem unknown
- 4: degraded with no unknowns
- 1: bad input

## Evidence

- **Named passing test:** "acceptance: a subsystem with no signal is reported as unknown and prevents a
  healthy overall verdict". It removes each of the 13 signals in turn and checks the subsystem reads
  unknown and the verdict is not healthy. There are 12 tests in this file and 149 in the repo, all
  passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - letting a degraded subsystem outrank an unknown one fails 3;
  - using one hour for every signal fails 1;
  - reading a supervisor with no report as healthy fails 1;
  - ignoring a failed agent read fails 1;
  - trusting a report on 0 agents fails 1;
  - not flagging the shared row fails 1;
  - counting thin CLOSED breakers as evidence fails 1;
  - trusting a future time fails 1;
  - letting the earliest report win fails 1;
  - dropping the disagreement flag fails 1;
  - ignoring an agent in error fails 2;
  - ignoring an agent whose every run failed fails 1;
  - ignoring a switched-off agent fails 1;
  - ignoring an open breaker fails 1.
- **Not yet run on live records.** K.D. cannot open the posture surface (`backend/src/routes/admin/aiOpsRoutes.ts:82`).
  The first live check is one export of the latest `department_reports` per supervisor, the four agents'
  `ai_agents` rows and one circuit-status export, all taken at the same time.
