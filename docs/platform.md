# The platform Ellis watches

Part of the [Ellis README](../README.md).

**[ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator)** (public).
The links below are pinned to commit `c860274`, the version discovery was done against. Each capability
write-up names the later commit its own rules were checked against.

| What | Where in the platform repo |
|---|---|
| Every scheduled agent and its timer | [`aiOpsScheduler.ts`, `SCHEDULE_REGISTRY`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/aiOpsScheduler.ts#L172) |
| The platform's agents | [`backend/src/services/agents/`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/tree/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agents) |
| How each agent run is recorded | [`aiOrchestrator.ts`, `runAgent`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/aiOrchestrator.ts#L171) |
| This domain's 48 draft capabilities | [`agentDomain/capabilities/platform.json`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agentDomain/capabilities/platform.json) |
| Agent registry and activity log tables | [`AiAgent.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/models/AiAgent.ts), [`AiAgentActivityLog.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/models/AiAgentActivityLog.ts) |
| Per-agent write grants | [`agentPermissionService.ts`, `AGENT_PERMISSIONS`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/agentPermissionService.ts#L36) |
| Admin roles and sections | [`access/mgmtRoles.ts`](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator/blob/c860274f52f8d0a17e9f3a458b76b2a15d797074/backend/src/services/access/mgmtRoles.ts) |
