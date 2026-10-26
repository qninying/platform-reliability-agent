# Legacy migration plan: Platform Automation & Reliability

**Story:** `platform.LEGACY-MIGRATION-PLAN` · **Version:** 1.1 (version 1 approved by K.D. 2026-10-22) · **Accountable human:** K.D.
**Prepared by:** Q. Nkwain Ninying

Platform facts come from the public Colaberry platform repository
([ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator))
at commit `c99021d` (2026-10-21). The files cited below are unchanged at the newer upstream commit `1f3184373`.
Short names used throughout:

| Name | File |
|---|---|
| `CAPS` | `backend/src/services/agentDomain/capabilities/platform.json` (dispositions at `CAPS:4741-5007`) |
| `SCHED` | `backend/src/services/aiOpsScheduler.ts` |
| `SVC` | `backend/src/services/schedulerService.ts` |
| `SEED` | `backend/src/services/agentRegistrySeed.ts` |
| `IDS` | `backend/src/services/agentBlueprint/ticketCreatorIdentitySeed.ts` |
| `CSV` | `docs/architecture/ai-workforce-management/LEGACY_AGENT_CLASSIFICATION.csv` |

## Decisions (approved 2026-10-22)

Version 1 is approved on four conditions:

1. **Phase B does switch records off.** Once a row is approved, phase B disables it (section 4). Nothing is switched off before that row's approval.
2. **The held records stay held:** `workforce_intelligence_engine`, `InboxCaseEngine` and `bpos_orchestrator`. TicketManagementAgent was also held at approval; it is now superseded (see the decision below).
3. **Every switch-off needs its own approval from K.D.**, one row at a time, separate from this plan's approval.
4. **The 29 migrated records keep running unchanged.** They only gain a capability mapping.

Decisions on the open items:

| Item | Decision | Before anything changes |
|---|---|---|
| TicketManagementAgent | **Superseded; two jobs not carried forward.** Held at approval as jobs still to be replaced. Afterwards A.M. confirmed that its two uncovered jobs, assigning unassigned tickets and escalating tickets stuck 48+ hours, are no longer needed, and K.D. agreed by email. Its third job, closing old `in_review` tickets, is covered in part by the resolvers in `agent_ticket_auto_resolution`. | Nothing live changes: the row never runs. Disabling the row still needs its own approval (phase B). |
| The 2 retirements and 4 supersessions | Confirmed, with conditions (section 2). All 4 supersessions now stand, TicketManagementAgent included (decision above). | For each retirement: the code search and git history showing the source never existed, and a read-only check that the registry row never ran. |
| `workforce_intelligence_engine` | Accepted as K.D.'s direct report, as the platform's identity records already state. Not switched on. | Show what it does, its tool grants, the five agents that report through it, and whether it is the same agent as the `WorkforceIntelligence` timer (every 6 hours, no registry row). |

## 1. Completeness: are all 38 records here?

Yes. `CSV` assigns 38 rows to Platform Automation & Reliability, and `CAPS` holds 38 dispositions. A
script compared the two name sets: no name appears in only one of them, and every row has the same `proposed_kind` in both.
Every successor `capability_id` named in a disposition exists among the 48 capabilities in `CAPS`.

| Disposition (brief) | Count | Plan action |
|---|---|---|
| `migrated_to_capability`, sharing a capability with other rows | 21 | **Merged**: several rows become one capability |
| `migrated_to_capability`, sole row of its capability | 8 | **Kept**: carried forward one to one |
| `superseded` | 4 | **Merged into a successor** (TicketManagementAgent with two jobs not carried forward, see section 5) |
| `retired` | 2 | **Retired** |
| `unknown` | 3 | **Held** (section 3) |
| **Total** | **38** | |

## 2. Disposition table

"Line" is the record's `agent_name` line in `CAPS`. "Checked" marks citations I opened myself (section 5).

### Merged (21 rows into 7 capabilities)

