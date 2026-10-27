# Runtime threat and access-control watch

**Story:** `platform.CAP.runtime_threat_and_access_watch` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/runtimeThreatAccessWatch.ts`, `src/access/` · **Tests:** `test/runtimeThreatAccessWatch.test.ts`

Ellis answers **"who holds which admin section today, and what changed since the last sweep?"** It is
detection only: changing anyone's access is a privilege grant, and Ellis never grants, removes or
creates access.

Platform facts cite the public Colaberry platform repository at upstream commit `13cb098`. Where a finding has since been fixed upstream (PR 3410, merged as `3ffea7c`), the fix is cited at that commit.

## Why Ellis works this out itself

The platform has no record that answers the question. Its AccessControlGuardianAgent never reads
anyone's access: it scans route source code for a missing `requireAdmin`, and in production it skips,
because the image has no source tree (`backend/src/services/agents/security/accessControlGuardianAgent.ts:49-73`).
So Ellis builds the answer from the records that decide access:

| Record | What it decides |
|---|---|
| `admin_users` | An admin login and its role. Legacy `admin`/`super_admin` reach every section, `sales` reaches `leads`, anything else none (`backend/src/middlewares/authMiddleware.ts:40-45`) |
| `community_members.mgmt_role` | A staff management role, reached through the staff bridge without any `admin_users` row. Only counts for a `staff` member (`backend/src/services/access/mgmtBridgeService.ts:26`); each role's sections are in `mgmtRoles.ts:64-162` |
| `org_members` | People expected to have access. One with no login and no role is the known manager-access gap |
| `audit_logs` | Changes to management roles, with who made them and when |

The role-to-section rules are pinned in `src/access/sectionMap.ts` with the commit they came from.
A test checks them against the platform's own RBAC test (`mgmtRbac.test.ts:30-34`).

## The four statuses, and why they differ

| Status | Meaning | Remedy |
|---|---|---|
| `no_admin_users_row` | Cannot sign in to admin at all | A person decides whether to create a login. Ellis never does |
| `admin_users_row_no_sections` | Can sign in, reaches nothing | A person changes the login's role or grants a management role |
| `bridge_only` | No admin login, but reaches sections through a management role | Review whether the role is intended |
| `has_sections` | Reaches sections through an admin login | None, unless the sections are wrong |

An org member with neither a login nor a role is labelled "the known manager-access gap, not drift".

**What changed since the last sweep** compares this sweep with the previous one, which `--save` keeps.
It reports identities added or removed, sections gained or lost, and status changes, plus the audit rows
that changed a management role. With no previous sweep, it says what changed is unknown, not "nothing".

## What the code showed

1. **A scoped role can raise itself to owner.** The route that sets management roles is guarded by
   `requireAdmin` only (`backend/src/routes/admin/communityMemberRoutes.ts:93`). For staff tokens, the
   section gate maps `/api/admin/community` to `program` (`backend/src/middlewares/mgmtSectionGate.ts:100`).
   So the `curriculum` and `admin` roles, which hold `program`, can set any staff member's role, their
   own included, to `owner`, the only role that reaches `inbox_content`. Found by reading the code, not
   tested live. Ellis flags every scoped role holding `program`. Tested.
   **Fixed upstream in `3ffea7c`:** the route now refuses to grant a role with more access than the
   caller's own, or to change the role of someone who holds more (`communityMemberRoutes.ts:117-129`,
   `backend/src/services/access/mgmtRoleGrant.ts:75-93`). Ellis still flags these roles, because a
   grant made before the fix stays in place.
2. **Removing a role does not remove access at once.** A staff admin token lasts 12 hours
   (`mgmtBridgeService.ts:92`), and the gate reads the role from the token, not the database
   (`mgmtSectionGate.ts:250`). Removing a role leaves the old sections working until the token expires.
   Still open upstream at `3ffea7c`.
3. **A role left on a non-staff member is dormant, not gone.** The role is checked against `staff` only
   when it is used (`mgmtBridgeService.ts:26`). Ellis reports it, because making the member staff again
   brings the access straight back. Tested.
4. **New admin logins leave no audit trail.** `admin_users` rows are created by `createAdminUser`
   (`backend/src/services/adminService.ts:78`), which only the seed script calls
   (`backend/src/seeds/seedAdmin.ts:19`), outside the audited admin routes. And audited changes record
   only the new value; `old_values` is always null (`backend/src/middlewares/auditMiddleware.ts:82`).
   This is why Ellis compares whole sweeps rather than relying on the audit log. Still open upstream
   at `3ffea7c`.
5. **The runtime monitor does not read auth signals.** It counts page events per visitor and failed
   agent runs (`runtimeThreatMonitorAgent.ts:26`, `:46`). Auth failures go only to the console
   (`backend/src/middlewares/authFailureLog.ts:74`), so a burst of failed admin logins is not one of its
   inputs.

Not in this release: runtime threat alerts and expiry for temporary grants (the platform has no expiry
field on either kind of access).

## How to run it

```
npm run access-watch -- --snapshot examples/access-watch.example.json --save /tmp/sweep.json
npm run access-watch -- --snapshot <later export> --previous /tmp/sweep.json
```

The example is not production data. A snapshot that carries a credential column such as
`password_hash` is refused, so it is never read or repeated.

## Evidence

- **Named passing test:** "acceptance: 'no admin_users row' and 'admin_users row with no sections' are
  different answers with different remedies". 11 tests in this file, 50 in the repo, all passing under `npm test`.
- **The tests catch defects:** merging the two statuses fails the acceptance test; removing the staff-only
  rule fails the dormant-role test (each checked by editing the code, running `npm test`, and restoring it).
- **Not yet run on live records.** K.D. cannot reach the surface that reports access
  (`backend/src/routes/admin/aiOpsRoutes.ts:64`); the first live check is one export from A.M.'s
  agent-management admin screen.
