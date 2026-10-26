# Ellis: Platform Automation & Reliability Agent

**Ellis watches the AI agents that run the Colaberry platform. It tells a person, with evidence, what is healthy, what is broken, and what it cannot see.**

Colaberry Project Factory, **platform** domain. **Builder:** Quincy Nkwain Ninying. **Manager and stakeholder:** K.D. (AI Engineer). **Approvals:** K.D. gives sign-off, including on agent actions in production. A.M. oversees PR approvals, tool access and governance review.

| Capabilities verified | Tests | Runtime dependencies | Changes to the live platform |
|---|---|---|---|
| 7 of 48 | 89 passing | none (Node 23.6+, TypeScript) | none: read-only, or a sandbox copy |

## How Ellis is built
- **Unknown is never reported as clean.** A scanner that did not run, scanned 0 files or is switched off reads "unknown", and a rollup over it can never be green.
- **Every answer cites its evidence:** the table and row id behind each verdict, so a reviewer can check it.
- **Pinned to the platform's code.** Every rule Ellis copies from the platform names the commit and the file:line it came from.
- **Tests that are shown to catch defects.** For each capability, a key rule is deliberately broken and a named test is confirmed to fail.
- **Built by reading the platform first.** Each write-up's "What the code showed" lists the platform weaknesses found while building it, with file:line references.

**Status (2026-10-26):** Release 1 (discovery and validation) is complete: all five discovery stories are verified on the Colaberry platform. Release 2 (capability development) started at K.D.'s request. Discovery documents are drafts until K.D. approves them; approved versions are kept in `discovery/`.

## Release 1: discovery and validation
| # | Story | Status |
|---|---|---|
| 1 | Compare the five system classes, and place this domain among them | Approved by K.D. 2026-10-22, version 3 ([01-system-classes.md](docs/discovery/01-system-classes.md)) |
| 2 | Map the nine anatomy elements onto this domain's agent | Approved by K.D. 2026-10-21, version 4 ([02-agent-anatomy.md](docs/discovery/02-agent-anatomy.md)) |
| 3 | Document the role and which DA responsibilities transition | Approved by K.D. 2026-10-21, version 2 ([03-role-and-da-transition.md](docs/discovery/03-role-and-da-transition.md)) |
| 4 | 30-minute manager interview and weekly check-in | Interview plan ready; weekly check-in proposed for Mondays 1:30 pm Central ([04-manager-interview.md](docs/discovery/04-manager-interview.md)) |
| 5 | Three proposed agent tasks with boundaries and completion evidence | Version 3; K.D. asked to proceed with building 2026-10-26 ([05-three-proposed-tasks.md](docs/discovery/05-three-proposed-tasks.md)) |

## Release 2: capability development
Each capability is built with tests, and the platform verifies it from this repo. Each one starts at autonomy level R0, and its first release is R2: it reports and recommends, and changes nothing live.