| # | Legacy record | Successor capability | Reason | Line | Checked |
|---|---|---|---|---|---|
| 1 | AISafetyMonitorAgent | `agent_behavior_safety_watch` | Same fleet-behaviour watch as #3 | 4743 | `SCHED:334` yes |
| 3 | AgentBehaviorMonitorAgent | `agent_behavior_safety_watch` | Identity and reports_to only, no system_prompt, so it is a behaviour, not an employee | 4757 | `SCHED:335` yes; identity line wrong (section 5) |
| 2 | AccessControlGuardianAgent | `runtime_threat_and_access_watch` | Daily access sweep and 5-minute threat monitor both check live security posture | 4750 | `SCHED:333` yes |
| 22 | RuntimeThreatMonitorAgent | `runtime_threat_and_access_watch` | As #2; differs only in cadence | 4890 | `SCHED:332` yes |
| 28 | WorkforceTicketAutoResolver | `agent_ticket_auto_resolution` | Five resolvers share one close-on-completion-rule mechanism | 4932 | `SCHED:274` yes |
| 8 | CoryEngineTicketAutoResolver | `agent_ticket_auto_resolution` | As #28 | 4792 | `SCHED:284` yes |
| 7 | CoryBrainInitiativeTicketAutoResolver | `agent_ticket_auto_resolution` | As #28 | 4785 | `SCHED:285` yes |
| 10 | InboxCaseSourceCompletionResolver | `agent_ticket_auto_resolution` | As #28, hourly instead of six-hourly | 4806 | `SCHED:298` yes |
| 4 | BposCapabilityTicketAutoResolver | `agent_ticket_auto_resolution` | As #28 | 4764 | `SCHED:307` yes |
| 5 | ChatMessageCleanup | `data_retention_sweep` | 180-day chat retention; same bounded-batch delete as #15, #21 | 4771 | line wrong: real timer `SVC:2491` |
| 15 | PageEventCleanup | `data_retention_sweep` | 90-day page_events retention | 4841 | line wrong: real timer `SVC:2474` |
| 21 | ProposalCleanupService | `data_retention_sweep` | Nightly proposal expiry; one of three names in `UNINSTRUMENTED_AGENTS` | 4883 | `SCHED:344`, `SCHED:115-129` yes |
| 6 | CodeSecurityAuditAgent | `security_posture_scan` | Three static scans over the same repository surface | 4778 | `SCHED:330` yes |
| 9 | DependencySecurityAgent | `security_posture_scan` | As #6 | 4799 | `SCHED:331` yes |
| 23 | SecretDetectionAgent | `security_posture_scan` | As #6; findings name a location, never a secret value | 4897 | `SCHED:329` yes |
| 11 | InfrastructureEvolutionArchitect | `infrastructure_evolution_proposals` | Three architects, one grant shape, proposal-only output | 4813 | `SCHED:321` yes |
| 13 | OrchestrationEcosystemArchitect | `infrastructure_evolution_proposals` | As #11 | 4827 | `SCHED:315` yes |
| 17 | PlatformInnovationArchitect | `infrastructure_evolution_proposals` | As #11 | 4855 | `SCHED:322` yes |
| 19 | PromptMonitorAgent | `prompt_and_performance_optimization` | Monitoring and optimising prompts is one loop | 4869 | `SCHED:203` yes |
| 16 | PerformanceAgent | `prompt_and_performance_optimization` | Internal step of MetaAgentLoop, not scheduled on its own | 4848 | `SCHED:224` yes |
| 20 | PromptOptimizationAgent | `prompt_and_performance_optimization` | Internal step of MetaAgentLoop | 4876 | seed row off by 2: `SEED:697` |

### Kept (8 rows, one capability each)

| # | Legacy record | Capability | Why it stays separate | Line | Checked |
|---|---|---|---|---|---|
| 12 | OrchestrationAutoRepairAgent | `orchestration_auto_repair` | Repair writes state and watching does not; merging would hide a write behind a read's autonomy level | 4820 | `SCHED:204` yes |
| 14 | OrchestrationHealthAgent | `orchestration_health_watch` | Read-only health verdicts | 4834 | `SCHED:192` yes |
| 18 | PreviewStackReaper | `preview_stack_reaping` | Destroys infrastructure, not rows, which touches the default-denied `cloud_resource_deletion` | 4862 | line wrong: real timer `SVC:2332` |
| 24 | SecurityDirectorAgent | `security_oversight_rollup` | Rolls up other agents' verdicts rather than scanning | 4904 | `SCHED:328` yes |
| 25 | StaleActionRecovery | `stale_action_recovery` | Recycling in-flight work can double-execute side effects, so it needs its own attempt cap | 4911 | line wrong: real timer `SVC:2345` |
| 26 | SystemResilienceSuperAgent | `system_resilience_supervision` | Supervisor; capability marked partial | 4918 | `SCHED:351` yes |
| 27 | WorkforceTechnologyDirector | `workforce_technology_direction` | Directs agent tooling, not platform architecture | 4925 | `SCHED:379` yes |
| 35 | PlatformFixAgent | `platform_bug_fix_dispatch` | A tool (on demand, no identity), not a schedule | 4981 | `workGraph/capabilityRegistry.ts:87-91` yes |

