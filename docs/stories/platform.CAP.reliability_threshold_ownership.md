# platform.CAP.reliability_threshold_ownership — Reliability threshold ownership

The numbers that decide when the platform complains — error-rate limits, overdue multipliers, sample sizes, cooldowns — have a named owner who can tune them against real noise, so alerting stays trusted.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today — and these specific numbers are already attributed to his discretion in code, so his confirmation is overdue rather than optional

**Blocked by**
- Changing a threshold changes what wakes a human up; the decision belongs to Kesetebirhan Delele at every rung
- The constants are compiled in, so applying a change requires a deploy, and production_deploy is default-denied (executionPolicy.ts:33-42)
- The observed false-positive rate has never been measured, so no threshold proposal can be evidence-based until it is

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Reliability threshold ownership
**Domain:** Platform Automation & Reliability · **Capability:** `platform.reliability_threshold_ownership`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** manager_defined
## The business outcome
The numbers that decide when the platform complains — error-rate limits, overdue multipliers, sample sizes, cooldowns — have a named owner who can tune them against real noise, so alerting stays trusted.
Intended users: Kesetebirhan Delele.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Alert volume and outcome are measured over a window
- Each threshold is assessed for whether it is producing noise or missing incidents
- A change is proposed with the measured effect it would have had on the observed window
- The owner accepts or rejects, and the decision is recorded next to the constant
**Inputs**
- observed alert volume and false-positive rate
- observed incident detection latency
- the current threshold constants
**Outputs**
- a tuned threshold set with the evidence behind each change
- a recorded owner decision per threshold
**Exceptions that must be handled**
- These thresholds are hardcoded constants across at least five separate services, so tuning one does not tune the others and there is no single place the owner can see them all
- A threshold recorded as somebody's discretion but never actually reviewed by them is an unowned number wearing an owner's name
- Lowering a threshold to catch more incidents also raises noise, and an alerting channel that is ignored detects nothing — the trade cannot be optimised without the observed false-positive rate
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_health_metrics
- read_activity_log
- compose_report_draft
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/cronHealthAlertService.ts
- backend/src/services/reliabilityAlertingService.ts
- backend/src/services/deadLetterService.ts
- backend/src/services/errorSpikeAlertService.ts
**Dependencies**
- platform.cron_health_alerting
- platform.system_health_probe_and_alerting
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R5**.
Why that ceiling: Proposing and simulating a threshold change is analysis the agent can do well, and shadow replay against an observed window is exactly the evidence the decision needs. Setting the number stays with the named owner, and autonomyLadder.ts:170-176 caps a human-decision capability at autonomy:R5.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Reports every reliability threshold in force, where it lives, and what it is currently producing.

Acceptance: Each threshold is reported with its source file and line; a threshold whose alert outcomes were never recorded is reported as unmeasured rather than as well-tuned.
## Before you start
- Changing a threshold changes what wakes a human up; the decision belongs to Kesetebirhan Delele at every rung
- The constants are compiled in, so applying a change requires a deploy, and production_deploy is default-denied (executionPolicy.ts:33-42)
- The observed false-positive rate has never been measured, so no threshold proposal can be evidence-based until it is
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/cronHealthAlertService.ts:44-45 'Starting defaults per Ali's decision on BC #10095928858 comment 2026-07-15 — Kes's discretion, tuned conservatively to avoid noise.'
- backend/src/services/cronHealthAlertService.ts:47-52 RECENT_RUN_SAMPLE_SIZE 10, MIN_SAMPLE_SIZE 5, ERROR_RATE_WARNING_PERCENT 50, ERROR_RATE_CRITICAL_PERCENT 80, MISSED_RUN_WARNING_MULTIPLIER 2, MISSED_RUN_CRITICAL_MULTIPLIER 4
- backend/src/services/reliabilityAlertingService.ts:17-22 WINDOW_MINUTES 15, MIN_SAMPLE_SIZE 20, ERROR_RATE_THRESHOLD_PCT 25, COOLDOWN_MS two hours
- backend/src/services/deadLetterService.ts:17 MAX_CONSECUTIVE_FAILURES = 3
- backend/src/services/schedulerService.ts:3281-3289 two-hour health alert cooldown
- backend/src/routes/admin/cbSystemRoutes.ts:39 EXPECTED_TICKS_24H = 480, :185-186 red and yellow thresholds

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Each threshold is reported with its source file and line; a threshold whose alert outcomes were never recorded is reported as unmeasured rather than as well-tuned.

When every box above is ticked, stop and show the demo.
