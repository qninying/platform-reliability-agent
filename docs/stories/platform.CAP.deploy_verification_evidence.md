# platform.CAP.deploy_verification_evidence — Deploy verification evidence

Every release is proven live from the running system rather than inferred from a command's exit code, so a deploy that appeared to succeed and did not is caught at the moment it happens.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider); a human runs the deploy and the verification that accompanies it
- Reading the running container's state requires production host access, which a run never holds under runner isolation
- Marked partial because the deploy script already proves the container is running, while nothing stores that proof as a reviewable per-release record

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Deploy verification evidence
**Domain:** Platform Automation & Reliability · **Capability:** `platform.deploy_verification_evidence`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** proposed_new
## The business outcome
Every release is proven live from the running system rather than inferred from a command's exit code, so a deploy that appeared to succeed and did not is caught at the moment it happens.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Record the commit intended for release and the preflight result
- After the deploy, read the running container's image and state from the host
- Probe the live routes the release was supposed to change
- Store the evidence against the release, and fail loudly where intent and reality disagree
**Inputs**
- the deployed commit SHA
- the running container's image and state
- post-deploy health and route responses
**Outputs**
- a per-release evidence record: SHA deployed, containers running, routes answering
- a failed-verification signal when the evidence does not match the intent
**Exceptions that must be handled**
- A 200 from the edge proves the edge is up, not that the application behind it started — the incident that motivated the existing script is exactly this
- A dirty working tree ships stale code while reporting success, so tree state is part of the evidence rather than a precondition that can be assumed
- Two concurrent deploys race, so an evidence record without a deploy lock is evidence about an indeterminate state
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_deploy_log
- read_health_metrics
- compose_report_draft
**Application surfaces**
- GET /health
- GET /health/full
**Source modules**
- scripts/deploy-prod.sh
- scripts/prod-preflight.sh
- scripts/systemHealthCheck.js
**Dependencies**
- platform.production_deploy_review_and_approval
- platform.system_health_probe_and_alerting
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R2**.
Why that ceiling: Verification is reading, but everything it reads sits behind production access. The agent's ceiling is assembling and judging evidence a human or the deploy script collected; it never performs the deploy and never reaches the host itself.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R2)**
Judges a release's evidence and states whether the deployed SHA, the running image and the live routes agree.

Acceptance: A release whose evidence is missing any of the three is reported as unverified, never as deployed; and an edge-level 200 alone is never accepted as proof the application started.
## Before you start
- production_deploy is default-denied (executionPolicy.ts:33-42, enforcedBy no_provider); a human runs the deploy and the verification that accompanies it
- Reading the running container's state requires production host access, which a run never holds under runner isolation
- Marked partial because the deploy script already proves the container is running, while nothing stores that proof as a reviewable per-release record
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- scripts/deploy-prod.sh:3-29 the rationale records the 2026-08-28 incident where nginx served 200 while the backend container sat in Created
- scripts/deploy-prod.sh:201 registry image and SHA match check
- scripts/deploy-prod.sh:289 health poll via docker exec against the in-container health endpoint, with the 'looks done and 502s' note at :282
- scripts/prod-preflight.sh:10-17 modified-tracked-files check; :18-22 HEAD must equal origin/main
- scripts/systemHealthCheck.js — a re-runnable end-to-end production audit that writes a dated report
- CLAUDE.md Production Readiness Principles: 'Build / release / run separation... Code changes do not patch a running container.'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] A release whose evidence is missing any of the three is reported as unverified, never as deployed; and an edge-level 200 alone is never accepted as proof the application started.

When every box above is ticked, stop and show the demo.
