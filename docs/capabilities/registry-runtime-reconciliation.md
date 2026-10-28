# Timer registry and agent registry reconciliation

**Story:** `platform.CAP.registry_runtime_reconciliation` · **Autonomy:** starts R0, first release R2, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/registryReconciliation.ts`, `src/inventory/registrySource.ts`, `src/inventory/sourceScan.ts` · **Tests:** `test/registryReconciliation.test.ts`

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

## How to run it

```
npm run registry-reconcile -- --source <platform checkout>
npm run registry-reconcile -- --source <platform checkout> --no-baseline
```

It reads the checkout's source and `.git` only. It never writes to the checkout and runs none of its code.

Exit codes:
- 0: nothing differs from the baseline
- 4: something new has drifted
- 3: only healed entries differ (shrinking the baseline asserts a defect is fixed, which is K.D.'s call)
- 1: bad input

## Evidence

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
