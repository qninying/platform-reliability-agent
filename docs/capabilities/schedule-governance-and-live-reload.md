# Schedule governance and live reload

**Story:** `platform.CAP.schedule_governance_live_reload` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/scheduleGovernance.ts`, `src/inventory/timerHomes.ts` · **Tests:** `test/scheduleGovernance.test.ts`

Ellis proposes schedule changes and never applies them. Each proposal carries:
- the measured run cost and signal rate behind it;
- where the timer lives, because that decides the remedy.

Changing or switching off a live timer is a person's decision at every autonomy level. Ellis never holds the
PATCH.

Platform facts cite the public Colaberry platform repository at upstream commit `c96f6a6`. The run below
read the source at `d85c2ab`, where none of the cited files differs except `schedulerService.ts`.

## Every proposal names the timer's home

| Home | Means | Remedy Ellis states |
|---|---|---|
| `aiops_registry` | in `SCHEDULE_REGISTRY` or `DYNAMIC_SCHEDULE_REGISTRY` (`services/aiOpsScheduler.ts`) | a person applies it on /admin/governance and the reload makes it live without a restart |
| `inline` | registered with `cron.schedule` in `schedulerService.ts` (or another file outside the registries) | restart only: a code change and a deploy; the screen and the reload never reach it |
| `registry_and_inline` | both at once | partly reloadable: the inline timer keeps firing |
| `unknown` | no timer found under the name | labelled unknown, with the reason; no remedy is proposed |

The home is read from the platform's source at run time, not from a list. The reload reconciles the two
registries only (`aiOpsScheduler.ts:632-645`), against task handles it keeps for those two (`:149`).

## What else each proposal says

- **The governance key.** A person often knows a job by its `ai_agents` row, but the screen changes it by
  its registry name. Ellis names the key when they differ. At `d85c2ab`, 24 jobs differ; for example, the row
  `AdmissionsAssistantAgent` has the governance key `AdmissionsAssistant`.
- **Whether the screen can change it.** The PATCH updates an existing `cron_schedule_configs` row and
  returns 404 when there is none (`routes/admin/governanceCenterRoutes.ts:151`, `:156-159`). Without a row
  the timer runs its hardcoded schedule and is on by default (`aiOpsScheduler.ts:649`). Ellis says so, and
  that creating the row is a production write.
- **How to tell whether it went live.** The screen still says "Schedule changes take effect on next server
  restart" (`frontend/src/pages/admin/GovernanceCommandCenter.tsx:376`). The PATCH response's `applied.live`
  is where a person sees the result (`governanceCenterRoutes.ts:42-62`, `:173`).
- **Stopping an inline timer before a deploy.** If it runs through `instrumentCronJob` with an `ai_agents`
  row, disabling that row skips its runs (`services/cronInstrumentation.ts:47-49`). That is the
  enable/disable control, not this screen. With no row, Ellis says stopping it takes a deploy.

## The evidence behind each proposal

Measured over a window (7 days by default) from the run rows `instrumentCronJob` writes
(`cronInstrumentation.ts:88-100`):
- **Runs and failures:** the count, runs per day and mean duration.
- **AI cost:** from the AI calls that share each run's trace id (`models/AiEvent.ts:72`). A call with no
  recorded cost is not counted as zero, and Ellis says the total is a lower bound.
- **Signal rate:** runs whose trace holds any record beyond the wrapper's own row. This is a lower bound: a
  run that writes only to its own tables reads as no signal.
- **Cadence:** fires per day now and under the proposal, and the projected AI cost per day.
- **Row ids:** every figure cites the rows it was computed from.

A job whose runs are recorded by `trackAgentRun`, `runAgent` or its own code has no run row Ellis reads.
Ellis says so rather than reporting zero runs as a fact about the job.

## Where proposals come from

- **Asked by a person:** a new schedule, or switching a timer off.
- **The sweep:** a job whose every run in the window failed, at least three of them, is proposed for
  pausing. Nothing else is proposed unasked.

## How to run it

```
npm run schedule-governance -- --source <platform checkout> --snapshot examples/schedule-governance.example.json \
  --propose 'DailyExecutiveBriefing=45 7 * * 1-5' --disable Intel_mcp_server_spotlight
```

The example uses real job names and wiring at `d85c2ab`, with hand-written rows, runs, costs and governance
rows. It is not production data. A snapshot missing any of its four tables is refused: a missing table is
not an empty one.

Exit codes:
- 0: every proposal has a known home
- 3: at least one proposal has an unknown home
- 4: nothing to propose
- 1: bad input, including a schedule Ellis cannot read as a five-field cron

## Evidence

- **Named passing test:** "acceptance: every proposal says whether the target is in the reloadable aiOps
  registry or inline in schedulerService.ts, and an unknown home is labelled unknown". It covers all four
  homes, a constant name, an intel timer named at run time, and two kinds of unknown.
- **There are 9 tests in this file and 293 in the repo**, all passing under `npm test`.
- **Run on the platform's source at `d85c2ab`**, read from the checkout at run time over 4,486 files. Ellis
  placed all 188 timers, with none unknown and none in both:

  | Home | Count |
  |---|---|
  | `aiops_registry` | 109 governance keys, from 111 registry entries (two share a name) |
  | `inline` | 79 names, from 71 registration sites |

  With the example records:
  - `DailyExecutiveBriefing` is reloadable.
  - `AdmissionsAssistantAgent` is reloadable under the key `AdmissionsAssistant`, with no governance row,
    so a PATCH would return 404.
  - `Intel_mcp_server_spotlight` and `PaySimplePaymentSync` are inline.
  - An unknown name is labelled unknown, exit 3.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code. Each of these 25 edits failed at least one test:
  - reporting both homes as registry only, or an unknown home as inline;
  - ignoring the row a job records under, either for finding its home or for reading its runs;
  - dropping the no-governance-row note;
  - counting an uncosted AI call as zero;
  - reading runs outside the window;
  - letting the sweep fire on two runs, or on runs that only partly failed;
  - reporting zero fires a day where no timer is known;
  - offering to disable an `ai_agents` row that does not exist;
  - counting a run's own row as signal;
  - sweeping a disabled job, or proposing an asked job twice;
  - ignoring the governance row's schedule;
  - dropping the "home unknown" note;
  - treating a name in a comment as a timer;
  - losing an intel timer or a constant name;
  - reading the registry's own wrapper call as an unlisted timer;
  - taking the wrong cron line for an inline timer;
  - exiting 0 on an unknown home;
  - accepting an unreadable cron expression.
- **Not yet run on live records:** the first live check is one export of the four tables for a week. Its
  governance rows should be checked side by side with the /admin/governance screen.
