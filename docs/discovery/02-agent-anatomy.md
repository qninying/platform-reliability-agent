# Map the nine anatomy elements onto this domain's agent

**Story:** `platform.RESEARCH-2-AGENT-ANATOMY` · **Version:** 5 · **Date:** 2026-10-22 · **Autonomy level today:** R0
**Prepared by:** Q. Nkwain Ninying · **Reviewed by:** K.D. (accountable human)

Platform facts come from the public Colaberry platform repository
([ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator))
at commit `c99021d` (2026-10-21). Paths are relative to that repository; `src/` means `backend/src/`.

## Headline

**The agent itself does not exist yet.** The platform domain has no agent row: `agent_id: null`
(`src/services/agentDomain/agentDomainRegistry.ts:232`). So for the agent (named Ellis), all nine
elements are design decisions. What can be checked is what the platform already offers each one.

| Element | Status on the platform today |
|---|---|
| Reasoning | Partial: a shared LLM call path exists; the model for this agent is not chosen |
| Memory | Partial: activity logs and a human-approved memory table exist; nothing for this agent yet |
| Inputs | Partial: system records exist; operator instructions have no path to this agent yet |
| Communication | **Gap:** alerts exist, but the manager cannot reach any agent surface |
| Tools | Partial: 19 tools are named; no tool grant record exists anywhere |
| Procedures | **Unknown:** no platform reliability runbook exists in the repository |
| Coordination | **Gap:** agent-to-agent handoff does not exist on this platform |
| Safeguards | Exists: kill switch, emergency stop, execution deny list, autonomy caps |
| Verification | Partial: deploy health checks exist; no evaluation of agent output exists |

**Count: 1 of 9 unknown (procedures), 2 of 9 known gaps (communication, coordination),
5 partial, 1 exists.**

Each element below covers what exists, what is missing, and the first honest version. The ten
engineering components from version 3 are kept; each element names the component(s) it maps to.

## 1. Reasoning
*Components: reasoning engine, planner, response generation*

- **Exists:** a shared LLM call path. `chatText` and `chatJson` (`src/services/runtime/runtimeAi.ts:47`, `:62`) default to `gpt-4o-mini` (`src/services/components/costEstimationService.ts:24`).
- **Missing:** which model this agent uses, and its system prompt. Unknown until the agent row exists.
- **First honest version:** one read-only investigation that forms a hypothesis from logs and states its confidence, called through the existing path so cost is recorded per call.

## 2. Memory
*Component: memory*

- **Exists:** `ai_agent_activity_logs` (`src/models/AiAgentActivityLog.ts:119`) records action, reason, confidence, result, details, trace id and duration per run (`:8-19`). `agent_memory_proposals` (`src/models/AgentMemoryProposal.ts:109`) holds memory an agent learned, which is used only after a human approves it (status `pending | approved | rejected`, `:4`).
- **Missing:** whether the activity logs are deep enough to diagnose a failure. That is the logging audit, the first proposed task. Other memory tables have no approval gate (`docs/architecture/ai-workforce-management/MEMORY_MAP.md:5-12`).
- **First honest version:** working memory is the context window for one incident. Long-term memory is written only as an `agent_memory_proposals` row and used only once approved.

## 3. Inputs
*Component: perception layer*

- **Exists:** the schedule of every timed agent, `SCHEDULE_REGISTRY` (`src/services/aiOpsScheduler.ts:172`); the agent registry table `ai_agents` (`src/models/AiAgent.ts:568`); activity logs (above); alerts (`src/models/Alert.ts:138`); execution traces and errors (`src/routes/admin/aiOpsRoutes.ts:76`).
- **Exists (instructions):** a standing instruction from a person to an agent, `manager_directives` (`src/models/ManagerDirective.ts:75`), is injected into the agent's context on every run (`:5-10`) and can only restrict the agent, never widen its authority (`:18-22`).
- **Missing:** read access for this agent. With no tool grant record (see Tools), there is no way to give it read access to these sources yet. Operator or engineer instructions, for example a warning of an expected workload spike, also have no path in yet: a directive needs the agent's own row (`:64`), which does not exist, and the manager cannot reach the surface (see Communication).
- **First honest version:** read the activity log and scheduler in place, never copying them. Take operator and engineer instructions as an input, such as an expected workload spike, recorded as context the agent reads, never as a grant of authority.

## 4. Communication
*Components: response generation, tool layer*

- **Exists:** an alert path, `emitAlert` (`src/services/alertService.ts:50`).
- **Missing (gap):** the manager cannot reach any agent surface. The platform domain has `can_reach_surface: false` (`src/services/agentDomain/agentDomainRegistry.ts:227`) because the manager has no `admin_users` login (`docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19`), and every ai-ops route requires an admin (`src/routes/admin/aiOpsRoutes.ts:44`). The manager briefing capability is `absent` in the capability file.
- **First honest version:** a written report committed or sent outside the platform, until the manager has a way in. The fix is an `admin_users` row with a scoped role, or another surface; that is a decision for A.M. and K.D.

