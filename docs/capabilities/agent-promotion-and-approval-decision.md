# Agent promotion and approval decision

**Story:** `platform.CAP.agent_promotion_and_approval_decision` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D. to R2, A.M. from R3
**Code:** `src/capabilities/promotionEvidence.ts`, `src/cli/promotionEvidence.ts` · **Tests:** `test/promotionEvidence.test.ts`

This first release assembles the evidence for one capability at one rung and states plainly whether it meets that rung's
acceptance criteria. It grants nothing, records no decision and changes no level. Promotion is a person's decision at every
rung, permanently, and R2 is the ceiling: an agent that could promote itself is not governed.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run promotion-evidence -- --source <platform checkout> --capability <id> --rung autonomy:Rn \
  --environment sandbox|production [--evidence <evidence.json>]
```

Run it from this repository. It reads the rung's criteria from the platform's capability record, and the passed criteria and
tests from `.colaberry/progress.json`. Paths in the evidence file are relative to that file.

Exit code 0 when every criterion cites a run record, 4 for unproven or unmet, 5 when the rung cannot be reached, 1 for bad
input.

## The evidence file

```json
{ "items": [
  { "capability_id": "platform.x", "rung": "autonomy:R2", "criterion": 1,
    "kind": "run_record", "cite": "run.json", "against": "platform_source" }
] }
```

`criterion` is the clause number in the answer. A rung holds one acceptance sentence, split into criteria at semicolons, so a
strong clause cannot carry a weak one.

## How it decides

| Evidence | Effect |
|---|---|
| `run_record` | Meets the criterion. The file must be readable and not a fixture, and its hash is given |
| `named_test`, `mocked_test`, `measured_figure`, `file_line` | Supports it, but proves nothing alone |
| `story_complete`, `elapsed_time`, `conversation`, `auto_approval` | Counts for nothing, and is listed with the reason |

Every test is treated as mocked. A test passing proves the test, not the behaviour on the platform. A named test must exist
in the cited file.

The tests behind a passed criterion are found without being cited, so a capability with tests and no run record reads as
unproven with no evidence file at all.

| Verdict | Means |
|---|---|
| `meets_criteria` | Every criterion cites a run record. A person decides whether that is enough |
| `unproven` | No criterion is empty, and at least one rests on tests or citations alone |
| `unmet` | At least one criterion has no evidence |
| `no_criteria_defined` | The rung has no written criteria, so nothing can meet it |
| `above_ceiling` | The capability stops below this rung, whatever the evidence |
| `rung_needs_production` | R6 and above cannot be reached with sandbox evidence |

## What never carries over

- **Between capabilities.** An item for another capability is listed and ignored. Each answer reads one capability's record,
  and meeting a rung changes no other capability's level or the agent's.
- **Between rungs.** An item for another rung is listed and ignored, and tests for R2 are not evidence for R3.
- **Into production.** A production target counts only runs against production. A run against the sandbox or platform source
  is listed and ignored. Production at R6 or above also flags a separate pilot approval
  (`agentDomain/autonomyLadder.ts:203-205`).

## The decision

`level.changed` is always false, and `decision_recorded` is always false. Where evidence is insufficient the level stays where
it is, and today that is no level: `approved_autonomy` is null on all 48 capabilities. A timeout is not an approval
(`docs/architecture/ai-workforce-management/APPROVAL_DROP_QUEUE_2026-10-06.md:90`).

Each answer names the person who decides: K.D. through R2, A.M. from R3. It also lists what blocks a decision today: this
domain has no agent (`agentDomainRegistry.ts:232`), no level is approved, and K.D. has no surface to record a decision on.

The platform's `recordApprovedAutonomyLevels.js`, added after `bbde6ef`, records decisions for two agents, not capabilities, so
it does not change this.

## Limits, stated in every answer

- Meeting the criteria grants nothing.
- Only a run record proves a criterion, and every test is treated as mocked.
- A run record is read, not re-run. Ellis checks that it exists and is not a fixture, and gives its hash. It cannot tell that
  the run was genuine or that it covers the criterion. That call is the reviewer's.
- Criteria are split at semicolons.
- The approved level comes from the commit read, not the running system.
- A passing rung says nothing about any other capability or about the agent overall.

## Evidence

- **Acceptance:** `the assembly cites real run records and names any criterion with no evidence as unmet` and
  `a capability whose only evidence is a passing mocked test is reported as unproven` in `test/promotionEvidence.test.ts`.
  27 tests.
- **Each rule can fail:** 49 of 49 deliberate breaks were caught, after five that survived the first valid pass led to
  stronger tests. One further break changed no behaviour, so that line was removed.
- **On the real records:** run at `bbde6ef` for all 48 capabilities at their first rung, 34 built capabilities came back
  `unproven` and 14 unbuilt ones `unmet`. None met its rung, because no run record was cited.
- **With a real run record:** the saved output of the threshold report at `bbde6ef`, cited against the first clause of
  `platform.reliability_threshold_ownership` at R2, moved that clause to `met` and left the second `unproven`. The verdict
  stayed `unproven`, exit 4. The same record against production was refused. A cited story completion and a cited timeout
  counted for nothing.
- **Not done:** neither dependency is built (`capability_autonomy_authority_resolution`, and
  `manager_reachable_agent_surface`, which is held). No surface exists to record a decision, and no real promotion has been
  reviewed. K.D. evaluates this evidence, and nothing here is validated yet.
