# Compare the five system classes, and place this domain among them

**Story:** `platform.RESEARCH-1-SYSTEM-CLASSES` · **Version:** 3 · **Date:** 2026-10-21 · **Autonomy level today:** R0
**Prepared by:** Q. Nkwain Ninying · **Reviewed by:** K.D. (accountable human)

All platform facts below come from the public Colaberry platform repository
([ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator)),
read at commit `c99021d` (2026-10-21). Paths are relative to that repository. `CAPS` means
`backend/src/services/agentDomain/capabilities/platform.json`.

## The five system classes

### Chatbot
Answers questions from what it knows or is given. It takes no actions, so a human does all the
work and it never notices a problem first.

### Fixed workflow
Runs predefined steps in a fixed order; an LLM may fill one step. Code decides the path, and a
human steps in when a step fails or an input falls outside the expected cases.

### Tool-using agent
Uses tools to finish a single task and chooses the next tool itself. The model decides the
path within the tools it is given, and a human steps in at approval points or when it is blocked.

### Agentic system
Plans, acts, checks the result and adjusts until the goal is met or it must stop. It loops
plan, act, verify, with human checkpoints at hard limits (cost, time, risk) and before anything
irreversible.

### Multi-agent system
Several agents with separate roles hand work to each other through a shared protocol. Humans
step in at handoffs that cross ownership and when agents conflict.

## This domain's figures

| Figure | Value | Source |
|---|---|---|
| Candidate capabilities | 48 | `CAPS:8`; `jq '.capabilities\|length' CAPS` |
| Reserved to a human at every level (`human_decision: true`) | 23 | `jq '[.capabilities[]\|select(.human_decision)]\|length' CAPS` |
| Not reserved to a human | 25 | `jq '[.capabilities[]\|select(.human_decision\|not)]\|length' CAPS` |
| Of those 25, allowed to reach R4 or higher | 23 | `jq '[.capabilities[]\|select((.human_decision\|not) and ((.max_permitted_autonomy\|ltrimstr("autonomy:R")\|tonumber)>=4))]\|length' CAPS` |
| Capabilities that need at least one tool | 48 | `jq '[.capabilities[]\|select((.required_tools\|length)>0)]\|length' CAPS` |
| Capability dependencies, total / outside this domain | 81 / 0 | `jq '[.capabilities[].dependencies[]]\|length' CAPS`; same with `select(startswith("platform.")\|not)` |
| Highest autonomy any capability may reach | R7 | `jq '[.capabilities[]\|.max_permitted_autonomy\|ltrimstr("autonomy:R")\|tonumber]\|max' CAPS` |
| Inherited legacy records | 38 | `CAPS:7`; `jq '.legacy_dispositions\|length' CAPS` |
| Starting autonomy | R0 for all 48 | `jq '[.capabilities[]\|select(.starting_autonomy=="autonomy:R0")]\|length' CAPS` |

The autonomy levels are defined in `backend/src/services/agentDomain/autonomyLadder.ts:59-68`.
R4 is "Execute and verify stateful, multi-step sandbox tasks" (`:63`). R8 is "Coordinate
necessary, authorized handoffs with other agents" (`:67`).

## Recommendation: an agentic system

**This domain needs an agentic system with human checkpoints.** The reason is in the numbers.

- **Not a chatbot:** all 48 capabilities need at least one tool. A chatbot has no tools, so it
  could deliver none of them.
- **Not a fixed workflow:** 23 of the 25 capabilities that are not reserved to a human may reach
  R4, which means executing **and verifying** multi-step tasks (`autonomyLadder.ts:63`). Verifying
  a result and adjusting is the plan, act, verify loop, which a fixed path cannot do.
- **More than a single tool-using agent:** the same 23 need that loop. A tool-using agent picks
  tools for one task but does not check its own result and try again.
