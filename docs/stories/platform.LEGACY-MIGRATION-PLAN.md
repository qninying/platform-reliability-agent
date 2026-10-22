# platform.LEGACY-MIGRATION-PLAN — Legacy migration plan

Disposition of this domain's 38 inherited legacy agent record(s).

- **migrated_to_capability**: 29
- **retired**: 2
- **superseded**: 4
- **unknown**: 3

### Superseded (4) -- functionality carried forward
- `Deployment_Agent` -> platform.production_deploy_review_and_approval: The row's source_file backend/src/services/agents/platform/deploymentAgent.ts never existed, which is confirmed because backend/src/services/agents/platform/ itself does not exist on disk. The function it named is still needed and is now explicitly human-performed: production_deploy is one of the eight default-denied capabilities (executionPolicy.ts:33-42, enforcedBy no_provider, 'No DeploymentProvider is implemented'). Recorded as superseded rather than retired so the deployment responsibility is visibly accounted for instead of disappearing with the dead row.
- `Performance_Monitoring_Agent` -> platform.agent_health_scoring: Source file backend/src/services/agents/platform/performanceMonitoringAgent.ts never existed; the whole directory is absent. The function is live elsewhere and better: getAgentHealthScores (aiOpsService.ts:428) plus cronHealthAlertService's latency and error-rate detectors. Superseded rather than retired because the responsibility continues, and the capability records the known defect that a never-run agent scores 100.
- `PlatformReportingAgent` -> platform.reliability_briefing_for_manager: The seed row exists at agentRegistrySeed.ts:1720 (slice cited :1707, stale) but the agent is unwired: no cron call site, no aiOpsScheduler entry, and the test baseline marks it dead at cronRegistryBaseline.ts:87 'PlatformReportingAgent, // audit: confirmed_dead, referenced only by the seed file'. Platform reporting is still a real need, so it is superseded by the proposed manager briefing rather than retired; that capability is honestly marked absent, so nothing here claims the function currently works.
- `TicketManagementAgent` -> platform.agent_ticket_auto_resolution: Source exists at backend/src/services/agents/ticketManagementAgent.ts with 0 importers; the seed row at agentRegistrySeed.ts:1098 (slice cited :1085, stale) declares trigger_type cron '*/15 * * * *' with no instrumentCronJob or scheduler entry, making it a phantom. phase1-reconciliation.md:220 lists it among four retire-classified rows that are enabled=true with 0 runs. Its function is covered by the five live resolvers, so it is superseded. Disabling the phantom row is a live-timer change, is human-decided, and is explicitly out of this build's scope.

### Retired (2) -- and why each is safe to lose
- `Analytics_Agent`: Confirmed dead. Searched for analyticsAgent.* across backend/src on 2026-10-09 and found nothing; the registry's declared source_file backend/src/services/agents/intelligence/analyticsAgent.ts does not exist and has no git history. Retired rather than superseded because analytics is not a platform-reliability responsibility: it belongs to the executive or intelligence domain, so carrying it forward here would misplace it.
- `Data_Intelligence_Agent`: Confirmed dead by the same search: no dataIntelligenceAgent.* file exists anywhere under backend/src and the declared source_file has no git history. Retired rather than superseded for the same reason as Analytics_Agent: data intelligence is not this domain's job, and inventing a platform capability to receive it would be scope creep disguised as continuity.

**A `retire` marking is not self-justifying.** Across three domains in this programme, 28 of 39 rows marked `retire` turned out to hold live, reachable code. Each retirement above states why, and each needs the manager's confirmation.

### Unresolved (3) -- what would settle each
- `InboxCaseEngine`: Identity-only row: ticketCreatorIdentitySeed.ts:132-142 gives it an email, display name, role ai_staff and reportsToAgentName workforce_intelligence_engine, but it has no system_prompt and no persona_version, so it fails the employee rule, and it is neither a schedule nor a plain tool. Its named behaviour is already migrated separately as InboxCaseSourceCompletionResolver, so what is unresolved is the row itself, not the work. WHAT WOULD RESOLVE IT: enumerate every live entry point that writes as this identity (the slice reports real historical ticket volume stamped with the raw agentName as created_by_id), then decide whether it is (a) an employee needing a system_prompt and persona_version, (b) a bare attribution identity for other code's writes, or (c) an identity whose writes should be re-attributed to the agents that actually perform them. That needs a production query over tickets.created_by_id, which this read-only planning task cannot run.
- `bpos_orchestrator`: Identity-only row at ticketCreatorIdentitySeed.ts:156-164, role ai_staff reporting through workforce_intelligence_engine, with no system_prompt or persona_version, so it fails the employee rule and is neither schedule nor tool. Its display name calls it the 'Universal Ticket Layer', which suggests infrastructure many agents write through rather than an agent itself. WHAT WOULD RESOLVE IT: determine whether the BPOS ticket layer is a shared write path or an actor. If it is a write path, the row should be reclassified as infrastructure and its ticket volume re-attributed to the calling agents; if it is an actor, it needs a system_prompt and persona_version and becomes an employee candidate. Settling this needs the production attribution query over tickets.created_by_id plus a read of the BPOS write path, neither of which is in scope here.
- `workforce_intelligence_engine`: The most consequential unresolved row in this domain, for three measured reasons. (1) It is Kesetebirhan Delele's only direct AI report: ticketCreatorIdentitySeed.ts:144-153 sets reportsToOrgMemberId to ORG_MEMBER.KES, and HUMAN_OWNERSHIP_MAP.md:41 records 'Kes Delele | human | 1 (workforce_intelligence_engine)'. The domain registry's own blocker text cites this relationship. (2) It is AI Leadership with five agents reporting through it, while HUMAN_OWNERSHIP_MAP.md:28 records it as enabled=false, so a chain can resolve through a disabled intermediary and still look valid. (3) Its runtime fires under a different name: aiOpsScheduler.ts:269 schedules runWorkforceIntelligenceAgent as 'WorkforceIntelligence', and cronRegistryBaseline.ts:196 records that name as having no seed row, so 'run_count is tracked against nothing'. The identity row and the running timer are two halves of one thing under two names, and neither half is complete. WHAT WOULD RESOLVE IT: reconcile the two names into one registered agent_name; decide whether the resulting row is an employee (which needs the system_prompt and persona_version it lacks) or leadership infrastructure; confirm whether it should be enabled given five agents report through it; and have Kesetebirhan Delele confirm he accepts it as his direct report. All four are his decisions, and he has no admin login with which to make them.

