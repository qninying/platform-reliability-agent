# Agent behaviour and AI-safety watch

**Story:** `platform.CAP.agent_behavior_safety_watch` · **Autonomy:** starts R0, first release R2, ceiling R6 · **Approver:** K.D.
**Code:** `src/capabilities/agentBehaviorSafetyWatch.ts`, `src/grants/agentGrants.ts` · **Tests:** `test/agentBehaviorSafetyWatch.test.ts`

Ellis answers **"which agents acted outside their grants recently?"** Every finding names the specific
grant that was missing; anything that cannot name one is not emitted. Ellis only reports. Stopping an
agent is a live-timer change and stays a human decision.

Platform facts cite the public Colaberry platform repository at upstream commit `c860274`.

## Why Ellis does the comparison itself

Neither platform watcher compares actions with grants:

- **AgentBehaviorMonitorAgent** looks for stuck agents, error spikes and slow runs
  (`backend/src/services/agents/security/agentBehaviorMonitorAgent.ts:32-90`).
- **AISafetyMonitorAgent** scans visitor chat messages for prompt injection (`aiSafetyMonitorAgent.ts:55-80`).

The real grant records are `AGENT_PERMISSIONS`, which gives 36 agents a tier, allowed tables and allowed
operations, with a suggest-only default for every other agent
(`backend/src/services/agentPermissionService.ts:36-105`). They are pinned in `src/grants/agentGrants.ts`
with the commit they came from.

## The three sources Ellis reads

| Source | What is known | Checked against |
|---|---|---|
| `agent_write_audits` | Operation and table | Tier, table allowlist, operation allowlist |
| `ai_agent_activity_logs` rows with `before_state` and `after_state` | Operation | Tier, operation allowlist |
| `ai_events` rows of type `agent.authorization` | Action, autonomy level, reason | Reason `level_forbids:<category>` names the level that is missing (`agentAuthorizationService.ts:261-281`) |

Each finding names the missing grant as one of: a tier (write access for a read-only agent), a table,
an operation, or an autonomy level. It cites the row it came from, and says whether the platform allowed
the action, blocked it, would have denied it in shadow mode, or never checked it.

- **Not emitted:** an authorization row whose reason is not a missing grant (an approval rule, the kill
  switch, a disabled agent) is listed under `not_emitted` with the reason, never as a finding.
- **Unattributable:** an action whose agent matches no `ai_agents` row is listed under `unattributable`,
  not dropped.
- **No self-policing:** the watchers' own actions (AgentBehaviorMonitorAgent, AISafetyMonitorAgent,
  Ellis) are excluded and counted.

## What the code showed

1. **No platform watcher checks grants.** The brief's workflow ("recent agent actions are compared
   against each agent's granted tools") does not exist in either monitor.
2. **The write check covers one runtime and skips the operation list.** `validateAgentWrite` checks tier
   and table, never `allowedOperations` (`agentPermissionService.ts:125-169`), and only the workforce
   runtime calls it (`backend/src/services/workforce/workforceAgentRuntime.ts:160`). Agents run through
   `runAgent` write directly. OrchestrationHealthAgent is `read_only` in the grant map, yet stores a
   health snapshot on every run (`backend/src/services/agents/orchestrationHealthAgent.ts:69`).
3. **"Stuck" is measured from the wrong time.** `runAgent` marks an agent `running` without touching
   `last_run_at` (`backend/src/services/aiOrchestrator.ts:197`), but the monitor measures running time from
   `last_run_at` (`agentBehaviorMonitorAgent.ts:34-35`), which is when the previous run finished. So any
   agent that runs less often than every 15 minutes, caught mid-run, is reported stuck at critical
   severity and gets a ticket.
4. **Error spikes on disabled agents show as "Unknown".** The monitor looks up names among enabled agents
   only (`agentBehaviorMonitorAgent.ts:29`, `:68`).
5. **`tools_granted` is descriptive only.** It is free text used to classify autonomy levels, no action
   is checked against it, and the activity log records no tool names, so Ellis does not use it for findings.

## How to run it

```
npm run behavior-watch -- --snapshot examples/behavior-watch.example.json [--hours 24]
```

The example is not production data. It shows an operation outside the grant, a write by a read-only
agent, an autonomy-level denial, an unattributable action, and a verdict that is not emitted. Exit code 0
means no findings, 4 means findings, and 1 means bad input.

## Evidence

- **Named passing tests:** "acceptance: every finding names the specific grant that was missing" and
  "acceptance: a verdict that names no missing grant is not emitted as a finding, and the report says
  why". 12 tests in this file, 62 in the repo, all passing under `npm test`.
- **The tests catch defects:** emitting a finding with an empty grant name fails the second acceptance
  test; removing the operation check fails 3 tests; removing the self-exclusion fails 1 (each checked by
  editing the code, running `npm test`, and restoring it).
- **Not yet run on live records.** K.D. cannot open the agent detail surface
  (`backend/src/routes/admin/aiOpsRoutes.ts:71`); the first live check is one export from A.M.'s
  agent-management admin screen.