- **Checkpoints are built in, not added later:** the other 23 capabilities are reserved to a
  human at every level. The platform caps them at R5 and never automates them
  (`autonomyLadder.ts:213-219`); none is allowed above R5 (`jq` max over `human_decision`
  capabilities returns 5). Nearly half the work therefore stops at a person, so the loop must
  pause for approval rather than run straight through.

**How the answer moves with the numbers:**

- If the 23 capabilities allowed to reach R4 dropped to zero, nothing would need multi-step
  execute-and-verify, and a **tool-using agent** would be enough.
- If the human-reserved count rose from 23 to all 48, every capability would stop at a person.
  The agent would mostly answer and propose, and a tool-using agent working at R2 to R3 would fit.
- If any capability gained a dependency outside `platform.*`, or was allowed to reach R8, the
  case for a **multi-agent system** would open (next section).

**How it is built (carried from version 2):** build the agent first, with its planner
generating each investigation path at runtime from the evidence it finds. Measure cost, accuracy
and latency once it runs, and add deterministic steps only where the measurements show the agent
is inefficient. The platform's existing logging is the deterministic input: the agent reads it
where it lives and never copies it.

## What this domain does NOT need: a multi-agent system

- **No cross-domain dependency exists.** The 48 capabilities list 81 dependencies, and all 81
  point to other `platform.*` capabilities. Zero point to another domain.
- **No capability may coordinate with other agents.** The highest level any capability may reach
  is R7. R8, the handoff level, is not permitted for any of them.
- The platform already runs many single-purpose agents, for example `OrchestrationHealthAgent`
  (`backend/src/services/agentRegistrySeed.ts:386`, scheduled every 5 minutes at
  `backend/src/services/aiOpsScheduler.ts:192`). Watching those agents is work for this domain's
  agent. It does not make this domain a multi-agent system, because nothing is handed between
  agents as part of a task.

**What would justify the next class up:** a multi-agent system becomes justified when at least
one capability needs to hand work to an agent in another domain. In the data, that shows up as a
dependency outside `platform.*` in `CAPS`, or a capability whose `max_permitted_autonomy` is R8 or
higher. Neither exists today.

## Today and unknowns

- **Today:** all 48 capabilities start at R0 and all are drafts. No capability has an approved
  autonomy level, so effective authority is null for every one of them (`CAPS:5011`).
- **Unknown:** no AI employee exists yet for this domain; the story template records it as
  "the AI employee this project will define (none exists yet)"
  (`backend/src/services/agentDomain/agentDomainStoryTemplates.ts:100`). Its name (Ellis) is
  chosen, but it has no registry entry, so its own tool grants cannot be cited yet.
- **Unknown:** cost, accuracy and latency figures. They do not exist until the agent runs.

## Sources

- `backend/src/services/agentDomain/capabilities/platform.json:7-9` (legacy rows, capabilities and tool counts), `:5011` (nothing confirmed, no approved autonomy)
- `backend/src/services/agentDomain/autonomyLadder.ts:59-68` (R0 to R9 meanings), `:213-219` (human decisions capped at R5)
- `backend/src/services/agentDomain/agentDomainStoryTemplates.ts:100` (no AI employee exists yet), `:127` (how the human-reserved count is computed)
- `backend/src/services/agentRegistrySeed.ts:386` and `backend/src/services/aiOpsScheduler.ts:192` (existing orchestration health agent)
- The `jq` queries in the figures table, run against `CAPS` at commit `c99021d`

## Version history

- **Version 1:** placed the domain as an agentic system, starting from deterministic workflows plus one read-only agent.
- **Version 2 (approved by K.D. 2026-10-19):** agent built first and generates its own workflows; measurements decide whether deterministic pieces are added; existing logging named as the deterministic input.
- **Version 3 (approved by K.D. 2026-10-22):** placement unchanged. Adds this domain's real figures with sources, argues the class from them, names multi-agent as not needed with the condition that would change that, and records the unknowns.
