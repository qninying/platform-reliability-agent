# Production deploy review and approval

**Story:** `platform.CAP.production_deploy_review_and_approval` · **Autonomy:** starts R0, first release R1, ceiling R1 · **Approver:** K.D.
**Code:** `src/capabilities/deployReadiness.ts`, `src/cli/deployReadiness.ts` · **Tests:** `test/deployReadiness.test.ts`

This release reports preflight readiness as measured facts and acts on none of them. R1 is where this capability stops
for good. Merging is `push_to_protected_main` and releasing is `production_deploy`, both default-denied
(`delivery/execution/executionPolicy.ts:33-42`), and no rung can grant either. People review, approve, merge and deploy.

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run deploy-readiness -- --checkout <git checkout>
```

Exit code 0 when the facts are ready, 3 when they are not, 4 when the remote could not be read, 1 for bad input.

## How it decides

| Readiness | Means |
|---|---|
| `facts_ready` | The tree is clean and HEAD matches `origin/main`. Not an approval, and the answer says so |
| `not_ready` | A tracked file is modified, or HEAD does not match. Each fact is stated |
| `unknown` | The tree is clean, but the remote could not be read |

**The remote is asked directly.** `prod-preflight.sh` compares HEAD with `origin/main` after `git fetch ... || true`
(`scripts/prod-preflight.sh:55`), so a failed fetch leaves an old local ref to compare against, and the check can still
pass. Ellis runs `git ls-remote` instead, which changes nothing locally. A remote it cannot read is `unknown`, never a
match against the local copy. The answer also says whether the local ref is stale.

**Tracked and untracked are kept apart.** A modified or staged tracked file fails the check. Untracked files are
counted but do not, matching preflight (`:44`).

## What stops it acting

- **Grants.** `read_source_tree`, `run_sandbox_job` and `read_approval_records`. A test asserts that none is denied and
  none is a deploy, merge or push tool. Each answer carries the same check.
- **Git commands.** Five exact read commands. Anything else is refused, so push, merge, fetch, commit and reset cannot
  run. A test runs each of them against the runner and confirms the refusal.
- **Reads leave no trace.** `GIT_OPTIONAL_LOCKS=0` stops `git status` refreshing the index. A test confirms the index
  bytes and the local ref are unchanged after a run.
- **The denied list.** A copy of the platform's. Each answer says whether the checkout's own list still matches.

## Who approves

The story quotes the role brief and `MERGE_WORKFLOW.md:8`, which says K.D. merges their own pull requests. The same entry
continues that those go into `staging`, and that K.D. cannot merge to `main`. A.M. is the only person who merges to `main`, and the
gate is one approving review, which an author cannot give themselves (`MERGE_WORKFLOW.md:87-90`). The answer names that
gate and reports approval as `unknown`, because reading the setting needs admin access. Whether this is the owner the
story intends is for K.D. and A.M. to settle.

## Preparing a change in isolation

Capability 16 already does this. `npm run bug-baseline` prepares a baseline test in a sandbox that only reads the
checkout (`src/sandbox/baselineRunner.ts`). This release points to it and does not repeat it.

## Limits, stated in every answer

- These are facts about one checkout at one moment. A person can change either before the deploy starts.
- Facts ready is not approved.
- Untracked files do not fail the check, but a build still copies what is on disk.
- A green deploy command is not a green release. What came up is judged afterwards by
  [deploy verification evidence](deploy-verification-evidence.md).

Not measured, and stated in every answer: another deploy running, root volume use, whether this checkout is the one on
the production host, and whether the change was reviewed.

## Evidence

- **Acceptance:** `tree cleanliness and the HEAD comparison are measured facts, with both commits`, and `no deploy tool,
  and nothing denied, is among its grants` in `test/deployReadiness.test.ts`. 22 tests, all on real git repositories.
- **The trap:** `a stale local ref does not fool it: the remote moved and the local copy did not`.
- **Each rule can fail:** 33 of 33 deliberate breaks were caught, starting from a passing suite. Two survived the first
  pass: one led to a stronger test, and the other showed a redundant check, which was removed.
- **On the real clone:** run on the platform clone, it reported `not_ready`, HEAD does not match, with the remote read
  and the policy list matching. The clone was left unchanged.
- **Not done:** it has never read the production host's checkout, and approval is not read.
