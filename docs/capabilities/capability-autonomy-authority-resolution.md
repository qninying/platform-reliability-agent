# Per-capability autonomy authority resolution

**Story:** `platform.CAP.capability_autonomy_authority_resolution` · **Autonomy:** starts R0, first release R2, ceiling R2 · **Approver:** K.D. to R2, A.M. from R3
**Code:** `src/capabilities/autonomyAuthority.ts`, `src/cli/autonomyAuthority.ts` · **Tests:** `test/autonomyAuthority.test.ts`

This first release answers what a capability's effective authority is today and which constraint is binding. It reads the
recorded approval, ceiling, tool grants and human-decision flag for that capability alone. Absence of approval is not a low
approval: it resolves to null, never a defaulted rung. Today all 48 capabilities resolve to null.

It changes nothing. Granting or raising a level is a recorded human decision, and R2 is the ceiling: an agent that could raise
its own approved level would make the ladder decorative.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run autonomy-authority -- --source <platform checkout> --environment sandbox|production [--capability <id>]
```

Without `--capability` it maps every capability, each resolved alone. Exit code 0 when every capability asked about resolves,
4 when any has no authority, 5 when the rules could not be confirmed against the platform's module, 1 for bad input.

## How it decides

The steps run in the platform's order (`backend/src/services/agentDomain/autonomyLadder.ts:185-223`).

| Step | Rule | Reason recorded |
|---|---|---|
| Approval | Anything but a namespaced stage gives null. A bare `R3`, `observe` or `not_applicable` is not an approval | `no_approved_autonomy` |
| Ceiling | Can only lower the level | `capped_by_max_permitted` |
| Production | At R6 or above it is flagged, not lowered | `production_requires_separate_pilot_approval` |
| Tool grants | None in that environment stops at R2 | `no_tool_grants` |
| Human decision | Stays required at every level, and caps at R5 | `human_decision_required_at_every_level`, `capped_below_automation_because_human_decision` |

`binding_constraint` adds what the platform's function does not say: the step that set the final level. Where several apply,
it is the last one that lowered the level. If nothing lowered it, the constraint is `approved_level`.

## Why a copy, and what keeps it honest

Ellis runs no platform code, so these rules are copied. A copy can fall behind. On every run, Ellis checks that the nine lines
carrying the rules are still in the checkout's `autonomyLadder.ts`. If any is missing, the answer says `unconfirmed`, names the
lines and exits 5.

## One capability at a time

Each capability is resolved alone, with no shared state, so one reaching a high level lifts no other. No figure here describes
an agent overall.

## Limits, stated in every answer

- The approved level and tool grants come from the capability record in the commit read, not the running system.
- Tool grants are the agent tools listed for that environment. Nothing shows a tool was issued.
- This is the ladder only. The R0-R5 delivery risk tiers and `ai_agents.autonomy_level`
  (`backend/src/db/ensureAiAgentAutonomyLevelSchema.ts:39`) are separate, and nothing reconciles them.
- A bare `R3` resolves to no authority rather than being read as `autonomy:R3`.
- A production level at R6 or above is flagged, not lowered, because no record of a pilot approval exists to read.

## Evidence

- **Acceptance:** `a capability with no recorded approval returns null with reason no_approved_autonomy, never a defaulted rung`
  and `a human_decision capability never resolves above autonomy:R5` in `test/autonomyAuthority.test.ts`. 13 tests.
- **Each rule can fail:** 30 of 30 deliberate breaks were caught.
- **On the real source:** run at `bbde6ef` and at upstream `5ec9750`, in sandbox and production at `bbde6ef`, all nine rule lines
  were found and 48 of 48 capabilities resolved to null with `no_approved_autonomy`. 23 of them are human decisions. Exit 4.
- **Not done:** no capability has an approved level, so the ceiling, tool grant and human-decision steps have run only on test
  inputs. The dependency `execution_policy_enforcement` is held. K.D. has not confirmed scope, and nothing here is validated yet.
