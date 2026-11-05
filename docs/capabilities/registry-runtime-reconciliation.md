# Timer registry and agent registry reconciliation

**Story:** `platform.CAP.registry_runtime_reconciliation` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4; folded-in untracked timer proposal rung R3 built in a sandbox · **Approver:** K.D.
**Code:** `src/capabilities/registryReconciliation.ts`, `src/inventory/registrySource.ts`, `src/inventory/sourceScan.ts` (R2), `src/capabilities/ratchetRehearsal.ts` (R4), `src/sandbox/sandboxRegistry.ts`, `src/capabilities/proposalApplyRehearsal.ts` (proposal R3) · **Tests:** `test/registryReconciliation.test.ts`, `test/ratchetRehearsal.test.ts`, `test/proposalApplyRehearsal.test.ts`

Ellis answers **"which timers are untracked, which registry rows are phantom, and which schedules
disagree"** by measuring both lists from the platform's source at run time. Every count is one Ellis
measured, stamped with the measurement time and the platform commit it was measured at. No count is
restated from a document. It is read-only.

Platform facts cite the public Colaberry platform repository at upstream commit `4443087`.

## Why measure, and not read the baseline

The platform has a reconciler, but it runs only in its test suite: "Nothing in production compares the two"
(`backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:8`). It compares the list against a frozen
baseline of accepted disagreements (`cronRegistryBaseline.ts`, "as measured on 2026-10-06"). The suite
passes whenever nothing new appears, so a pass says nothing about how much drift there is.

Ellis reads the checkout itself, applies the platform's five definitions
(`cronRegistryRatchet.ts:90-150`), and reports what it measured:

| Class | Means |
|---|---|
| seed rows with no registration | rows advertising cron with no timer registered under their own name (the platform calls these phantom) |
| scheduled names with no seed row | names a timer fires that have no seed row (the platform calls these untracked) |
| schedule disagreements | the registry's schedule and the seed's differ |
| registered rows denying a schedule | a fired name whose row says it is not cron or has no schedule |
| duplicate registry names | one name on several registry entries, pooling their counters |

The baseline is used for one thing only: to say which entries are **new** since it was frozen, and which
have **healed** and should be deleted from it. Its sizes are never reported. The answer is
`matches_baseline` when nothing differs, and it says that a match means nothing new, not that the drift is
gone.

## Beyond the platform's reconciler

The platform's reconciler assumes that a registry entry records its runs under its own name, and it only
sees timers that register a name. Ellis also reads where each runner records, and every `cron.schedule`
call in the backend:

- **Phantom rows that receive runs.** These are rows the reconciler calls phantom, which a timer under
  another name does write to.
- **Untracked names that record on a row.** These are the same pairs, seen from the timer's side.
- **Registry entries that record no run**, such as the workforce directors' gate
  (`workforce/workforceAgentRuntime.ts:66-69`).
- **Timers with no name.** These are `cron.schedule` calls whose callback calls no wrapper that records a
  run.
- **Untracked names that have a row** among the domain and governance rows, which the reconciler's seed
  set leaves out.

The answer also lists what it cannot see:
- **What actually fires in production.** A `cron_schedule_configs` row replaces a registry schedule, or
  switches an entry off, at start-up and on reload (`aiOpsScheduler.ts:748-750`, `:767-769`, `:652`).
- **Rows created at run time** by `agentFactory`.
- **Whether a timer gated by an environment setting is on.**

## Measured at 4443087

Command: `npm run registry-reconcile -- --source <platform checkout at 4443087>`. Recorded run:
[`examples/registry-reconciliation.run-4443087.json`](../../examples/registry-reconciliation.run-4443087.json),
measured 2026-10-28T01:02:27Z over 4,431 source files.

| Class | Measured |
|---|---|
| Seed rows with no registration | 79 |
| Scheduled names with no seed row | 66 |
| Schedule disagreements | 2 |
| Registered rows denying a schedule | 1 |
| Duplicate registry names | 1 |

- **Against the baseline: 0 new and 0 healed in every class.** This is also the parity check. The platform's
  ratchet fails on any difference in either direction (`cronRegistryRatchet.ts:153-160`), and its "Backend
  unit tests" check passed at `4443087`. So at that commit the baseline is exactly what the platform's
  reconciler measures, and Ellis's measurement equals it entry for entry. No platform code was run.
- **Beyond the platform's reconciler:**
  - 24 of the 79 "phantom" rows receive runs from a timer under another name;
  - 24 of the 66 "untracked" names record their runs on such a row;
  - 7 registry entries record no run at all;
  - 1 registry runner could not be traced (DeptCampaignPerformanceAgent);
  - 14 timers fire with no name.

## What the code showed

**New**

