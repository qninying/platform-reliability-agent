# Scheduler registration liveness probe

**Story:** `platform.CAP.scheduler_registration_liveness_probe` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/schedulerLiveness.ts`, `src/cli/schedulerLiveness.ts` (R2), `src/capabilities/livenessProbeRehearsal.ts` (R4) · **Tests:** `test/schedulerLiveness.test.ts`, `test/livenessProbeRehearsal.test.ts`

This first release reports what decides whether any timer registers at all, and what the platform's probes can see
of it. It names the flag that gates every timer and the one function that starts the AI Ops scheduler, both measured
from the source on each run. It also says whether `GET /health` could ever fail when nothing registered. Given a boot
log, it reports how many AI Ops timers the last boot registered, against the count the code registers.

It changes nothing. Changing what a probe returns changes what external monitoring treats as an outage. That
decision is K.D.'s. Shipping it is a reviewed deploy.

**K.D. decided on 2026-11-08:** the expected count comes from the deployed code, not a fixed number, and any
shortfall raises the alarm. At boot every registry entry is either scheduled or skipped as disabled, and the cron
inside `startAIOpsScheduler` is scheduled too, so the boot line's two numbers must add up to the code's total.
A boot short of it is a problem (case `registered_below_expected`, exit 3). A boot above it means the log comes from
other code, and is a blind spot, not a pass. On `2663cb27e` (2026-11-08) the code registers 114 AI Ops timers: 113
registry entries and 1 outside them.

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
- The expected count is read from the checkout Ellis is given. It is the deployed code's count only when that
  checkout is the deployed commit.
- A timer deleted from the code leaves the expected count with it, so the probe catches a timer that fails to
  register, not one removed on purpose. The registry ratchet watches removals.

## Evidence

- **Acceptance:** `the report names ENABLE_FOLLOWUP_SCHEDULER as the single flag and startScheduler as the only caller
  of the AI Ops scheduler, both as measured facts` in `test/schedulerLiveness.test.ts`. 10 tests.
- **Each rule can fail:** 32 of 32 deliberate breaks were caught.
- **On the real source:** the run at `bbde6ef` named `ENABLE_FOLLOWUP_SCHEDULER` as the single flag
  (`server.ts:3632`) and `startScheduler` as the only caller (`schedulerService.ts:3490`), and found that `/health` never consults
  the scheduler. It exited 3. At upstream `5ec9750` the answer is the same, with the call at `server.ts:3654` and
  the boot-path cron at `aiOpsScheduler.ts:798`. The story's citations (`env.ts:168`, `server.ts:3462-3464`,
  `schedulerService.ts:3428-3431`) match neither commit.
- **Expected count (2026-11-08):** one new test pins the count from code and the three outcomes against a boot
  (short, matching, more than expected), and the command test checks that a boot one short exits 3 even when the
  probe can see the scheduler. 892 tests in the repo.
- **Not done:** no production boot log has been read, so the running count is unmeasured. K.D. has set the failure
  condition (any shortfall against the deployed code). The dependencies `system_health_probe_and_alerting`
  and `runtime_cron_drift_detection` are held, and nothing here is validated yet.

## R4: the probe, built and proven in a sandbox

The rung's acceptance: **with the flag unset the probe returns non-200 while the database is healthy, the exact case
the current probe returns 200 for.**

`npm run liveness-probe-sandbox -- --fixture examples/liveness-probe.fixture.json` (exit 0 verified, 3 not, 1 bad input).

Ellis builds the probe the story's workflow describes. At boot the sandbox process **records how many timers it
actually registered**. The probe:

- returns **503 when the database is down**, as `GET /health` does today, and says so first;
- returns **503 when no timer registered**, naming the flag's value;
- returns **503 when fewer timers registered than the code registers**, even one fewer;
- otherwise returns **200 with the registered count and the expected count** in the body.

The expected count is the length of the sandbox's registry, its deployed code, as K.D. decided on 2026-11-08. It
first used a pinned count and a lower floor; a fixture that carries either is now refused.

The fixture's code registers eight timers. It leaves `ENABLE_FOLLOWUP_SCHEDULER`
absent, empty, `TRUE` and `1`. None of these is the exact string `true` the platform's parse requires
(`backend/src/config/env.ts:182` at `350243226`), so none starts the scheduler (`server.ts:3701`). In each case
no timer registered, and the probe returned 503. With the flag set it returned 200 and a count of 8. With three timers
failing to register, it returned 503 at a count of 5, and with one failing, 503 at a count of 7. With the database
down it returned 503.

**The control.** The platform's `GET /health` runs `SELECT 1` and nothing else (`routes/healthRoutes.ts:7-15`). On the
same cases it returned 200 in all four flag-unset cases and in both shortfall cases, six in all. That is the exact case
the acceptance names.

Graded as the subject instead of Ellis's probe, `GET /health` fails the flag and shortfall checks. With Ellis's probe as
the control, the positive control fails.

**What this does not prove.** A registered count is not a fired count: a timer can register and never fire, so the
heartbeat check in `GET /health/full` stays the second signal. A timer deleted from the code lowers the expected count
with it; the registry ratchet, not this probe, watches removals. Timers registered outside the task registry are not counted. Changing what `GET /health`
returns changes what external monitoring treats as an outage, so shipping it is a reviewed deploy by a person, and the
ladder stops at R4.

**Tested:** 11 tests, including the acceptance test named after the criterion. 42 deliberate breaks, all caught. The
first run caught 38 of 44. Three survivors were check conditions the probe's own rules already imply, so they were
removed: "registered above zero" on the healthy check, "below the floor" on the shortfall check, and "a down
database still fails", which no probe built here can fail; the test that a down database gives 503 stays. The other
three gained assertions. Its rung story id is on the platform board but not yet in this repository's plan, so it is
recorded here and in the commit. **Changed 2026-11-08** to K.D.'s rule: one more case (one timer short), one more
check, and a fixture with a pinned count or floor refused. Ten deliberate breaks to the new rule, across the probe
check, its output, its command and this rehearsal, all caught.
