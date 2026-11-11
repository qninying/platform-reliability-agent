# Autonomy: where Ellis is, and what moves it

Part of the [Ellis README](../README.md).

The platform defines an R0 to R9 ladder per capability
([`autonomyLadder.ts:59-68`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/44430870b/backend/src/services/agentDomain/autonomyLadder.ts#L59-L68)).
Ellis climbs it one step at a time, on evidence K.D. approves.

| Level | Platform meaning | Ellis today |
|---|---|---|
| R0 | Define the workflow, requirements, risks and human decisions | every capability starts here ([discovery](discovery/)) |
| R1 | Prepare isolated development, fixtures and baseline tests | bug fix dispatch: a sealed baseline test, run in a locked sandbox |
| R2 | Answer questions using approved knowledge and records | 17 first releases: report and recommend, change nothing |
| R3 | Perform approved, user-initiated sandbox tool operations | the R3 rungs of schema drift detection (a comparison a person starts, between two sandbox databases), untracked timer proposals (the proposed rows, applied to a sandbox registry) and backup verification (a supplied backup, restored into an isolated target) |
| R4 | Execute and verify stateful, multi-step sandbox tasks | auto-repair and ticket resolution, and the R4 rungs of stale action recovery, preview stack reaping, data retention, the cron overlap guard, the default-on timer guard, the scheduler liveness probe, dead-letter capture, dead-letter replay, error classification, the idempotency audit, bug-fix verification, the health scoring model and the registry ratchet, on sandbox copies only |
| R5 | Evaluate in shadow mode against approved reference outcomes | next step for monitoring; the scoring harness is built ([shadow evaluation](shadow-evaluation.md)) and judges nothing until K.D. sets the acceptable misses and false alarms |
| R6+ | Supervised production pilot, then authorized automation | not started; each needs its own approval |
