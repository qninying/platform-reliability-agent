# Preview stack reaping

**Story:** `platform.CAP.preview_stack_reaping` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/previewStackReaping.ts` · **Tests:** `test/previewStackReaping.test.ts`

Ellis answers **"which preview stacks are live, how idle is each, and which are reap candidates?"**
Ellis only reads. Stopping a stack destroys running resources, and `cloud_resource_deletion` is
default-denied, so the platform's own timer does the stopping, never an agent.

Platform facts cite the public Colaberry platform repository at upstream commit `4a34e9e`.

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

  There are 11 tests in this file and 100 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - measuring idle from stack age, as the platform does, fails the second acceptance test;
  - treating a missing signal as idle fails both;
  - accepting a future access time fails 1;
  - dropping the stuck-transition check fails 1.
- **Not yet run on live records.** The inventory comes from `GET /api/admin/preview-stacks`, which needs
  an admin login (`previewStackRoutes.ts:20`). The first live check is one export of that response, the
  recent `preview_events` rows, and the reaper's `ai_agents` and activity rows.
