# Orchestration auto-repair

**Story:** `platform.CAP.orchestration_auto_repair` · **Autonomy:** starts R0, first release R4, ceiling R6 · **Approver:** K.D.
**Code:** `src/capabilities/orchestrationAutoRepair.ts`, `src/sandbox/sandboxStore.ts` · **Tests:** `test/orchestrationAutoRepair.test.ts`

The platform's OrchestrationAutoRepairAgent fixes two known kinds of breakage in course content every
five minutes: it switches back on a prompt that lessons still use, and it clears a link to a prompt
that no longer exists. Ellis runs the same repair sequence **against a sandbox fixture only** and
proves the property that matters most for anything on a timer: **running the same repair twice
changes things once, and the second run reports no-op.**

Platform facts cite the public Colaberry platform repository at commit `c99021d`; the repair agent and
the counter below are unchanged at upstream `13cb098`.

## What it does

1. **Plan** from the fixture's current state. Each fault becomes a change, a no-op (already repaired,
   or no longer broken), or "left alone" (outside the authorized set, or outside the detector's scope).
   Duplicate signals for the same row and column collapse into one change and are reported.
2. **Apply** at most `maxRepairs` changes (default 10; 0 means none). The rest are reported as deferred.
3. **Verify** each applied change by reading the row back. A write that fails mid-run is reported as
   `partial` with its error class; the next run re-plans from state and finishes without doubling.

The sandbox keeps a journal of every write, so "one change, not two" is counted, not inferred. It also
refuses a write that would not change the value. Only a `SandboxStore` can be repaired; there is no
production target.

## The authorized repair set

The platform's constant `SAFE_REPAIR_TYPES` (`backend/src/services/agents/orchestrationAutoRepairAgent.ts:8-11`):

| Fault event | Repair | Columns allowed |
|---|---|---|
| `inactive_prompt_referenced` | Switch the prompt back on | `prompt_templates.is_active` |
| `broken_prompt_fk` | Clear the broken link on active mini-sections | the three prompt FKs on `mini_sections` (`:87-91`) |
| `broken_artifact_prompt_fk` | Clear the broken link on artifact definitions | `instruction_prompt_id`, `auto_generate_prompt_id` (`:135`) |

Any other fault, or a column outside these lists, is left alone and reported. The set is written down
in code; what is missing is a record that K.D. approved it. Until K.D. confirms it, Ellis treats it as
the platform's set, not an approved one.

## What the code showed, and how Ellis handles it

1. **The "Repairs Today" counter never counts this agent's repairs.** The AI Ops overview counts
   activity rows whose action contains "repair" (`backend/src/services/aiOpsService.ts:33-38`). This
   agent logs `reactivate_prompt`, `null_broken_fk` and `null_broken_artifact_fk`
   (`orchestrationAutoRepairAgent.ts:60`, `:108`, `:152`). Ellis's action names all contain "repair". Tested.
2. **It undoes a person's decision.** If someone switches a prompt off on purpose while an active lesson
   still uses it, the prompt monitor flags it within a minute (`promptMonitorAgent.ts:59-63`) and the
   repair switches it back on at the next five-minute tick (`orchestrationAutoRepairAgent.ts:54`). Ellis
   does the same in the sandbox, because it is in the platform's set, but this needs K.D.'s decision
   before any production pilot.
3. **The repair reaches rows the detector never flagged.** The detector checks only active
   mini-sections (`promptMonitorAgent.ts:39`); the repair clears the link on every mini-section
   (`orchestrationAutoRepairAgent.ts:95`). Ellis repairs only rows in the detector's scope. Tested.
4. **A cap of 0 becomes 10.** `config.max_repairs_per_run || 10` (`orchestrationAutoRepairAgent.ts:20`).
   In Ellis, 0 means no repairs. Tested.
5. **Replay safety is real but unstated.** Each platform repair re-reads current state before writing
   (`:51`, `:94-97`), so a second tick finds nothing to do. Nothing asserts it, and the five-minute run
   re-reads ten minutes of signals (`:25`), so every fault is seen at least twice. Ellis's tests assert it.

## How to run it

```
npm run orchestration-repair -- --fixture examples/orchestration-repair.fixture.json --runs 2
```

The example fixture is not production data. It seeds one fault of each authorized kind, a duplicate
signal, an inactive mini-section, a disallowed column and a fault type outside the set. Expected: run 1
makes 4 changes, run 2 is a no-op, `total_changes` is 4.

## Evidence

- **Named passing test:** "acceptance: the same repair twice on the same fixture leaves one change, and
  the second run reports no-op", plus the same check on the seeded demo fixture (4 changes, then no-op,
  journal 4). 12 tests in this file, 26 in the repo, all passing under `npm test`.
- **The tests catch defects:** removing the "already active" check fails 4 tests, including both
  acceptance tests; removing the active-row scope fails 4 tests (checked by editing the code, running
  `npm test`, and restoring it).
- **Scope:** sandbox only. A production pilot is R6 and needs its own approval (`autonomyLadder.ts:204`; the brief cites `:156-159`, which is stale).