### Merged into a successor (superseded)

| # | Legacy record | Successor | Reason | Line | Checked |
|---|---|---|---|---|---|
| 31 | Deployment_Agent | `production_deploy_review_and_approval` (human-performed) | Source never existed; deploys are default-denied | 4953 | `backend/src/services/agents/platform/` absent yes; `executionPolicy.ts:33-42` yes |
| 32 | Performance_Monitoring_Agent | `agent_health_scoring` | Source never existed; health scoring is live elsewhere | 4960 | function is at `aiOpsService.ts:456`, not `:428` |
| 33 | PlatformReportingAgent | `reliability_briefing_for_manager` (proposed, absent; not built yet) | Unwired, so nothing running is lost; marked dead by the test baseline | 4967 | `cronRegistryBaseline.ts:87` yes; seed row is `SEED:1722`, not `:1720` |
| 34 | TicketManagementAgent | `agent_ticket_auto_resolution`, in part | Closing old tickets is covered in part; dispatch and 48-hour escalation are not carried forward (A.M. and K.D.). See section 5, finding 1 | 4974 | yes; the brief's "covered" claim is wrong, the outcome stands by decision |

### Retired

| # | Legacy record | Why it is safe to lose | Line | Checked |
|---|---|---|---|---|
| 29 | Analytics_Agent | Source file never written (`SEED:1339`); analytics belongs to another domain | 4939 | yes: no `analyticsAgent.*` file and no git history |
| 30 | Data_Intelligence_Agent | Source file never written; data intelligence belongs to another domain | 4946 | yes: no file; independently marked dead at `cronRegistryBaseline.ts:54` |

Before either row is disabled, a read-only check must show its registry row never ran (condition of approval).

One note on #29: a case-insensitive search finds `backend/src/services/agents/reporting/agentPerformanceAnalyticsAgent.ts`.
It is a different, live agent (`AgentPerformanceAnalyticsAgent`, category reporting, daily at 04:00) in another
domain, not the missing file. The retirement stands.

## 3. Records the plan cannot classify

### The three known unknowns

| Record | The single question that resolves it | Who can answer | Blocked by |
|---|---|---|---|
| `workforce_intelligence_engine` (`CAPS:5002`) | Are the identity row (`IDS:144-153`) and the timer `WorkforceIntelligence` (`SCHED:269`) one agent, and if so, under which `agent_name`? | K.D. (it reports to K.D. at `IDS:153`) | K.D. has no admin login (brief); confirming it as a direct report is also K.D.'s call |
| `InboxCaseEngine` (`CAPS:4988`) | Which live code writes tickets as this identity: is it an actor or only a label on other code's writes? | Whoever can run a read-only production query on `tickets.created_by_id`: unknown who holds that access | Production read access; also reports through `workforce_intelligence_engine` (`IDS:141`) |
| `bpos_orchestrator` (`CAPS:4995`) | Is the "Universal Ticket Layer" (`IDS:158`) a shared write path or an actor? | Same production query, plus a read of the BPOS write path | Same as above |

Verified: five identities report through `workforce_intelligence_engine` (5 matches for
`reportsToAgentName: AGENT_LEADERSHIP.WORKFORCE_INTELLIGENCE` in `IDS`), and the ownership map shows it
`enabled = false` (`HUMAN_OWNERSHIP_MAP.md:28`). The two names really are split: `cronRegistryBaseline.ts:196`
reads "runs every 6h; no seed row, so run_count is tracked against nothing".

### Any record that is not in the table

The plan does not assume the list stays at 38. A row can appear later (a new seed entry) or turn out to be misfiled.
The rule for any record the migration cannot match to a row in section 2:

