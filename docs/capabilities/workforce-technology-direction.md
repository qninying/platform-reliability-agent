# Workforce technology direction

**Story:** `platform.CAP.workforce_technology_direction` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/workforceTechnologyDirection.ts` · **Tests:** `test/workforceTechnologyDirection.test.ts`

Ellis answers **"what tooling does the fleet hold, and where does it diverge from the intended direction?"**

**Setting the direction is a human decision at every autonomy level.** Ellis lists and compares. It never
decides, and a change of AI model class is reported as an escalation for a named person, never as an action.

Platform facts cite the public Colaberry platform repository at upstream commit `7c70f0a`.

## How the answer is decided

**Divergence is only measured against a written, approved direction.** If none is on file, the answer is
`unknown`, never "no divergence". The same applies when the direction:
- has no recorded approval;
- is dated after the snapshot;
- states no rules.

Even then, Ellis still lists every enabled agent's tooling, so a person has something to write a direction
against.

A direction is a short list of rules:

| Rule | What diverges |
|---|---|
| `allowed_tools` | an agent holds a tool outside the list |
| `denied_tools` | an agent holds a tool on the list |
| `max_tier` | an agent's declared permission tier is above the maximum |
| `allowed_models` | the fleet uses a model outside the list (an escalation, not an action) |

**Tooling that is not recorded is never read as compliant.**
- An agent with no tool record reads `not_recorded`.
- So does an empty tool list, because the column defaults to `[]` (`backend/src/models/AiAgent.ts:480-484`):
  in production, empty means nobody filled it in.
- Model rules need an export of model use in code. Without one, model use is unknown.

The overall verdict is `divergent` if anything diverges, then `unknown` if anything could not be checked,
and only then `no_divergence`. A divergent answer also says how much of the fleet could not be checked.

## What the code showed

1. **The Technology Director does not review technology direction.** It finds the one enabled agent with the
   highest error count and flags it as a task (`backend/src/services/workforce/directorActions.ts:80-116`).
   Its registry row says so (`backend/src/services/agentRegistrySeed.ts:2324`). It reads no tooling
   inventory, grant records or workforce intelligence output, which are the brief's inputs. The capability
   the brief describes is not built.
2. **"Unhealthy" means five or more errors, ever.** `error_count` is a lifetime total
   (`backend/src/services/aiOrchestrator.ts:242`, `backend/src/services/cronInstrumentation.ts:81`). In normal
   running nothing resets it: the only resets are a manual boot script (`backend/src/scripts/coryProductionBoot.ts:315`)
   and an executor action that cannot fire today. So:
   - an agent that failed five times months ago is still "unhealthy";
   - agents that run often rank first;
   - when a person closes the task, the same agent is flagged again within 15 minutes, with a new ticket
     (`workforceAgentRuntime.ts:187`).
3. **One open task hides every other unhealthy agent.** The director takes only the top agent (`:84-88`). If
   that agent already has an open task, the run stops as `already_flagged` (`workforceAgentRuntime.ts:155-158`)
   instead of moving to the next one.
4. **Most of the fleet's tooling is not recorded.**
   - Of 242 seeded agents, 31 set `tools_granted`.
   - 36 appear in the grant map. Any other agent gets a default `suggest_only` grant
     (`backend/src/services/agentPermissionService.ts:102-116`), and the map is not enforced. So a tier is
     what is declared, not what the agent can do.
   - No agent records the model it uses. Models are chosen in code; `gpt-4o-mini` and `gpt-4o` are the
     two most common.
5. **No written direction exists.** A search of the whole platform repository for a technology direction,
   an approved model list or a model policy found none. So today the honest answer is `unknown`.
6. **Four runs an hour is a cadence with nothing to match.** The run makes no model call, so each costs only
   a few queries. But the work it does (finding 2) does not change every 15 minutes, and direction would
   change even less often.

Severity, in A.M.'s terms: findings 2 and 3 are reporting gaps (wrong or missing flags, no runtime
damage). Finding 1 means the capability exists in name only. Findings 4 and 5 are why Ellis's answer is
`unknown` today.

## How to run it

```
npm run technology-direction -- --snapshot examples/technology-direction.example.json
```

The example is not production data. Agent names, tools and tiers come from the platform seed and grant map:
- with no direction on file, the answer is `unknown` (exit 3);
- `examples/technology-direction.with-direction.example.json` adds an illustrative direction, not an
  approved one. Two agents diverge, two cannot be checked, and `gpt-4o` is raised as an escalation (exit 4).

Exit codes:
- 0: no divergence
- 3: unknown
- 4: something diverges
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: with no written direction on file, the answer is 'unknown', not 'no divergence'"
  - "acceptance: divergence is reported against a written intended direction"

  There are 11 tests in this file and 171 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - reading no direction as no divergence fails 2;
  - counting an empty tool list as recorded fails 1;
  - ignoring an agent with no tool record fails 1;
  - accepting an unapproved direction fails 1;
  - trusting a direction dated in the future fails 1;
  - accepting a direction with no rules fails 1;
  - not escalating a model divergence fails 1;
  - ignoring a missing model export fails 1;
  - including disabled agents fails 1;
  - treating a tier at the maximum as above it fails 2;
  - giving an unlisted agent the wrong default tier fails 1;
  - inverting the ruled-out tools fails 2;
  - leaving agents unsorted fails 2;
  - dropping the direction's citation fails 1.
- **Not yet run on live records.** K.D. cannot open the registry surface (`backend/src/routes/admin/aiOpsRoutes.ts:70`).
  The first live check needs a written direction from K.D., one export of `ai_agents`, and one export of
  model use in code.
