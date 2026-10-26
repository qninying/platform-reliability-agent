# Ellis: Platform Automation & Reliability Agent

Colaberry Project Factory, **platform** domain. **Builder:** Quincy Nkwain Ninying. **Manager and stakeholder:** K.D. (AI Engineer). **Approvals:** K.D. gives sign-off, including on agent actions in production. A.M. oversees PR approvals, tool access and governance review.

**Status (2026-10-26):** discovery stories 1 to 5 complete on the Colaberry platform; K.D. has asked to move on to building the agent. Release 1 (discovery and validation) is in progress at autonomy level R0 (define the workflow, requirements, risks and human decisions). Work is a draft until K.D. approves it; approved work is kept in `discovery/`.

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

### Capabilities built, and the platform agents each one watches
| Ellis capability | Platform agents and records it reads | Write-up |
|---|---|---|
| Orchestration health watch | [OrchestrationHealthAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/orchestrationHealthAgent.ts) | [orchestration-health-watch.md](docs/capabilities/orchestration-health-watch.md) |
| Orchestration auto-repair (sandbox only) | [OrchestrationAutoRepairAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/orchestrationAutoRepairAgent.ts), [PromptMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/promptMonitorAgent.ts) | [orchestration-auto-repair.md](docs/capabilities/orchestration-auto-repair.md) |
| Static security posture scanning | [SecretDetectionAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/secretDetectionAgent.ts), [CodeSecurityAuditAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/codeSecurityAuditAgent.ts), [DependencySecurityAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/dependencySecurityAgent.ts) | [security-posture-scan.md](docs/capabilities/security-posture-scan.md) |
| Runtime threat and access-control watch | [AccessControlGuardianAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/accessControlGuardianAgent.ts), [RuntimeThreatMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/runtimeThreatMonitorAgent.ts), admin roles | [runtime-threat-and-access-watch.md](docs/capabilities/runtime-threat-and-access-watch.md) |
| Agent behaviour and AI-safety watch | [AgentBehaviorMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/agentBehaviorMonitorAgent.ts), [AISafetyMonitorAgent](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents/security/aiSafetyMonitorAgent.ts), agent grants | [agent-behavior-safety-watch.md](docs/capabilities/agent-behavior-safety-watch.md) |

## Release 1: discovery and validation
| # | Story | Status |
|---|---|---|
| 1 | Compare the five system classes, and place this domain among them | Approved by K.D. 2026-10-22, version 3 (`docs/discovery/01-system-classes.md`) |
| 2 | Map the nine anatomy elements onto this domain's agent | Approved by K.D. 2026-10-21, version 4 (`docs/discovery/02-agent-anatomy.md`) |
| 3 | Document the role and which DA responsibilities transition | Approved by K.D. 2026-10-21, version 2 (`docs/discovery/03-role-and-da-transition.md`) |
| 4 | 30-minute manager interview and weekly check-in | Interview plan ready; weekly check-in proposed for Mondays 1:30 pm Central (`docs/discovery/04-manager-interview.md`) |
| 5 | Three proposed agent tasks with boundaries and completion evidence | Version 3; K.D. asked to proceed with building 2026-10-26 (`docs/discovery/05-three-proposed-tasks.md`) |

## Contents
| Path | What |
|---|---|
| `index.html`, `command-center/` | Command Center: progress and plan, read live from `.colaberry/` |
| `assignment.md` | Project assignment and first-deliverable list |
| `research/research-summary.md` | Research summary (deliverable 1), including open questions for K.D. |
| `research/video-review-demo-to-production.md` | Review of the "Demo to Production" video |
| `governance/tool-catalog-approach.md` | Tool approval rule and catalog format |
| `governance/agent-identity.md` | How the agent is treated as a governed identity |
| `docs/discovery/01-system-classes.md` | Story 1: the five system classes and where this domain sits |
| `docs/discovery/02-agent-anatomy.md` | Story 2: the nine anatomy elements mapped to platform surfaces |
| `docs/discovery/03-role-and-da-transition.md` | Story 3: the accountable human's role and which responsibilities transition |
| `docs/discovery/04-manager-interview.md` | Story 4: 30-minute interview plan, what each answer changes, and the weekly check-in |
| `docs/discovery/05-three-proposed-tasks.md` | Story 5: three proposed agent tasks, their boundaries and completion evidence |
| `docs/migration/legacy-migration-plan.md` | Legacy migration plan for the 38 inherited platform records (version 1 approved by K.D.) |
| `src/`, `test/` | Ellis's code and tests (`npm test`); one file per capability in `src/capabilities/` |
| `docs/capabilities/orchestration-health-watch.md` | Capability: orchestration health watch, what it answers and the evidence |
| `docs/capabilities/orchestration-auto-repair.md` | Capability: orchestration auto-repair in a sandbox, replay safety and the evidence |
| `docs/capabilities/security-posture-scan.md` | Capability: what the last security scan of each kind found, and when, never mistaking a silent scanner for a clean one |
| `docs/capabilities/runtime-threat-and-access-watch.md` | Capability: who holds which admin section today and what changed, telling 'no login' from 'login with no sections' |
| `docs/capabilities/agent-behavior-safety-watch.md` | Capability: which agents acted outside their grants, each finding naming the missing grant |
| `brd/brd-draft-v0.7.pdf` | Business requirement document, early draft v0.7 (2026-10-14, written before platform access) |

## First deliverable checklist
- [x] Research summary with source links
- [x] Component map: `docs/discovery/02-agent-anatomy.md` (version 5; version 4 approved by K.D. 2026-10-21)
- [x] Role summary: `docs/discovery/03-role-and-da-transition.md` (version 2, approved by K.D. 2026-10-21)
- [x] Manager meeting notes (kept private; interview held 2026-10-19, `docs/discovery/04-manager-interview.md`)
- [x] First three proposed agent tasks (info, tools, approvals, proof of completion): `docs/discovery/05-three-proposed-tasks.md`
- [x] Recurring weekly meeting with K.D.: Mondays, 1:30 pm Central (`docs/discovery/04-manager-interview.md`)
