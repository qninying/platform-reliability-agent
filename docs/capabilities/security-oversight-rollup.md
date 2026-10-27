# Security oversight rollup

**Story:** `platform.CAP.security_oversight_rollup` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/securityOversightRollup.ts` · **Tests:** `test/securityOversightRollup.test.ts`

Ellis answers **"is the platform safe right now?"** with one verdict, and lists every security scanner
behind it as clean, dirty or unknown, each with the records it came from.

| Verdict | When |
|---|---|
| green | Every scanner ran inside its interval and reports clean |
| red | At least one scanner reports a threat, alert or finding |
| unknown | No scanner is dirty, but at least one cannot be checked |

The rollup is never green while any contribution is unknown. Whenever any contribution is unknown, the
report sets `escalate`, even when the verdict is red, because the silent scanners might add more.

Platform facts cite the public Colaberry platform repository at upstream commit `769ff4e`.

## The seven contributions

These are the security director's subordinates, in scheduler order (`backend/src/services/aiOpsScheduler.ts:329-335`):

| Scanner | Runs | Clean or dirty decided by |
|---|---|---|
| SecretDetectionAgent | every 4 hours | security_posture_scan (a scan of 0 files is unknown) |
| CodeSecurityAuditAgent | daily 03:00 | security_posture_scan (a skipped scan is unknown) |
| DependencySecurityAgent | daily 04:00 | security_posture_scan |
| RuntimeThreatMonitorAgent | every 5 minutes | threat or alert events at high or critical severity |
| AccessControlGuardianAgent | daily 05:00 | the same |
| AISafetyMonitorAgent | every 5 minutes | the same |
| AgentBehaviorMonitorAgent | every 10 minutes | the same |

A scanner is **unknown** before any result is read if any of these is true:

- it has no `ai_agents` row, so its timer records no `last_run_at`;
- it has no `last_run_at`;
- it is disabled, paused or in error;
- its last run is older than two of its intervals;
- its latest run failed, or logged success while carrying errors.

## Why Ellis does not reuse the platform's verdict

SecurityDirectorAgent calls a scanner healthy when `status !== 'error' && enabled`
(`backend/src/services/agents/security/securityDirectorAgent.ts:63`). Its verdict is `normal` whenever no
threat or alert arrived in the last ten minutes (`:119-123`). It reads `last_run_at` only to display it
in the summary (`:111`); no health or severity decision uses it. So a
scanner that never ran, or stopped, leaves the platform saying `normal`. This is the same class of
unfalsifiable green that the platform's supervisor audit found
(`docs/architecture/ai-workforce-management/SUPERVISOR_HEALTH_AUDIT_2026-10-06.md`).

Ellis reports the director's latest verdict next to its own. It sets `disagrees` when one is green and
the other is not.

## What the code showed

1. **The platform's rollup can be green over silent scanners.** That is the rule quoted above. The
   admin dashboard uses the same rule for "Fleet Health", and shows 100% when there are no security
   agents at all (`backend/src/routes/admin/securityRoutes.ts:61-62`, and `:24` when the security
   department is missing).
2. **"Active Threats (24h)" covers roughly the last 80 minutes.** It counts threats among only the newest
   50 security events (`securityRoutes.ts:33-40`). Every routine run writes an event: the runtime and
   AI-safety monitors every 5 minutes, the behaviour monitor and the director every 10. That is about
   36 events an hour. A threat from two hours ago shows as 0, in green.
3. **"Scans Today" counts every security event, not scans** (`securityRoutes.ts:41-43`). That includes
   threats, alerts and the director's own 144 summaries a day.
4. **Only three critical threats per run get a ticket.** The rest are never looked at again, because
   the next run reads only the next ten minutes (`securityDirectorAgent.ts:25`, `:78`). For the same
   reason, events from a run that was skipped or late are never read. The `_ticketed` check (`:72`)
   reads a flag that nothing in the codebase sets.

## How to run it

```
npm run security-rollup -- --snapshot examples/security-rollup.example.json
```

The example is not production data. In it, the director says `normal` while the dependency scanner has
never run, the AI-safety monitor is paused, the guardian's last run carried an error, and the runtime
monitor reported a threat after the director's last run. Ellis says red with 3 unknown, escalates, and
flags the disagreement.

Exit codes:
- 0: green
- 3: unknown
- 4: red
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: a scanner with no last_run_at renders as unknown, and the rollup is not green"
  - "acceptance: the rollup is never green while any contribution is unknown, for each contributor in turn"

  There are 14 tests in this file and 76 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - removing the `last_run_at` check fails the first acceptance test;
  - letting unknowns through to green fails 4 tests;
  - ignoring errors on a run logged as success fails 1;
  - treating a disabled scanner as running fails 1.
- **Not yet run on live records.** K.D. cannot open the rollup surfaces (`requireAdmin`,
  `backend/src/routes/admin/aiOpsRoutes.ts:44`). The first live check is one export from A.M.'s admin
  screen.