1. **Reporting gap. The reconciler counts 24 agents twice, as phantom and as untracked, and they are
   neither.**
   - Each of the 24 is a registry entry whose runner calls `runAgent` with a different, existing row name.
     For example, `AdmissionsVisitorActivity` (`aiOpsScheduler.ts:229`) runs
     `runAgent('AdmissionsVisitorActivityAgent')` (`aiOrchestrator.ts:460-461`), and `runAgent` looks that
     row up and writes to it (`:184`).
   - So the row does get its runs, and the timer's runs are tracked.
   - The baseline records the pairing as "drift", but says the agent fires "under a name no ai_agents row
     carries" (`cronRegistryBaseline.ts:29-30`). The code does the opposite.
   - What is keyed on the other name is the timer's schedule override (`aiOpsScheduler.ts:748`) and its
     dead-letter label. So an override set on the row's name would not move the timer.
   - Taking the 24 out leaves 55 cron rows that neither a timer of their own name nor a registry runner
     writes to, and 42 fired names with no row.
2. **Reporting gap. 14 timers fire with no name, so nothing that reads `ai_agents` can see them.**
   - Eight are in `server.ts` (`:3482` to `:3608`): discovery, the ops rollup, the BC sync, the
     architect poller, the Cory health canary, two community-rooms timers and the flotation-call sweep.
   - Three are alerting jobs: the cron health check, the dashboard threshold watcher and the error-class
     spike watcher (`schedulerService.ts:3400`, `:3411`, `:3423`). If any of them stops, nothing reports it.
   - The other three are the auto-response tick (`aiOpsScheduler.ts:785`), the repo-tree refresh and the
     broadcast health loop.
   - None of the functions they call records a run either.
   - **Known in part:** the platform's repository map lists four of the `server.ts` schedules as a
     scheduling system (`docs/trust-audit/repository-map.md:69`), and the cron health check records no run
     by design (`schedulerService.ts:3392-3399`). Their invisibility to the reconciler and to every agent
     surface is not recorded.
3. **Latent. The reconciler's seed set leaves out the domain and governance rows.** It reads
   `AGENT_REGISTRY`'s literal entries and the growth-journey entries (`cronRegistryWorld.ts:100`, `:112-117`).
   It does not read the `DOMAIN_AGENT_ENTRIES` spread (`agentRegistrySeed.ts:2878`) or `GOVERNANCE_AGENTS`
   (`governanceService.ts:5-11`). No such name is fired today (measured: 0), so a domain agent given a timer
   would be reported as having no row.

**Small point:** the ratchet's header cites `aiOrchestrator.ts:177-180` for `runAgent`'s row lookup; at
`4443087` it is `:184`.

## Drift, and a proposed row for every untracked timer

Added 2026-11-04, when A.M. folded runtime cron drift detection and untracked timer registration proposal into
this capability. Drift detection was already this capability's answer: every class is a list of names, and its
count is the length of that list, stamped with the time and commit it was measured at. The drift story's
positive control holds on the recorded run: WorkforceIntelligence is in the no-seed-row class.

`--proposals` adds a proposed registry row for every untracked name just measured. Each proposal carries every
call site, the schedule it fires on there, the measurement time and commit, and the enabled value the row would
arrive with. Creating the rows, and choosing to govern or retire each timer, stay with a person.

**The row a timer needs is the row its runner reads, not always its own name.** A timer that goes through
`instrumentCronJob` reads its own name and runs today untracked. A registry entry whose runner calls
`runAgent('<Row>')` reads that row, and `runAgent` finding none returns without running
(`aiOrchestrator.ts:184-188` at `cc1ebc5`). So each proposal says one of:

| Runs today | Proposed row |
|---|---|
| yes, untracked | a row under its own name, arriving enabled: disabled would stop it |
| yes, on another row | none: the row its runner reads exists and already gates it |
| yes, on its own row outside the seed | none: a domain or governance row already carries the name; a second row would collide with it (added 5 November, found by the R3 rung below) |
| no: its runner reads a row that does not exist | that row, arriving disabled: enabled would start a job that does nothing today |
| cannot say: a director gate, or a runner Ellis cannot read | a row under its own name, with a person to check first |

A schedule that is not a literal cron expression, or a name registered on more than one schedule, gets no
proposed schedule and a note. A name with no `cron.schedule` call within 15 lines above it, or with another
timer between them, borrows none.

**Measured at `cc1ebc5`** (`examples/registry-reconciliation.run-cc1ebc5.json`): 67 untracked names. 43 run
today untracked and get a proposed row, each with a readable schedule. 24 are already gated by a row under
another name and need none, for example AdmissionsAssistant, whose runner reads AdmissionsAssistantAgent. The
platform's own reconciler counts all 67 as untracked; a row under each of those 24 names would gate nothing.

