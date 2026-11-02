# Scheduler registration liveness probe

**Story:** `platform.CAP.scheduler_registration_liveness_probe` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/schedulerLiveness.ts`, `src/cli/schedulerLiveness.ts` · **Tests:** `test/schedulerLiveness.test.ts`

This first release reports what decides whether any timer registers at all, and what the platform's probes can see
of it. It names the flag that gates every timer and the one function that starts the AI Ops scheduler, both measured
from the source on each run. It also says whether `GET /health` could ever fail when nothing registered. Given a boot
log, it reports how many AI Ops timers the last boot registered.

It changes nothing. Changing what a probe returns changes what external monitoring treats as an outage. That
decision is K.D.'s, as is the expected count a probe would fail against. Shipping either is a reviewed deploy.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run scheduler-liveness -- --source <platform checkout> [--boot-log <file>]
```

Exit codes:
- 0: the public probe can detect zero timers
- 3: it cannot
- 5: the gate or the caller is not the single one the story describes
- 1: bad input

## What the platform does today

At `bbde6ef`:
- **One flag gates every timer.** `startScheduler()` has one call, at `server.ts:3632`. It runs only under
  `env.enableFollowUpScheduler`, which is `process.env.ENABLE_FOLLOWUP_SCHEDULER === 'true'` (`config/env.ts:182`).
- **One caller starts the AI Ops scheduler.** `startScheduler()` loads `startAIOpsScheduler` with `require()` and
  calls it (`services/schedulerService.ts:3490`); nothing else calls it. So one unset variable stops the timers in
  both schedulers.
- **A second copy is never called.** `aiOpsScheduler-Ali-AI.ts:322` defines another `startAIOpsScheduler`, which
  nothing calls. The services README calls the `-Ali-AI` files live, so this is reported, not assumed away.
- **`GET /health` cannot see it.** The route runs `SELECT 1` and nothing else (`routes/healthRoutes.ts:7`). With
  no timer registered it still returns 200.
- **`GET /health/full` sees it late, if at all.** Its heartbeat check (`services/systemHealthService.ts:136`)
  reads a timestamp the scheduler writes. A missing heartbeat is only a warning, so a platform that never
  started its scheduler reads as a warning, and the route returns 200. A heartbeat left from before a restart goes
  critical, and the route 503, only once it is more than 25 minutes old.
- **The registered count is a console line.** `startAIOpsScheduler` prints
  `[AI Ops] Scheduler started: N agents scheduled, M disabled` at boot (`aiOpsScheduler.ts:796`). No endpoint or
  table holds the figure. It also counts a cron registered inside `startAIOpsScheduler` outside both registries
  (`:785`), so it is not a count of registry entries. The registries hold 111 entries.

## Limits, stated in every answer

- A registered timer is not a fired one. This reports registration only, never execution.
- Without a boot log the running count is unknown, and the answer says so rather than estimating it.
- The boot line counts the AI Ops scheduler only. Timers registered inline in `schedulerService.ts` are not in it.
- No expected count is pinned in the platform, so a shortfall cannot be judged, only zero.

## Evidence

- **Acceptance:** `the report names ENABLE_FOLLOWUP_SCHEDULER as the single flag and startScheduler as the only caller
  of the AI Ops scheduler, both as measured facts` in `test/schedulerLiveness.test.ts`. 10 tests.
- **Each rule can fail:** 32 of 32 deliberate breaks were caught.
- **On the real source:** the run at `bbde6ef` named `ENABLE_FOLLOWUP_SCHEDULER` as the single flag
  (`server.ts:3632`) and `startScheduler` as the only caller (`schedulerService.ts:3490`), and found that `/health` never consults
  the scheduler. It exited 3. At upstream `5ec9750` the answer is the same, with the call at `server.ts:3654` and
  the boot-path cron at `aiOpsScheduler.ts:798`. The story's citations (`env.ts:168`, `server.ts:3462-3464`,
  `schedulerService.ts:3428-3431`) match neither commit.
- **Not done:** no production boot log has been read, so the running count is unmeasured. The expected count has
  never been pinned, and K.D. has not approved a failure condition. The dependencies `system_health_probe_and_alerting`
  and `runtime_cron_drift_detection` are held, and nothing here is validated yet.
