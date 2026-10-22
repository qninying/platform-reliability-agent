# platform.CAP.reliability_briefing_for_manager — Reliability briefing for the accountable manager

The human accountable for platform reliability receives a periodic, evidence-cited briefing on what ran, what failed, what is undetectable and what needs his decision — replacing the manual data pull and write-up an analyst would otherwise do.

**Built today:** absent. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today — and because no DA role document exists in the repository, he must also confirm which reporting responsibilities are actually transitioning

**Blocked by**
- live_email is default-denied (executionPolicy.ts:33-42), so the agent never sends the briefing; the existing briefing service does
- manager_has_no_admin_login: he cannot open the surfaces the briefing would link to, so the briefing must be self-contained until that is resolved
- The DA responsibilities intended to transition are undocumented — the amendment that defines them is not in the repository — so this capability's scope is unknown until Kesetebirhan Delele states it

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Reliability briefing for the accountable manager
**Domain:** Platform Automation & Reliability · **Capability:** `platform.reliability_briefing_for_manager`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** absent · **Source:** proposed_new
## The business outcome
The human accountable for platform reliability receives a periodic, evidence-cited briefing on what ran, what failed, what is undetectable and what needs his decision — replacing the manual data pull and write-up an analyst would otherwise do.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Collect the reliability figures for the period from the instrumentation that recorded them
- Separate what is measured from what is structurally unmeasurable, and say which is which
- Name the decisions waiting on him, each with the evidence needed to decide
- Deliver through the existing briefing path rather than a new channel
**Inputs**
- run counts, failure counts and durations per agent
- alerts raised and their outcomes
- drift and coverage figures
- open decisions awaiting him
**Outputs**
- a periodic briefing with every figure cited to its source
- an explicit list of what could not be measured
- a short list of decisions only he can make
**Exceptions that must be handled**
- A briefing that reports only what is measurable will read as healthier than the platform is, because the untracked timers contribute nothing — the unmeasured section is the most important part of this report
- No figure may be manufactured: a metric with no recorded data is reported as unknown, and a percentage is never produced from an empty evidence list
- The DA responsibilities this is meant to absorb are not documented anywhere in the repository, so the scope here is a proposal and must not be presented as an inherited job description
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_activity_log
- read_cron_run_logs
- compose_report_draft
**Application surfaces**
- /admin/intelligence
- GET /api/admin/ai-ops/overview
- GET /api/admin/ai-ops/health/agents
**Source modules**
- backend/src/services/executiveBriefingService.ts
**Dependencies**
- platform.runtime_cron_drift_detection
- platform.agent_health_scoring
- platform.cron_health_alerting
- platform.manager_reachable_agent_surface
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Composing an evidence-cited report is reading and writing prose over records, and shadow comparison against a briefing a human has already written is the right top rung. Sending it is a live external effect, so delivery stays with the existing deterministic briefing service.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Produces the briefing on request, with every figure cited and an explicit unmeasured section.

Acceptance: No percentage appears without the record count behind it; the unmeasured section names the untracked timers and the phantom crons as present rather than omitting them.
## Before you start
- live_email is default-denied (executionPolicy.ts:33-42), so the agent never sends the briefing; the existing briefing service does
- manager_has_no_admin_login: he cannot open the surfaces the briefing would link to, so the briefing must be self-contained until that is resolved
- The DA responsibilities intended to transition are undocumented — the amendment that defines them is not in the repository — so this capability's scope is unknown until Kesetebirhan Delele states it
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- .loop-architect/runs/20261007-school-agent-factory/execution-contract.md:45-49 'proposed new responsibilities including DA work transitioning to AI'
- .loop-architect/runs/20261007-school-agent-factory/plan.md:634 'study the employee's role and document existing DA responsibilities and their intended transition'
- .loop-architect/runs/20261007-school-agent-factory/execution-contract.md:66-69 the amendment cites CLAUDE_CODE_AGENT_FACTORY_SCOPE_AMENDMENT.md, which is not in the repository and was not attached
- backend/src/services/executiveBriefingService.ts — the existing briefing substrate this would reuse rather than reinvent
- docs/agent-catalog/assistant/data-analyst-agent.md — the only Data Analyst artefact in the repository is a deterministic SQL-result label enricher, not a human role description
- CLAUDE.md Observability Framework names the five metrics every long-running operation must emit: success_rate, failure_rate, retry_count, latency percentiles and volume

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] No percentage appears without the record count behind it; the unmeasured section names the untracked timers and the phantom crons as present rather than omitting them.

When every box above is ticked, stop and show the demo.
