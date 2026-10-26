# Orchestration health watch

**Story:** `platform.CAP.orchestration_health_watch` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/orchestrationHealthWatch.ts` · **Tests:** `test/orchestrationHealthWatch.test.ts`

Answers one question for K.D. or the on-call admin: **is orchestration healthy right now, and when did it
last change?** It reads the `ai_agents` row for `OrchestrationHealthAgent` and that agent's rows in
`ai_agent_activity_logs`, and nothing else. It writes nothing.

Platform facts cite the public Colaberry platform repository at commit `c99021d`.

## What an answer looks like

Every answer carries a verdict, the reason, when it last changed, and the ids of the rows it was derived
from: the `ai_agents` row and each activity-log row it used. An agent name with no `ai_agents` row gets a
refusal with no verdict and no citations.

| Verdict | When |
|---|---|
| `healthy` | Newest run succeeded with no critical or warning finding |
| `degraded` | Newest run logged `finding_warning` and no `finding_critical` |
| `critical` | Newest run logged `finding_critical` |
| `run_failed` | Newest run has result `failed`, whatever its action text says |
| `stalled` | Newest run is older than three intervals of the row's schedule (15 minutes for `*/5 * * * *`) |
| `not_running` | The row is disabled or paused |
| `unknown` | The row exists but no run has been recorded |

The severity rule is the platform's own: any critical finding is critical, else any warning is degraded
(`backend/src/services/healthReportService.ts:155-157`). Findings are logged as `finding_<severity>`
(`backend/src/services/agents/orchestrationHealthAgent.ts:103`).

## What the code showed, and how the watch handles it

1. **A failed run can read as "no issues".** The agent catches its own failure into `errors[]` instead of
   throwing (`orchestrationHealthAgent.ts:114`). The wrapper then writes result `failed` with the action
   `scan_completed_no_issues` (`backend/src/services/aiOrchestrator.ts:233`, `:238`) and sets the
   `ai_agents` row back to `idle` (`aiOrchestrator.ts:216`). So the watch decides a failed run from
   `result` only, never from the action text or the row's status. Tested.
2. **The brief's exception does not apply to this agent.** The brief says a disabled or paused row logs
   `cron_job_skipped_disabled`. That event comes from `cronInstrumentation.ts`, which this agent does not
   go through: it runs through `runAgent`, which skips with a console line only and writes no activity
   row (`aiOrchestrator.ts:184`, `:189`). So silence from a disabled row is expected, and the watch
   reports `not_running` from the row itself rather than waiting for a skip record. Tested.
3. **"When did it last change" is bounded by the rows read.** The watch reads the newest 50 runs (about
   four hours at five-minute runs). If the verdict did not change within them, it says so and gives no date.

## How to run it

```
npm install
npm test
npm run orchestration-health -- --snapshot <export.json> [--agent <name>] [--now <ISO time>]
```

The snapshot is a dated export of the two tables (format in `src/readSource.ts`, example in
`examples/orchestration-health.example.json`, which is not production data). Exit code 0 is an answer,
2 a refusal, 1 bad input with an `error_class`.

## Evidence

- **Named passing tests** (`npm test`, 14 of 14 pass): among them "every answer cites the ai_agents row
  and only activity rows that belong to it", "no ai_agents row: refusal, no verdict, nothing cited" and
  "failure path: result 'failed' with action 'scan_completed_no_issues' is run_failed, not healthy".
- **The tests catch defects:** removing the `failed` check, or the no-row refusal, makes the matching
  tests fail (checked by editing the code, running `npm test`, and restoring it).
- **Not yet shown on live records.** The answer has not been run against a real export. K.D. has no admin
  login (`backend/src/routes/admin/aiOpsRoutes.ts:44-82`) and A.M.'s agent-management admin screen is
  being built. The first live check is one export from that screen, with K.D. comparing the answer to the
  rows it cites.
