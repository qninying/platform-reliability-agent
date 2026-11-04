# Manager access

**Stories:** `platform.CAP.manager_scoped_authorization`, with `platform.CAP.manager_reachable_agent_surface` and
`platform.CAP.manager_restriction_directives` merged into it (A.M.'s ruling of 2026-11-04) · **Autonomy:** starts
R0, first release R2, ceiling R2 · **Approver:** K.D.
**Code:** `src/capabilities/managerAccess.ts`, `src/cli/managerAccess.ts` · **Tests:** `test/managerAccess.test.ts`

Ellis answers, for one agent: **who may act on it and by which route, can its accountable manager reach it, and
which directives actually take effect?** It is read-only. Granting a login, a management role or a manager is a
human decision at every autonomy level.

Platform facts cite the public Colaberry platform repository at upstream commit `cc1ebc5`.

## How the platform decides

1. **Two routes to an admin token.** A legacy `admin_users` login carries its row's role. A staff member with a
   management role gets a token minted from their enrollment email: `super_admin` for the owner role, `admin`
   otherwise (`services/access/mgmtBridgeService.ts:97-112`).
2. **The agent's own pages check the reporting chain.** `requireAgentManagerOrAdmin`
   (`middlewares/agentManagerAuthMiddleware.ts:50-91`), on 32 routes, lets a `super_admin` through. Anyone else
   needs an `org_members` row under the token's email, and the agent in that person's downstream: the agents
   reporting to them, then the agents reporting to those, up to 5 levels
   (`services/workforce/orgChartHierarchyService.ts:90`, `:110-141`). It walks agents only, so a person above the
   manager in the human chart does not pass.
3. **The join is by email.** One person with two addresses is two people to the gate.

## What it reports

| Part | Answer |
|---|---|
| May act | each login that passes, by route, and why: super admin, or the agent is in their downstream |
| Refused | each login that reaches the admin surface but not this agent's pages, and why |
| Accountable manager | the `org_members` row the agent reports to and, as a separate fact, whether any login carries that row's email |
| Directives | each directive on the agent: injected into a prompt, recorded but enforced nowhere, or revoked |

## What the code showed

1. **Directives are enforced for two agents only.** The `manager_directives` table and its routes exist. The only
   runtime reader adds active directive text to a prompt (`agentBlueprint/agentSystemPrompt.ts:21-32`), and only
   Dara's and Reese's prompt builders trigger it. For every other agent, Ellis included, a directive is recorded
   but enforced nowhere. Even where it is read, it is text in a prompt, not a mechanical limit, and a failed
   lookup drops it.
2. **A builder cannot open the agent they build.** The agent reports to its manager, not its builder, so the
   builder's login is refused with "This agent is not in your reporting chain." A.M. is deciding whether that is
   intended.
3. **A manager whose org record carries another address is refused too.** The gate looks for an `org_members` row
   under the token's email. A.M. confirmed on 2026-11-04 that the platform domain's manager record carries a
   different address from the one their management role signs in with, and is correcting the record.

## The stories' acceptance lines

- **Reachable surface:** the `org_members` row and the login are two separate facts, and the surface is never
  claimed reachable when no login carries the recorded email. Met.
- **Directives:** a directive with no runtime enforcement path is reported as recorded but unenforced. Met.
- **Scoped authorization:** the plan's original line expected the answer for the platform manager to be "nobody,
  via no route, because he holds no admin_users row". Super admins always pass the gate, so "nobody" was false by
  construction, and the no-admin-login fact under it was stale. A.M. accepted a replacement on 2026-11-04: "The
  answer names each login that may act on the agent and by which route, and says separately when the accountable
  manager has none." Met.

Whether a directive should be enforced for every agent, or labelled advisory wherever it appears, is A.M.'s
decision, now a ticket of its own. This check does not take a side: it reports what the runtime does.

## How to run it

```
npm run manager-access -- --snapshot examples/manager-access.example.json --agent PlatformAgent
```

The example has the platform's record shapes with invented ids and example.com addresses. It shows a super admin
who may act, a manager whose login carries a different address from their org record, a builder whose agent
reports to someone else, a directive recorded but enforced nowhere, and a directive Dara's prompt reads.

Exit codes:
- 0: the accountable manager passes the gate and no directive is recorded but unenforced
- 3: otherwise
- 1: bad input

## Evidence

- **Named passing tests:** "acceptance (reachable surface): the org_members row and the missing login are two
  separate facts, and the surface is not claimed reachable", "acceptance (scoped authorization): who may act and by
  which route, and a manager with no route is reported, not papered over", and "acceptance (directives): a
  directive with no runtime enforcement path is recorded-but-unenforced, not in force". 11 tests.
- **The tests catch defects.** Ten deliberate breaks, each caught by a named test: not passing a super admin,
  letting a login with no org record through, skipping the chain check, minting owner as plain admin, dropping the
  depth limit, walking person links as agent links, assuming directives are enforced, counting a revoked
  directive, counting any login as the manager's, and picking one of two rows with the same name.
- **Not yet run on live records.** It needs an export of `ai_agents` (with `reports_to_*`), `org_members`,
  `admin_users`, the staff management grants and `manager_directives`.