| # | Capability | The question it answers | Platform agents it reads | Write-up | Status |
|---|---|---|---|---|---|
| 1 | **Orchestration health watch** | Is orchestration healthy right now, and when did that last change? | [OrchestrationHealthAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/orchestrationHealthAgent.ts) | [orchestration-health-watch](docs/capabilities/orchestration-health-watch.md) | Verified 2026-10-26, [`cd225af`](https://github.com/qninying/platform-reliability-agent/commit/cd225af) |
| 2 | **Orchestration auto-repair (sandbox only)** | Can the two approved repairs run safely, changing things only once however often they run? | [OrchestrationAutoRepairAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/orchestrationAutoRepairAgent.ts), [PromptMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/promptMonitorAgent.ts) | [orchestration-auto-repair](docs/capabilities/orchestration-auto-repair.md) | Verified 2026-10-26, [`add84c9`](https://github.com/qninying/platform-reliability-agent/commit/add84c9) |
| 3 | **Static security posture scanning** | What did the last secret, code and dependency scan find, and when? | [SecretDetectionAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/secretDetectionAgent.ts), [CodeSecurityAuditAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/codeSecurityAuditAgent.ts), [DependencySecurityAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/dependencySecurityAgent.ts) | [security-posture-scan](docs/capabilities/security-posture-scan.md) | Verified 2026-10-26, [`8ad3ba9`](https://github.com/qninying/platform-reliability-agent/commit/8ad3ba9) |
| 4 | **Runtime threat and access-control watch** | Who can reach which admin section, and what changed since the last check? | [AccessControlGuardianAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/accessControlGuardianAgent.ts), [RuntimeThreatMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/runtimeThreatMonitorAgent.ts), admin roles | [runtime-threat-and-access-watch](docs/capabilities/runtime-threat-and-access-watch.md) | Verified 2026-10-26, [`8263fa2`](https://github.com/qninying/platform-reliability-agent/commit/8263fa2) |
| 5 | **Agent behaviour and AI-safety watch** | Which agents acted outside their grants, and which grant was missing? | [AgentBehaviorMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/agentBehaviorMonitorAgent.ts), [AISafetyMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/aiSafetyMonitorAgent.ts), agent grants | [agent-behavior-safety-watch](docs/capabilities/agent-behavior-safety-watch.md) | Verified 2026-10-26, [`f010814`](https://github.com/qninying/platform-reliability-agent/commit/f010814) |
| 6 | **Security oversight rollup** | Is the platform safe right now, as one verdict over all seven scanners? | [SecurityDirectorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/agents/security/securityDirectorAgent.ts) and the [seven security timers](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/aiOpsScheduler.ts#L328-L335) it supervises | [security-oversight-rollup](docs/capabilities/security-oversight-rollup.md) | Verified 2026-10-26, [`a520ec2`](https://github.com/qninying/platform-reliability-agent/commit/a520ec2) |
| 7 | **Platform data retention sweeps** | What is each table's retention window, and when was it last swept? | [PageEventCleanup, ChatMessageCleanup](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/schedulerService.ts#L2473-L2505), [IntelligenceRetentionCycle](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/cory/intelligenceRetention.ts), [generated-card prune](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/timeline/generatedContentRetention.ts), [ProposalCleanupService](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/769ff4ec1/backend/src/services/proposalCleanupService.ts) | [data-retention-sweep](docs/capabilities/data-retention-sweep.md) | Verified 2026-10-26, [`d267672`](https://github.com/qninying/platform-reliability-agent/commit/d267672) |

41 more capabilities are planned in the platform's build plan for this domain ([`platform.json`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agentDomain/capabilities/platform.json)).

## Run it
```
npm install   # TypeScript for the type check; Ellis itself has no runtime dependencies
npm test
npm run orchestration-health -- --snapshot examples/orchestration-health.example.json
npm run security-rollup -- --snapshot examples/security-rollup.example.json
```
Each capability has a command and an example input in `examples/`. The examples are not production data. Each write-up explains its command and exit codes.

## The platform Ellis watches

Ellis monitors and works with the agents of the Colaberry platform: **[ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator)** (public).
Links below are pinned to commit `c860274`, the version Ellis's capabilities were last checked against.

| What | Where in the platform repo |
|---|---|
| Every scheduled agent and its timer | [`aiOpsScheduler.ts`, `SCHEDULE_REGISTRY`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/aiOpsScheduler.ts#L172) |
| The platform's agents | [`backend/src/services/agents/`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/tree/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents) |
| How each agent run is recorded | [`aiOrchestrator.ts`, `runAgent`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/aiOrchestrator.ts#L171) |
| This domain's 48 draft capabilities | [`agentDomain/capabilities/platform.json`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agentDomain/capabilities/platform.json) |
| Agent registry and activity log tables | [`AiAgent.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/models/AiAgent.ts), [`AiAgentActivityLog.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/models/AiAgentActivityLog.ts) |
| Per-agent write grants | [`agentPermissionService.ts`, `AGENT_PERMISSIONS`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agentPermissionService.ts#L36) |
| Admin roles and sections | [`access/mgmtRoles.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/access/mgmtRoles.ts) |

## Contents
| Path | What |
|---|---|
| `index.html`, `command-center/` | Command Center: progress and plan, read live from `.colaberry/` |
| `assignment.md` | Project assignment and first-deliverable list |
| `research/research-summary.md` | Research summary (deliverable 1), including open questions for K.D. |
| `research/video-review-demo-to-production.md` | Review of the "Demo to Production" video |
| `governance/tool-catalog-approach.md` | Tool approval rule and catalog format |
| `governance/agent-identity.md` | How the agent is treated as a governed identity |
| `docs/migration/legacy-migration-plan.md` | Legacy migration plan for the 38 inherited platform records (version 1 approved by K.D.) |
| `docs/discovery/` | Release 1: the five discovery stories (linked above) |
| `docs/capabilities/` | Release 2: one write-up per capability: what it answers, what the platform code showed, and the evidence |
| `src/`, `test/`, `examples/` | Ellis's code (one file per capability in `src/capabilities/`), its tests, and example inputs |
| `brd/brd-draft-v0.7.pdf` | Business requirement document, early draft v0.7 (2026-10-14, written before platform access) |

## First deliverable checklist
- [x] Research summary with source links
- [x] Component map: `docs/discovery/02-agent-anatomy.md` (version 5; version 4 approved by K.D. 2026-10-21)
- [x] Role summary: `docs/discovery/03-role-and-da-transition.md` (version 2, approved by K.D. 2026-10-21)
- [x] Manager meeting notes (kept private; interview held 2026-10-19, `docs/discovery/04-manager-interview.md`)
- [x] First three proposed agent tasks (info, tools, approvals, proof of completion): `docs/discovery/05-three-proposed-tasks.md`
- [x] Recurring weekly meeting with K.D.: Mondays, 1:30 pm Central ([04-manager-interview.md](docs/discovery/04-manager-interview.md))
