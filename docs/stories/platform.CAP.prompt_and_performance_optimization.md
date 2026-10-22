# platform.CAP.prompt_and_performance_optimization — Prompt and performance optimisation loop

Agent prompts and runtime performance are monitored and tuned on a continuous loop so output quality and cost improve without a human rewriting prompts by hand.

**Built today:** implemented. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Shipping a prompt change requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider) and a human performs it
- Kesetebirhan Delele must state the quality bar a proposed prompt change has to clear, since 'better' is currently undefined for this loop

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Prompt and performance optimisation loop
**Domain:** Platform Automation & Reliability · **Capability:** `platform.prompt_and_performance_optimization`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** implemented · **Source:** inherited
## The business outcome
Agent prompts and runtime performance are monitored and tuned on a continuous loop so output quality and cost improve without a human rewriting prompts by hand.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- PromptMonitorAgent samples prompt behaviour every minute; MetaAgentLoop runs hourly at 2 past
- Inside the loop, the performance step measures cost and latency and the optimisation step proposes prompt changes
- Proposals are recorded against the prompt they target
- The loop's own run is tracked under the MetaAgentLoop name, not under the two internal step names
**Inputs**
- prompt versions and outputs
- latency and token cost per run
- quality signals
**Outputs**
- prompt change proposals
- performance findings
- meta-loop run record
**Exceptions that must be handled**
- PerformanceAgent and PromptOptimizationAgent are not independently schedulable or callable — a capability matrix that treated them as standalone agents would create two employees that cannot be run
- A prompt change that ships without a before-and-after measurement is a guess; the measurement is the deliverable, not the change
- A one-minute monitor cadence on a prompt that changes weekly is cost with no information gain
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_activity_log
- read_health_metrics
- compose_report_draft
- write_sandbox_fixture
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/activity
**Source modules**
- backend/src/services/aiOpsScheduler.ts
- backend/src/intelligence/meta/metaAgentLoop.ts
- backend/src/intelligence/meta/performanceAgent.ts
- backend/src/intelligence/meta/promptOptimizationAgent.ts
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: A shipped prompt is production behaviour for every agent that uses it, and CLAUDE.md treats prompts that ship as code. Adopting a prompt change is therefore human-decided, and autonomyLadder.ts:170-176 caps a human-decision capability at autonomy:R5.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Answers 'which prompts cost the most, which are slowest, and which have open change proposals' from recorded runs.

Acceptance: Every cost or latency figure traces to recorded runs; a prompt with no recorded runs reports unknown rather than zero.
## Before you start
- Shipping a prompt change requires a deploy; production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider) and a human performs it
- Kesetebirhan Delele must state the quality bar a proposed prompt change has to clear, since 'better' is currently undefined for this loop
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/aiOpsScheduler.ts:203 PromptMonitorAgent '*/1 * * * *'
- backend/src/services/aiOpsScheduler.ts:224 { agentName: 'MetaAgentLoop', hardcodedSchedule: '2 * * * *', runner: () => trackAgentRun('MetaAgentLoop', runMetaAgentLoop) }
- backend/src/intelligence/meta/performanceAgent.ts and backend/src/intelligence/meta/promptOptimizationAgent.ts both exist on disk (verified 2026-10-09)
- backend/src/services/agentRegistrySeed.ts:675 PerformanceAgent, :695 PromptOptimizationAgent — legacy slice cited :662 and :682, both stale

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Every cost or latency figure traces to recorded runs; a prompt with no recorded runs reports unknown rather than zero.

When every box above is ticked, stop and show the demo.