## 5. Tools
*Component: tool layer*

- **Exists:** the 19 tools the 48 capabilities need, named in `src/services/agentDomain/capabilities/platform.json` (`jq '[.capabilities[].required_tools[]]|unique|length'` returns 19). 15 start with `read_`.
- **Missing (gap):** a record of which tools an agent is granted. The only use of `granted_tools` in the codebase is as an input to the autonomy calculation, where no grants caps authority at R2 (`src/services/agentDomain/autonomyLadder.ts:208-211`). No table or file stores grants.
- **First honest version:** an approved list of read-only tools (`read_activity_log`, `read_agent_registry`, `read_cron_run_logs`), held outside the agent and approved by A.M.

## 6. Procedures
*Components: agent specification, orchestration runtime*

- **Exists:** unknown. Runbooks exist for other topics (for example `docs/project-lifecycle/operator-runbook.md`), but none for platform reliability. The agent's specification is not written.
- **Missing:** a runbook per repeat failure, and the agent's scope, severity rules and report format.
- **First honest version:** the agent drafts a runbook only after a person confirms a diagnosis, and the runbook is used only after approval.

## 7. Coordination
*Component: orchestration runtime*

- **Exists:** nothing. Agent-to-agent handoff does not exist on this platform (`src/services/agentDomain/agentDomainStoryTemplates.ts:142`). No platform capability may reach R8, the handoff level (`src/services/agentDomain/autonomyLadder.ts:67`; the highest permitted is R7).
- **Missing:** everything a handoff needs: a record of what was handed over and to whom, a receiving agent in another domain, and approval to operate at R8.
- **First honest version:** none needed now. Story 1 found no dependency outside the platform domain. Coordination with people happens through reports and tickets.

## 8. Safeguards
*Component: guardrails and governance*

- **Exists:** emergency stop and kill switch routes (`src/routes/admin/aiOpsRoutes.ts:90`, `:124`); an execution deny list covering production deploys, production databases and secret exfiltration (`src/services/delivery/execution/executionPolicy.ts:33`); autonomy caps, where production needs a separate pilot approval and human decisions never pass R5 (`src/services/agentDomain/autonomyLadder.ts:203-219`).
- **Missing:** this agent's own identity, so its actions can be attributed to it; there is no agent row yet.
- **First honest version:** read-only credentials, step and cost limits per run, and every action recorded in the activity log under the agent's name.

## 9. Verification
*Component: verification and feedback loop (evals)*

- **Exists:** deployment health checks that wait for the backend to answer before calling a deploy done (`scripts/deploy-prod.sh:312-313`). The ladder defines R5 as shadow-mode evaluation against approved reference outcomes (`src/services/agentDomain/autonomyLadder.ts:64`).
- **Missing:** any evaluation of agent output. No reference outcomes or evaluation set exist for this domain.
- **First honest version:** K.D. spot-checks 5 of the agent's audit scores; after a fix, the agent re-runs the check and records whether the problem went away.

## Sources

- `src/services/agentDomain/agentDomainRegistry.ts:227`, `:232` (manager cannot reach a surface; no agent row)
- `src/services/runtime/runtimeAi.ts:47`, `:62`; `src/services/components/costEstimationService.ts:24` (LLM call path and default model)
- `src/models/AiAgentActivityLog.ts:8-19`, `:119`; `src/models/AgentMemoryProposal.ts:4`, `:109`; `docs/architecture/ai-workforce-management/MEMORY_MAP.md:5-12`
- `src/services/aiOpsScheduler.ts:172`; `src/models/AiAgent.ts:568`; `src/models/Alert.ts:138`; `src/routes/admin/aiOpsRoutes.ts:44`, `:76`, `:90`, `:124`
- `src/models/ManagerDirective.ts:5-10`, `:18-22`, `:64`, `:75` (instructions to an agent: injected at runtime, restrict-only, need an agent row)
- `src/services/alertService.ts:50`; `docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19`
- `src/services/agentDomain/autonomyLadder.ts:64`, `:67`, `:203-219`; `src/services/delivery/execution/executionPolicy.ts:33`
- `src/services/agentDomain/agentDomainStoryTemplates.ts:142`; `scripts/deploy-prod.sh:312-313`
- `jq` queries over `src/services/agentDomain/capabilities/platform.json` for tool counts and capability states

## Version history

- **Version 1 to 2:** replaced the nine body-part terms with ten engineering components; inputs are system data, not a user.
- **Version 3 (approved by K.D. 2026-10-19):** each component shows what implements it (model, data store, runtime code, or prompt and config).
- **Version 4 (approved by K.D. 2026-10-21):** organized by the nine elements the story requires, each mapped to the version 3 components, with what exists today (sourced), what is missing, and the first honest version. Adds the headline count of unknowns and gaps.
- **Version 5:** adds operator and engineer instructions (for example an expected workload spike) to Inputs; Inputs moves from exists to partial because those instructions have no path to the agent yet.