- **Hold it.** It is not disabled, not renamed and not mapped. Whatever it does today, it keeps doing.
- **Report it** as `unknown` with its `agent_name`, where it was found, and the question that would classify it.
- **Never default it to retired.** The brief records that across three domains, 28 of 39 rows marked `retire` held live code.

The 21 rows `CSV` assigns to no domain (verified: 21 rows with `proposed_owner_domain` = `unresolved`) are outside
this plan, and fall under the same rule: held, not touched. Whether five of them are live in production is
**unknown** to me; that needs production run data.

## 4. How the migration runs, and why running it twice is safe

**No migration script exists yet.** This section is the specification it must meet. It reuses a mechanism the
platform already has, rather than inventing one.

**Phase A: record (no side effects).** The migration's output is the disposition data itself: one entry per
`agent_name`, already in `CAPS:4741-5007`. Running it means reading that file and comparing it against the registry.
It writes nothing to the database and calls no agent. Running it twice gives the same report.

**Phase B: disable, only after K.D. approves each row.** For a retired or superseded row whose timer should stop,
add it to the platform's existing `RETIRED_AGENTS` map (`SEED:3125`) with its reason. `enforceRetiredAgents`
(`SEED:3148`) runs on every boot (`SEED:3221`) and is already idempotent: a row that is already disabled is skipped
(`SEED:3153`), so the second run changes nothing and logs nothing.

**Rules that keep it replayable:**

| Rule | Why | Source |
|---|---|---|
| Key every step on `agent_name`, and never rename one | The seeder finds rows by `agent_name`; a rename creates a second row and orphans run history | `SEED:3165-3166` |
| Disable, never delete | The seeder re-creates any row still in `AGENT_REGISTRY` on the next boot, so a deleted row comes back | `SEED:3163-3168` |
| Retire through `RETIRED_AGENTS`, not by removing a timer alone | A cron row left `enabled` raises a missed-runs alert forever | `SEED:3141-3146`; `cronHealthAlertService.ts:144` |
| No step sends a message, creates a ticket or moves a ticket | Then there is no side effect to duplicate | This plan's scope |
| Migrated rows are not touched at all | They keep their timers and run stats; only the mapping is new | `CAPS` dispositions |

A replay after a partial failure is also safe: each row is handled on its own (`SEED:3155-3158` catches per row),
and a row already done is skipped.

## 5. Where the brief is wrong

I checked 50 citations from the brief and `CAPS`: every `SCHED` timer line, the seed and identity lines, the
ownership map, the execution policy, the claimed-absent files, and the importer counts. Method: `sed -n` on the
cited line, `git ls-files` and `git log --all` for absent files, `grep` for importers and callers.

### Finding 1: TicketManagementAgent is not covered by the resolvers

The brief: "Its function is covered by the five live resolvers, so it is superseded."

What the code shows (`backend/src/services/agents/ticketManagementAgent.ts`):

| Job | Lines | Successor? |
|---|---|---|
| Auto-dispatch unassigned `todo` tickets to an agent | `:48-78` | **None.** No resolver dispatches, and no platform capability mentions unassigned tickets or auto-dispatch |
| Escalate tickets `in_progress` for 48+ hours | `:13`, `:79-114` | **None** |
| Close `in_review` tickets older than 7 days, with evidence | `:115-161` | Partly: the resolvers close tickets, but by their own completion rules |

The "phantom" part holds. `runTicketManagementAgent` has no caller outside its own file and a test, and no scheduler
reads registry rows to start them. But other production code still assumes the sweep runs:
`backend/src/intelligence/autonomy/autonomousEngine.ts:22-24` says cory-engine's Review tickets "genuinely rely on ...
ticketManagementAgent.ts's real 15-minute auto-dispatch sweep". Apart from this agent, `dispatchTicketToAgent` is
reached only from the manual admin route (`routes/admin/ticketRoutes.ts:273`) and the retry path
(`workGraph/workCoordinatorService.ts:170`).

**Consequence:** if this is unchanged, a `todo` ticket with no assignee may wait until someone dispatches it by hand.
Whether such tickets exist in production now is **unknown**; a read-only count of `status = 'todo' AND assigned_to_id IS NULL`
would settle it.

**Correction:** hold the row (section 3 rule) instead of superseding it. The question for K.D.: should unassigned
tickets still be dispatched automatically, and stale ones escalated? If yes, that needs a successor capability that
does not exist yet. If no, the comments that rely on it are stale and should be corrected.

