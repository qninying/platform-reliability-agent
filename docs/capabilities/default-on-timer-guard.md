# Default-on timer guard

**Story:** `platform.CAP.default_on_timer_guard` · **Autonomy:** starts R0, first release R2, rung R4 built in a sandbox, ceiling R4 · **Approver:** K.D.
**Code:** `src/capabilities/defaultOnTimerGuard.ts`, `src/cli/defaultOnTimers.ts` (R2), `src/capabilities/defaultOnRehearsal.ts` (R4) · **Tests:** `test/defaultOnTimerGuard.test.ts`, `test/defaultOnRehearsal.test.ts`

This first release names every scheduler registry name that has no governing `cron_schedule_configs` row and says each one
is on by default. It also cites the code that applies that default. The answer is a list of names measured from the
source at run time, not a count copied from a document.

It changes nothing. Whether each ungoverned name should run is K.D.'s decision, and so is switching the default off. Both
stay human decisions at every autonomy level. Applying the switch is a reviewed deploy that a person performs.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run default-on-timers -- --source <platform checkout> [--rows <cron_schedule_configs export.json>]
```

Without `--rows`, Ellis measures against the rows created by the platform's seed (`backend/src/seeds/seedGovernanceConfig.ts`),
and the answer says so. An export must carry `captured_at` and a `cron_schedule_configs` array, each row with `agent_name` and
a boolean `enabled`. A missing table is refused rather than read as an empty one.

Exit codes:
- 0: every name has a row
- 3: at least one name has none
- 5: the default sites are not in the expected shape
- 1: bad input

## What each answer says

- **The ungoverned names.** Each comes with its registry, its registry lines and its hardcoded schedules. A name registered
  more than once is listed once, with every line.
- **The default sites.** Every `enabled = dbEntry?.enabled ?? true` in `aiOpsScheduler.ts` is found by scanning the
  source. Each site is placed in its path (boot or reload) and in the registry its loop walks. The expected shape is one site
  per registry at boot and one covering both registries at reload. Anything else is flagged and exits 5.
- **The column default.** The model's `enabled` column also defaults to true (`backend/src/models/CronScheduleConfig.ts:46`).
- **What a failed row read does.** For the resolver, the boot path and the reload path, Ellis reports whether a failed read
  leaves every timer on. This is read from the source, not exercised.
- **The governed side.** It gives how many names have a row, which of those rows are disabled, and which rows name no
  registry entry and so govern nothing.

## What the platform does today

At `bbde6ef`:
- **The default sites:** `aiOpsScheduler.ts:750` (boot, `SCHEDULE_REGISTRY`), `:769` (boot,
  `DYNAMIC_SCHEDULE_REGISTRY`) and `:649` (reload, both registries).
- **Boot:** when the read fails, boot catches it and carries on with an empty map, so every timer starts
  (`aiOpsScheduler.ts:734-741`).
- **Reload:** the reload path has no catch of its own, and its comment says a failed read changes nothing (`:611-614`). But
  `resolveAllCronSchedules` catches the failure itself and returns an empty map
  (`backend/src/services/governanceResolutionService.ts:212`). Reload therefore gets the same empty map. It cannot tell a
  failed read from a table with no rows, and every timer resolves to hardcoded and enabled. That includes jobs an operator
  had switched off.

So the guard the story describes needs two changes: a default of off, and a read that fails closed at the resolver. The
story's view that only the boot path is unprotected does not match the code: both paths are.

## Limits, stated in every answer

- Rows taken from the seed are not production rows. Production may hold rows made by hand, or lack seeded rows if the seed
  never ran. The list becomes a production measurement only when it runs on an export.
- Timers registered inline (`schedulerService.ts` and elsewhere) never read `cron_schedule_configs`. They are on in code and
  are not on this list.
- The read-failure behaviour is read from the source. Nothing was made to fail.

## Evidence

- **Acceptance:** `the enumeration is a measured list of names, not a count, and it states the three code locations where
  the default is applied` in `test/defaultOnTimerGuard.test.ts`. 11 tests.
- **Each rule can fail:** 32 of 32 deliberate breaks were caught.
- **On the real source at `bbde6ef`:** 74 of 109 registry names (111 entries; `Dara` is registered three times) have no row
  among the 36 the seed creates. 65 are in `SCHEDULE_REGISTRY` and 9 in `DYNAMIC_SCHEDULE_REGISTRY`. One seeded row,
  `StudentProgressMonitor`, names no registry entry. All three default sites were found in the expected shape, and the
  run exited 3. At upstream `5ec9750` the figures are 75 of 110. Upstream adds `GovOpportunityDailySweep`, which
  has no row, and the default sites have moved to `:662`, `:763` and `:782`. The story's
  citations (`:729`, `:748`, `:628`) match neither commit, which is why Ellis finds the sites by scanning rather than from a
  list.
- **The 74 names at `bbde6ef`:** `AISafetyMonitorAgent`, `AccessControlGuardianAgent`, `AdmissionsConversionArchitect`,
  `AdmissionsKnowledgeSyncAgent`, `AdmissionsSuperAgent`, `AgentBehaviorMonitorAgent`, `AlumniNetworkArchitect`,
  `AnalyticsEngineSuperAgent`, `ApolloWeeklyEnrollmentAgent`, `AutonomousRequirementExpansion`,
  `BposCapabilityTicketAutoResolver`, `CampaignOpsSuperAgent`, `CampaignTrafficEnforcement`, `CodeSecurityAuditAgent`,
  `CommercializationWeeklyReport`, `ContentEngineSuperAgent`, `CoryBrainInitiativeTicketAutoResolver`,
  `CoryEngineTicketAutoResolver`, `CoryEvolutionCycle`, `Dara`, `DependencySecurityAgent`, `DeptCampaignPerformanceAgent`,
  `ExecutiveAwarenessEveningDigest`, `ExecutiveStrategyArchitect`, `FinanceIntelligenceArchitect`, `FinanceSuperAgent`,
  `GovOpportunityDailySync`, `GovernanceStrategyArchitect`, `GrowthExperimentArchitect`, `InboxCaseSourceCompletionResolver`,
  `InfrastructureEvolutionArchitect`, `InsightArchitect`, `IntelligenceRetentionCycle`, `LeadIntelligenceSuperAgent`,
  `LearningInnovationArchitect`, `MarketingAutomationArchitect`, `MarketingPublishingWorker`, `OfferRoutingAgent`,
  `OpenclawEngagementMonitor`, `OpenclawFollowUp`, `OpenclawLinkedInCommentMonitor`, `OpenclawQualityGate`,
  `OpenclawResponseOrchestrator`, `OperationsOptimizationArchitect`, `OrchestrationEcosystemArchitect`,
  `PartnershipExpansionArchitect`, `PartnershipSuperAgent`, `PlatformInnovationArchitect`, `ProposalCleanupService`,
  `RuntimeThreatMonitorAgent`, `SecretDetectionAgent`, `SecurityDirectorAgent`, `SkoolBrowserWorker`, `SkoolContentResponse`,
  `SkoolNotificationResponse`, `SkoolQualityGate`, `SkoolSignalDetection`, `SkoolSupervisor`, `StrategicMetricCapture`,
  `StrategicRecommendationCycle`, `StrategicTrendAnalysis`, `StrategyFuturesArchitect`, `StudentSuccessArchitect`,
  `SystemResilienceSuperAgent`, `WeeklyReport`, `WorkforceCareerDirector`, `WorkforceCommunityDirector`,
  `WorkforceFinanceDirector`, `WorkforceIntelligence`, `WorkforceOperationsDirector`, `WorkforceResearchDirector`,
  `WorkforceStudentSuccessDirector`, `WorkforceTechnologyDirector`, `WorkforceTicketAutoResolver`.
- **Not done:** the list has not been run on a production export, so it rests on seeded rows. K.D. has not ruled on any
  name. The dependency `runtime_cron_drift_detection` is held, and nothing here is validated yet.

## R4: the guard, built and proven in a sandbox

The rung's acceptance: **with no row present the timer does not start; with an unreadable configuration table the
scheduler refuses to start rather than starting everything. The second case is the positive control the current boot
path fails.**

`npm run default-on-sandbox -- --fixture examples/default-on.fixture.json` (exit 0 verified, 3 not, 1 bad input).

Ellis builds the two changes the section above calls for. The guard:

- starts a registry timer **only when its row says enabled**. A name with no row does not start, and neither does a
  disabled one;
- lets a failed read of `cron_schedule_configs` through instead of swallowing it. At **boot** the scheduler then
  **refuses to start** and says why; at **reload** it **changes nothing**, keeping what was running;
- tells an **empty table** from an unreadable one. An empty table is read, starts nothing, and says the table holds no
  rows.

The sandbox scheduler boots four times on one fixture: with the table readable, unreadable and empty, then reloads with
the table unreadable. The fixture has five registry names (one registered twice), two enabled rows, one row an
operator switched off, two names with no row, and one row that names no registry entry.

**The control.** The platform's code runs on the same fixture, as it stands at `425e31c9b`: `enabled = dbEntry?.enabled
?? true` (`aiOpsScheduler.ts:763`, `:782` at boot, `:662` at reload), and a resolver that catches a failed read and
returns an empty map (`governanceResolutionService.ts:218`), cached for 30 seconds (`:99`, `:222`). With the table
readable it starts 4 of 5 names, including both with no row. With the table unreadable it starts all 5, which is the
positive control failing as the acceptance says it does. Its reload, despite the comment at `aiOpsScheduler.ts:624-626`,
re-enables the job the row had switched off.

Graded as the subject instead of the guard, the platform's code fails every check, and with the guard as the control
the positive control fails. So each check can fail.

**What this does not prove.** The read fails as a whole; a read that times out, or returns some rows and then fails, is
not run. Refusing to start stops every registry timer, including ones that would have run, and retrying the read is not
built. The names are the fixture's: K.D. has not ruled on which ungoverned production names should run, and until then
the guard cannot be switched on without stopping real work. Applying it is a reviewed deploy by a person, so the ladder
stops at R4.

**Tested:** 12 tests, including the acceptance test named after the criterion. 38 deliberate breaks, all caught. The
first run caught 25 of 39: the checks were never seen to fail, because the guard always passes them, so a test now
grades the platform's code as the subject and expects every check to fail. Two checks were trimmed to their outcome,
because a refusal starts nothing and a kept reload keeps what ran by construction. Its rung story id is on the platform
board but not yet in this repository's plan, so it is recorded here and in the commit.
