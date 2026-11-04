# Preview stack reaping

**Story:** `platform.CAP.preview_stack_reaping` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/previewStackReaping.ts` (R2), `src/capabilities/previewReapRehearsal.ts` (R4) · **Tests:** `test/previewStackReaping.test.ts`, `test/previewReapRehearsal.test.ts`

Ellis answers **"which preview stacks are live, how idle is each, and which are reap candidates?"**
Ellis only reads. Stopping a stack destroys running resources, and `cloud_resource_deletion` is
default-denied, so the platform's own timer does the stopping, never an agent.

Platform facts cite the public Colaberry platform repository at upstream commit `4a34e9e` for R2 and `c150d4c48`
for R4.

## Idle comes from real access, never from age

| Idle state | When | Reap candidate |
|---|---|---|
| active | Accessed within the threshold | No |
| idle | Last access is older than the threshold | Yes |
| unknown_idle | No access ever recorded, or the access time is unusable | No |

The only activity signal the platform keeps is `last_accessed_at`. It is set when a request passes the
preview proxy (`backend/src/middlewares/previewProxyMiddleware.ts:113`). The threshold defaults to the
platform's 30 minutes and is labelled as such. The live value is the server's `PREVIEW_IDLE_TIMEOUT_MS`,
which no export carries, so a different value can be passed in.

For each unknown_idle stack, Ellis also says what the platform will do with it. It reports
`platform_would_stop` because the platform measures these stacks by age (finding 2).

Besides the live stacks, the report lists:
- **Attention:** stacks stuck tearing down or provisioning for more than 30 minutes, and failed stacks.
- **The reaper's own run:** ran, overdue, failed, disabled, or untracked.
- **Recent stops:** the stops of the last 24 hours, each cited.

The brief listed it as unknown whether the reaper has an `ai_agents` row. It does
(`backend/src/services/agentRegistrySeed.ts:173`), so its runs are recorded.

## R4: an interrupted teardown, re-run, ends clean

The rung's acceptance: **an interrupted teardown, re-run, reaches a fully clean end state with no orphaned
resources.**

Ellis runs the platform's reap decision (`backend/src/services/previewStackReaper.ts:17-30`) and a
simulated stop (`previewStackService.ts:298-311`) on a sandbox inventory of stacks and their containers.
The platform's stop runs `docker compose stop` first, then marks the row stopped, then logs a stop event.
The fixture interrupts three stops at different points:

- **during the container stop:** one container stopped, the rest still running, the row still `running`;
- **after the container stop:** every container stopped, the row still `running`;
- **at the event write:** the stack is stopped, but the stop event is lost, because a failed event write is
  only printed (`previewStackService.ts:123-129`).

After the interruption, two stacks are out of step with their rows. The re-run picks up exactly those two,
because their rows still say `running`, and finishes them. The end state has no container running behind
a stack that is not running, and the stack in active use and the stack already stopped are untouched. The
lost stop event is reported as a missing record, not as an orphan.

**The check can see orphans.** The same scenario is run again with the order reversed, marking the row
before stopping the containers, which is the order the platform's destructive teardown uses
(`previewStackService.ts:370-374`). Interrupted mid-stop, that leaves containers running behind a row that
says `stopped`, and the re-run never reaches them. If the reversed order did not strand anything, the
rehearsal is not verified: the check would prove nothing.

**Latent: a running stack with no stack path.** The stop skips `docker compose` when the row has no path
but still marks it stopped, which would leave its containers running for good. The platform's own code
does not produce that state, since booting requires a path (`previewStackService.ts:283`, `:320`), so it is
reported here as latent, with a test that shows the outcome.

**What this does not prove.** Containers are modelled as running or stopped; `docker compose` is not run.
Each fault is injected once at one point. Volumes and the repo clone are kept by design when a stack is
stopped, so they are not orphans here. Each answer states these limits.

## What the code showed

1. **A failed stop is recorded as a success and never retried.** The shell helper never reports a
   failure; it returns an exit code (`backend/src/services/previewStackService.ts:42-59`). `stopStack`
   ignores that code and marks the stack stopped anyway (`:305`, `:307`). The reaper only selects
   running stacks, and `stopStack` returns early for anything else (`:301`). So a stack whose containers
   failed to stop is recorded as stopped, keeps running, and is never looked at again. Archive
   (`:355-357`) and destroy (`:374`, `:382`) follow the same pattern. Destroy deletes the stack's row
   even when `docker compose down -v` failed, which leaves containers and volumes with no record at all.
2. **A never-opened stack is judged by its age.** When `last_accessed_at` is empty, the reaper uses
   `last_started_at` (`backend/src/services/previewStackReaper.ts:23-27`). The brief says the idle signal
   must come from real activity. A running stack with neither time set is never selected, so it runs
   until someone stops it.
3. **Reaping does not release resources.** The reaper stops containers, but the database volume and repo
   clone stay on disk (`previewStackReaper.ts:4-7`). Only a manual admin delete frees them
   (`backend/src/routes/admin/previewStackRoutes.ts:142`, `previewStackService.ts:374`). Archive runs
   `docker compose down` without the volume flag (`previewStackService.ts:356`), so the database volume and
   the repo clone both survive it, though archive is the button an operator reaches for to clean up. No
   timer does either, so disk use only grows.
4. **The reaped set is not recorded.**
   - The list of stopped stacks goes only to the server log (`schedulerService.ts:2336-2338`).
   - A stop that throws is caught for each stack separately, so the run is still recorded as a success
     (`previewStackReaper.ts:33-38`).
   - The stop event has no detail, so a reaper stop and an admin stop look the same (`previewStackService.ts:308`).
5. **Every proxied request writes to the database.** The access time is saved on each request through
   the proxy, including asset requests (`previewProxyMiddleware.ts:113`, `previewStackService.ts:338-343`).
6. **The workspace delete checks its path by prefix only.** `rm -rf` runs when the directory starts with
   `PREVIEW_STACKS_ROOT`, with no separator check, so a sibling directory such as
   `/var/preview-stacks-old` would pass (`previewStackService.ts:378-379`).

## How to run it

R4, the sandbox rehearsal: `npm run preview-reap-sandbox -- --fixture examples/preview-reap.fixture.json`
(exit 0 verified, 3 not verified, 1 bad input). R2:

```
npm run preview-reaping -- --snapshot examples/preview-reaping.example.json [--idle-minutes 30]
```

The example is not production data. It shows:
- one active stack;
- one idle stack, the only reap candidate;
- a never-opened stack that the platform would stop by age;
- a stack with no times, which the platform never stops;
- a teardown stuck for 4 hours.

Exit codes:
- 0: every live stack's idleness is known and nothing needs attention
- 3: otherwise
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: a stack with no activity signal at all is reported as unknown-idle, not as idle"
  - "acceptance: stack age is not activity: a never-accessed stack is unknown-idle even when the platform would stop it by age"
  - R4: "acceptance (R4): an interrupted teardown, re-run, reaches a fully clean end state with no orphaned resources"

  There are 11 tests for R2 and 11 for R4, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - measuring idle from stack age, as the platform does, fails the second acceptance test;
  - treating a missing signal as idle fails both;
  - accepting a future access time fails 1;
  - dropping the stuck-transition check fails 1.
  - R4: marking the row before the containers fails 5; never interrupting mid-stop fails 4; not reporting a
    lost stop event fails 2; not reaping a never-accessed stack by age fails 4; halving the idle threshold
    fails 1; a control check that always passes fails 1; a clean check that always passes fails 1; never
    counting orphans fails 5; skipping the re-run fails 4; a fault that fires again on the re-run fails 4.
    The stop's "skip a stack that is not running" guard was removed: the reap decision only hands it running
    stacks, so in the sandbox it could not be reached.
- **R4 is sandbox only.** Nothing reaches docker or a database. Its rung story id is on the platform board
  but not yet in this repository's plan, so it is recorded here and in the commit.
- **Not yet run on live records.** The inventory comes from `GET /api/admin/preview-stacks`, which needs
  an admin login (`previewStackRoutes.ts:20`). The first live check is one export of that response, the
  recent `preview_events` rows, and the reaper's `ai_agents` and activity rows.
