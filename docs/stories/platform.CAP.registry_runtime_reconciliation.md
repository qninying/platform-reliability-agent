# platform.CAP.registry_runtime_reconciliation — Timer registry and agent registry reconciliation

The list of timers that actually fire and the list of agents the dashboard claims are scheduled are compared, so a job that runs untracked and a row that claims to run but does not are both named rather than assumed away.

**Built today:** partial. **Requirement validated:** draft -- Kesetebirhan Delele must confirm scope, exceptions and success measures; he has no admin login today

**Blocked by**
- Marked partial because the comparison exists only at build time — cronRegistryRatchet.ts:8 states plainly that nothing in production compares the two
- Deleting a baseline entry asserts a defect is healed; Kesetebirhan Delele must accept each such assertion

Full build prompt is attached to this story.

**Release:** r2 · r2 (weeks 0–0)
**Owner:** 
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

_No requirement linked._

## How to build it

# Timer registry and agent registry reconciliation
**Domain:** Platform Automation & Reliability · **Capability:** `platform.registry_runtime_reconciliation`
**Accountable human:** Kesetebirhan Delele · **Validation state:** draft
**Built today:** partial · **Source:** existing_application
## The business outcome
The list of timers that actually fire and the list of agents the dashboard claims are scheduled are compared, so a job that runs untracked and a row that claims to run but does not are both named rather than assumed away.
Intended users: Kesetebirhan Delele, Ali Muwwakkil.
## The human-operable process, as it works now
This must be operable by a person before an agent touches it. If a human cannot do it by hand
against the surfaces below, the agent version has nothing to stand on.
**Workflow**
- The source parser collects seed rows, registry entries and real call-site names
- reconcile emits the five drift classes
- The ratchet compares each class against its frozen baseline in both directions
- A new violation fails, and so does a baseline entry that has healed and must now be deleted
**Inputs**
- agentRegistrySeed rows
- SCHEDULE_REGISTRY and DYNAMIC_SCHEDULE_REGISTRY entries
- names observed at real cron call sites
- the frozen baseline
**Outputs**
- five named drift classes
- a pass or fail verdict against the baseline
- a healed-entry report when a listed violation stops violating
**Exceptions that must be handled**
- This runs in jest only. Nothing in production performs the comparison, so drift introduced at runtime by a cron_schedule_configs row or a deploy is not detected until the suite runs
- The baseline is a frozen list of accepted disagreements, so the known phantom and untracked populations pass the suite by design — passing does not mean the drift is gone
- scanAndDiscoverAgents sounds like this capability and is not: it reconciles the seed into the database and never looks at a timer
## The tool interface
**Tools this capability requires** (none is one of the eight default-denied capabilities;
anything that would need one is listed under blockers instead)
- read_source_tree
- read_agent_registry
- run_sandbox_job
**Application surfaces**
_none -- a surface may need building first_
**Source modules**
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts
- backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts
- backend/src/services/__tests__/fixtures/cronRegistrySourceParser.ts
- backend/src/services/__tests__/cronRegistryReconciliation.test.ts
**Dependencies**
- platform.cron_run_instrumentation
## The agent behaviour that uses it
Starting autonomy **autonomy:R0**; ceiling **autonomy:R4**.
Why that ceiling: Reconciliation is pure comparison, and R4 covers running the full multi-step comparison against fixtures and verifying it. Shrinking the baseline means accepting that a known defect is fixed, which is a human judgement, so the ladder stops below R5 for the acceptance half of the job.

Not a human-reserved decision, but promotion is still evidence-based and one step at a time.
**First release behaviour (autonomy:R2)**
Answers 'which timers are untracked, which registry rows are phantom, and which schedules disagree' from the current reconciliation output.

Acceptance: Counts are reported as the reconciler measured them with the measurement date attached; no count is restated from a document.
## Before you start
- Marked partial because the comparison exists only at build time — cronRegistryRatchet.ts:8 states plainly that nothing in production compares the two
- Deleting a baseline entry asserts a defect is healed; Kesetebirhan Delele must accept each such assertion
## Evidence this is done
Cite the real thing: a named passing test, a measured figure with its query, or a file:line.
**None of these count:** this story being marked complete, elapsed time, a conversation that
went well, or a mocked test passing. Kesetebirhan Delele evaluates the evidence, and
nothing here is validated yet.
## Evidence this capability rests on
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:90 reconcile(seedRows, registryRows, registeredNames)
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:8 'Nothing in production compares the two.'
- backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:153 ratchet(observed, baseline) — fails on new violations and on healed baseline entries, so the baseline can only shrink
- backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:31 KNOWN_CRON_SEED_ROWS_WITH_NO_REGISTRATION, :130 KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW, :201 KNOWN_SCHEDULE_DISAGREEMENTS, :213 KNOWN_REGISTERED_ROWS_DENYING_SCHEDULE, :230 KNOWN_DUPLICATE_REGISTRY_NAMES
- backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:196 'WorkforceIntelligence', // runs every 6h; no seed row, so run_count is tracked against nothing
- backend/src/services/__tests__/cronRegistryReconciliation.test.ts
- backend/src/services/aiOpsService.ts:413-426 scanAndDiscoverAgents re-runs seedAgentRegistry and diffs AiAgent.count() — it never inspects the timer registry

## Failure paths you must handle


## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Counts are reported as the reconciler measured them with the measurement date attached; no count is restated from a document.

When every box above is ticked, stop and show the demo.
