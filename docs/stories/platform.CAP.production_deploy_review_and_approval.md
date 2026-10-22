# platform.CAP.production_deploy_review_and_approval — Production deploy review and approval

Changes reach production through a human who architects, reviews, approves and deploys them, so the platform's release path has a named owner and no automated bypass.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- production_deploy is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy no_provider — no DeploymentProvider is implemented); a human performs every deploy
- push_to_protected_main is default-denied (executionPolicy.ts:33-42, enforcedBy branch_protection); a human merges
- Marked partial because the deploy and preflight tooling exists and is strong, while the review and approval half is recorded only in a role brief rather than as a verifiable gate

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Production deploy review and approval
**Domain:** Platform Automation & Reliability · **Capability:** `platform.production_deploy_review_and_approval`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** manager_defined
## The business outcome
Changes reach production through a human who architects, reviews, approves and deploys them, so the platform's release path has a named owner and no automated bypass.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- Preflight asserts a clean tree and that HEAD matches origin/main
- The change is reviewed and approved by the named human
- The deploy script takes an exclusive lock, deploys, and proves the container is actually running
- The release is verified live rather than inferred from the command's exit code
**Inputs**
- a change on a branch
- the preflight result
- a review decision
**Outputs**
- an approved and merged change
- a deployed release with a running-container proof
- a recorded approval
**Exceptions that must be handled**
- A green deploy command is not a green release — the tooling exists because nginx once served 200 while the backend container had never started
- A dirty working tree silently ships stale code, which is why preflight refuses rather than warns
- Two concurrent deploys race, so the lock is load-bearing and not a convenience
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- run_sandbox_job
- read_approval_records
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- scripts/deploy-prod.sh
- scripts/prod-preflight.sh
- backend/src/services/delivery/execution/executionPolicy.ts
**Dependencies**
- platform.deploy_verification_evidence
- platform.execution_policy_enforcement
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R1**.
Why that ceiling: Both halves of this capability name a default-denied capability: merging is push_to_protected_main and releasing is production_deploy. No autonomy rung can grant either, so the honest ceiling is preparing the change in isolation with its tests. R1 is where this stops, permanently.

**THIS IS A HUMAN DECISION.** It stays human-required at every autonomy level, forever. An
agent may prepare, summarise and propose; it may never decide. No amount of evidence
promotes this into automation.
**First release behaviour (autonomy:R1)**
Prepares the change in isolation with fixtures and baseline tests, and reports preflight readiness without acting on it.

Acceptance: The readiness report states tree cleanliness and whether HEAD matches origin/main as measured facts; it never merges, pushes to main or deploys, and a test asserts no deploy tool is among its grants.
## Before you start
- production_deploy is default-denied (backend/src/services/delivery/execution/executionPolicy.ts:33-42, enforcedBy no_provider — no DeploymentProvider is implemented); a human performs every deploy
- push_to_protected_main is default-denied (executionPolicy.ts:33-42, enforcedBy branch_protection); a human merges
- Marked partial because the deploy and preflight tooling exists and is strong, while the review and approval half is recorded only in a role brief rather than as a verifiable gate
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- docs/training-program-2026-q3/launch-briefs/10-kes-ai-systems.md:3 'You are: Kes Delele, AI Systems Architect. You own enterprise.colaberry.ai (the student platform + ops console), plus every AI agent that ships into prod. CB User is your execution arm — Claude Code drives all the AI-tier tasks; you architect, review, approve, deploy.'
- MERGE_WORKFLOW.md:8 'Kes (KesetebirhanDelele, Write access): builds features, merges his own PRs'
- scripts/deploy-prod.sh — exclusive flock plus a post-deploy running-container proof; rationale at :3-29 records the 2026-08-28 incident where nginx served 200 while the backend container sat in Created; registry-image and SHA match at :201; health poll at :289
- scripts/prod-preflight.sh:10-17 modified-tracked-files check, :18-22 HEAD must equal origin/main
- backend/src/services/delivery/execution/executionPolicy.ts:33-42 production_deploy and push_to_protected_main are both default-denied; :103 PROTECTED_BRANCH = 'main'

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] The readiness report states tree cleanliness and whether HEAD matches origin/main as measured facts; it never merges, pushes to main or deploys, and a test asserts no deploy tool is among its grants.

When every box above is ticked, stop and show the demo.