These are recorded as `unknown` rather than guessed. "No useful legacy functionality is silently lost" is the rule, and an unexamined row is exactly where loss hides.

### Not covered by this plan
The 21 legacy records whose `proposed_owner_domain` is `unresolved` belong to no domain and are therefore not in any project's plan. Five of them are live production rows. They need an owner decision, and naming that here is the point.

**Release:** r1 · Legacy migration plan (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Legacy migration plan
**Domain:** Platform Automation & Reliability · **Release:** Legacy migration plan · **Story:** `platform.LEGACY-MIGRATION-PLAN`
**Accountable human:** Kesetebirhan Delele · **Deliverable:** `docs/migration/legacy-migration-plan.md`

## What this is

This is Claude Code work, and the product is a written document. There is no feature to ship
and no agent to switch on. The document is the thing your manager reviews, so it is written
to be read by them rather than by you.

## The specification is the brief on this story, not this prompt

Read the brief above this prompt on the story page. It names this domain's real figures, your
accountable human, and the specific blockers discovery already found. **Those numbers are not
repeated here on purpose:** a second copy drifts from the first, and then nobody knows which
is true. Work from the brief; this prompt tells you how to turn it into a document.

## How to build it

- The brief already contains the disposition of every inherited legacy record for this domain, with reasons and `file:line` evidence. **Your job is not to redo that work.** It is to turn it into a plan a manager can act on, and to check it.
- Verify a sample against the repo. Open two or three of the cited `file:line` references with Claude Code and confirm they say what the brief claims. Record which ones you checked.
- Every record marked `unknown` is the real work. For each, say what single question would resolve it and who can answer.

## What the document must contain

- A disposition table: one row per legacy record, its category, and its successor capability where there is one.
- The `unknown` records called out separately, each with the question that resolves it and the person who can answer.
- Which citations you personally verified, and what you found.
- A sequence: what has to be decided first, and what is blocked until it is.
- Anything in the brief you believe is WRONG, with your evidence. Discovery was done at speed and finding an error in it is a better outcome than agreeing with all of it.

Write it as Markdown with real headings. A wall of prose is not a deliverable, and neither is
a bulleted restatement of the brief.

## Evidence this is done

Cite the real thing. For this story that is the committed file `docs/migration/legacy-migration-plan.md`, and inside it,
every claim carrying either a source or the word unknown.

**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, a document that restates the brief without answering it, or a confident sentence
with no source. Your accountable manager evaluates the evidence.

**Unknown is a real answer and is worth more than a guess.** Several of these questions have
no source material in this repository. Writing "the source does not exist, and here is what
would have to be written" is a complete answer, not a failure to find one.

## Before you start

- **The platform source is PUBLIC. You do not need access granted.** Wherever this brief
  cites a file like `backend/src/services/agentRegistrySeed.ts`, it means the Colaberry
  platform repository:
  **https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator**
  Clone it read-only beside your own project and point Claude Code at it. Sarbjit hit this
  within hours of starting and was right to stop rather than invent an answer: a brief that
  cites a path without naming its repository is the brief being wrong, not you.
- **Nothing in this story authorizes an outbound message.** Do not send an invitation, an
  email or a direct message, and do not record a meeting as booked. Arranging anything with a
  person is a human action taken outside this project.
- **Nothing here changes an agent.** Do not enable one, grant it a tool, or raise an autonomy
  level. A capability stays `draft` until your manager has actually reviewed it.
- Your repo may not be connected yet. The prompt works either way; the story cannot be
  verified and no points are awarded until a repo is connected, because verification is a
  read of your repo.

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The plan accounts for every inherited legacy record for this domain, each one kept, merged or retired with a reason.
- [ ] The migration is described as replayable: running it twice leaves the same end state, with no duplicated side effects.
- [ ] The plan states what happens to a record the migration cannot classify, rather than assuming none exist.

When every box above is ticked, stop and show the demo.