## How to run it

```
npm run registry-reconcile -- --source <platform checkout>
npm run registry-reconcile -- --source <platform checkout> --no-baseline
npm run registry-reconcile -- --source <platform checkout> --proposals
```

It reads the checkout's source and `.git` only. It never writes to the checkout and runs none of its code.

Exit codes:
- 0: nothing differs from the baseline
- 4: something new has drifted
- 3: only healed entries differ (shrinking the baseline asserts a defect is fixed, which is K.D.'s call)
- 1: bad input

`--proposals` leaves the exit codes unchanged.

## Evidence

- **Registration proposals** (`src/capabilities/registrationProposal.ts`, `test/registrationProposal.test.ts`, 11
  tests). Named tests: "acceptance: every entry carries a real call-site citation and the measurement date, and the
  count is the one just measured" and "acceptance (drift): every published count has its names behind it, and
  WorkforceIntelligence is in the no-seed-row class on the real run". Ten deliberate breaks, each caught by a
  named test: publishing a name with no call site, letting a job that does nothing arrive enabled, proposing a row
  for a timer another row already gates, ignoring the row the runner reads, assuming an unreadable runner runs,
  guessing an unreadable schedule, dropping the measurement date, borrowing a neighbour's schedule, dropping the
  15-line limit, and leaving a row outside the seed unnamed.
- **Named passing tests:**
  - "acceptance: every count is the measured number of entries, stamped with when and at which commit it
    was measured";
  - "acceptance: no count is restated from the baseline document; changing or removing the baseline changes
    no count".
  - There are 12 tests in this file and 274 in the repo, all passing under `npm test`.
- **Parity with the platform's reconciler at `4443087`:** all five classes match the baseline entry for
  entry (0 new, 0 healed), and the platform's own suite passed at that commit. See the recorded run above.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring the
  code:
  - taking counts from the baseline fails 1;
  - a fixed measurement date fails 1;
  - never reporting healed entries fails 3;
  - adding the domain rows to the platform's seed set fails 5;
  - comparing standard registry entries only fails 1;
  - not treating an empty schedule as a denial fails 1;
  - dropping phantom rows that receive runs fails 1;
  - counting `.test.` files fails 4;
  - a verdict that ignores healed entries fails 2;
  - counting names inside strings fails 4;
  - not resolving a constant name fails 4;
  - reading nested keys fails 1;
  - ignoring `releaseZero` fails 1;
  - not treating `trackAgentRun` as named fails 1;
  - reading a director as untraceable fails 1;
  - not tracking regex literals fails 4;
  - never exiting 3 fails 1;
  - skipping the intel sources fails 3.
- **Not yet run against a live export:** that would also be the first check of what actually fires once
  `cron_schedule_configs` overrides are applied.

## R4: the ratchet fails in both directions

The rung's acceptance: **a planted new violation fails the ratchet and a planted healed entry also fails it, both
directions proven, not just the one that is easy to assert.**

`npm run registry-ratchet-sandbox -- --fixture examples/registry-ratchet.fixture.json` (exit 0 verified, 3 not, 1 bad input).

The platform's ratchet compares what the reconciler observes with the frozen baseline, and fails on a new entry
and on a baseline entry no longer observed, "because a baseline that is never pruned is an allowlist"
(`cronRegistryRatchet.ts:147-160` at `a29dfb245`, unchanged since `4443087`). It runs in the platform's test suite
only.

Ellis runs the full reconciliation (every file read, the platform's five definitions) and the ratchet over a
sandbox checkout shaped like the platform's, whose baseline equals what it measures. Then it plants one change at a
time and runs both again:

| Plant | Class | Direction | The ratchet fails on |
|---|---|---|---|
| a cron seed row no timer registers | seed rows with no registration | new | NewPhantom |
| the row Phantom deleted | seed rows with no registration | healed | Phantom |
| a timer firing a name with no row | scheduled names with no seed row | new | NewUntracked |
| a seed row added for Mystery | scheduled names with no seed row | healed | Mystery |
| Same's registry schedule moved | schedule disagreements | new | Same, `*/7` against `*/5` |
| Disagree's seed schedule corrected | schedule disagreements | healed | Disagree |
| Same's row made event-driven | rows denying a schedule | new | Same |
| Denier's row made cron | rows denying a schedule | healed | Denier |
| a second registry entry named Same | duplicate registry names | new | Same |
| Dup's second entry removed | duplicate registry names | healed | Dup, and its schedule disagreement |

**The checks.** The untouched checkout must pass; otherwise a failing plant means nothing. Each plant must fail
the ratchet with exactly the entries its record expects: a plant that changes nothing, an entry in the wrong
direction, or a failure the record did not expect all fail the check. A fixture without a plant for every class in
both directions is refused, and so is a plant that edits the baseline.

**The contrast.** A ratchet that checks new entries only is the platform's own listed mutant (M8,
`cronRegistryReconciliation.test.ts:81`). Run beside the real one, it catches all 5 new plants and lets all 5
healed plants through.

**What this does not prove.**
- The checkout is a small one shaped like the platform's. The count over the real checkout is the R2 answer above.
- Each plant changes one thing. A new entry and a healed one that cancel out in the same class are not planted.
- Nothing in production compares the two lists. Running a ratchet anywhere outside the platform's test suite is a
  change a person makes.

**Tested:** 8 tests, including the acceptance test named after the criterion. 49 deliberate breaks: 49 caught.
- **Fixed first.** The sandbox reader took a file listed with no text as present; it is now refused as missing.
- **Tests added.** That every file is read, that a healed-only ratchet ignores a new entry, that a plant labelled
  new which only heals breaks the contrast, that an expected entry with an unknown class is refused, and that one
  wrong plant is cited alone.

Its rung story id is on the platform board but not yet in this repository's plan, so it is recorded here and in the
commit.

## R3 (untracked timer proposal): the proposed rows, applied to a sandbox registry

Story `platform.CAP.untracked_timer_registration_proposal.autonomy:R3`. A.M. folded the capability into this one on
4 November; its rung story stands on the board. The rung's acceptance: **each proposed row names its intended
enabled value explicitly, and applying the set to a sandbox registry starts no timer that the proposal marked
disabled.**

`npm run timer-proposal-sandbox -- --fixture examples/timer-proposal.fixture.json --sandbox <empty dir> --operator <name>`
(exit 0 verified, 3 not, 1 bad input). A run without `--operator` is refused.

On an operator's request Ellis measures the sandbox checkout, generates the proposal set, and validates it as data:
every proposed row names enabled as true or false, proposes the row its runner reads, and appears once. It then
builds three SQLite registries in a fresh sandbox folder, each holding every row created in code: one left as it is,
one with the set applied, and one with the same rows applied without enabled. Each `ai_agents` table defaults
enabled to true, as the platform's model does (`backend/src/models/AiAgent.ts:423-427` at `a29dfb245`). Then it ticks
every timer's gate: a row decides when there is one (`agents/agentControlGate.ts:38-44`); with none, an
`instrumentCronJob` timer runs untracked (`cronInstrumentation.ts:35-39`) and a `runAgent` timer does not run
(`aiOrchestrator.ts:184-188`).

The fixture is the ratchet's sandbox checkout plus one registry entry, Ghost, whose runner reads a row that does not
exist (GhostRow). Its proposed row arrives disabled.

| Timer | Proposed row | Before | Applied | Applied without enabled |
|---|---|---|---|---|
| Ghost | GhostRow, **disabled** | does not run | **does not run** | runs |
| Uninst, Tracked, Briefing, AfterRegex, Intel_alpha | own name, enabled | runs, untracked | runs | runs |
| Drift | none: DriftAgent exists | runs | runs | runs |
| DomainScheduled | none: its own domain row exists | runs | runs | runs |

Director and Mystery are not ticked: a director gate and a runner Ellis cannot read do not say what a row would do.

**The checks.** The set validates. At least one row is marked disabled, or "starts no disabled timer" says nothing.
Every row applies. No timer marked disabled starts, and every timer meant to run does. The positive control: applied
without enabled, the column's default starts Ghost, the timer the proposal kept off.

**Found on the way.** Applying the set refused one row: the R2 proposal offered DomainScheduled a second row,
although a domain row already carries the name (its own note said so). The proposal now says no new row is needed
for such a name (`yes_on_its_own_row` in the table above). At `cc1ebc5` no fired name had such a row (measured 0), so
the recorded run is unchanged.

**What this does not prove.**
- The checkout is a small one shaped like the platform's. The proposal set over the real checkout is the R2 answer.
- The sandbox registry holds only rows created in code, all enabled. A production registry also holds rows from
  earlier seeds and `agentFactory`, with whatever enabled values operators set.
- Timers behind a director gate or a runner Ellis cannot read are not ticked.
- Creating the rows in production, and choosing per timer to govern or retire it and with which enabled value, are
  K.D.'s decisions and a person's action.

**Tested:** 8 tests, including the acceptance test named after the criterion. 36 deliberate breaks: 36 caught.
- **Fixed first.** The duplicate row above, in the R2 proposal code, with its R2 test updated.
- **Simplified.** Three pieces of code no test could reach were removed: a seed row arriving disabled, the gate's
  answer when there is no row, and a second test for an unnamed enabled value that the type test already covers.
- **Test added.** A row marked disabled whose name already exists enabled is refused, so the timer keeps running,
  and the run is not verified.