**Decided:** no. A.M. confirmed the two jobs are no longer needed and K.D. agreed, so the record is superseded and the
two jobs are not carried forward. The comment at `autonomousEngine.ts:22-24` is now stale.

### Finding 2: citations that do not say what is claimed

None of these change a disposition. Each was checked at both `c99021d` and `1f3184373`, with the same result.

| Claim | Cited | What is there | Correct line |
|---|---|---|---|
| ChatMessageCleanup timer `'30 3 * * *'` | `SVC:2474` | The PageEventCleanup timer `'0 3 * * *'` | `SVC:2491` |
| PageEventCleanup timer | `SVC:2457` | A Mandrill poll warning | `SVC:2474` |
| PreviewStackReaper timer | `SVC:2315` | A billing comment | `SVC:2332` |
| StaleActionRecovery timer | `SVC:2328` | A billing log line | `SVC:2345` |
| AgentBehaviorMonitorAgent identity | `IDS:186-198` | The GrowthJourneyHandoffs identity | `IDS:172-184` |
| `getAgentHealthScores` | `aiOpsService.ts:428` | Inside a different function | `aiOpsService.ts:456` |
| PlatformReportingAgent / TicketManagementAgent / PromptOptimizationAgent seed rows | `SEED:1720`, `:1098`, `:695` | Closing braces | `SEED:1722`, `:1100`, `:697` |
| TicketManagementAgent "0 importers" | (count) | 0 production importers, 1 test importer | Holds for production |
| "four retire-classified rows ... enabled=true with 0 runs" | `phase1-reconciliation.md:220` | **File not in the repository** at either commit, and absent from all git history | Unknown |

The `SCHED` citations, which the brief re-measured, are all correct (24 of 24).

### Claims I confirmed

- Never-run agents score 100: `aiOpsService.ts:463` computes `100 - error_count / max(run_count, 1) * 200`, which is 100 when both are 0.
- `production_deploy` is default-denied: `delivery/execution/executionPolicy.ts:33-42`.
- `backend/src/services/agents/platform/` does not exist, so Deployment_Agent and Performance_Monitoring_Agent never had source.
- `HUMAN_OWNERSHIP_MAP.md:41` records K.D. as a human with exactly one AI report, `workforce_intelligence_engine`.
- `cronRegistryBaseline.ts:87` marks PlatformReportingAgent "confirmed_dead, referenced only by the seed file".

## 6. Sequence

| Step | What | Waits on | Changes anything live? |
|---|---|---|---|
| 1 | Plan approved; TicketManagementAgent later superseded, two jobs not carried forward | Done | No |
| 2 | Retirements and supersessions confirmed; read-only "never ran" check for each retirement | Step 1 | No |
| 3 | Settle `workforce_intelligence_engine`: accepted as K.D.'s report; show what it does, its grants, its five reports, and whether it is the `WorkforceIntelligence` timer | K.D. admin access (blocked today) | No |
| 4 | Run the `tickets.created_by_id` query for InboxCaseEngine and `bpos_orchestrator` | Production read access (holder unknown); step 3 | No |
| 5 | Phase A: record dispositions against the registry | Steps 1-2 | No |
| 6 | Phase B: add approved rows to `RETIRED_AGENTS`, one row per approval | Step 5 and a per-row approval from K.D. | Yes, disables a row |
| 7 | Correct the stale citations in `CAPS` (finding 2) | Nothing | No (data file only) |

The 29 migrated rows are not blocked at any step. Nothing in this plan enables an agent, grants a tool or raises an
autonomy level, and every capability stays `draft` until K.D. reviews it.

## Version history

- **Version 1 (approved by K.D. 2026-10-22):** all 38 records accounted for with a reason; replayable two-phase migration on the platform's existing `RETIRED_AGENTS` mechanism; a hold-and-report rule for any record that cannot be classified. Approved on these conditions: phase B switch-offs each need separate approval, the four held records stay held, and the 29 migrated records keep running unchanged.
- **Version 1.1 (2026-10-26):** TicketManagementAgent moved from held to superseded. A.M. confirmed its two uncovered jobs (dispatching unassigned tickets, escalating tickets stuck 48+ hours) are no longer needed, and K.D. agreed by email, so they are not carried forward. Three records remain held.
