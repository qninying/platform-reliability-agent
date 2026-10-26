# Static security posture scanning

**Story:** `platform.CAP.security_posture_scan` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/securityPostureScan.ts` · **Tests:** `test/securityPostureScan.test.ts`

The platform has three security scanners on timers: secret detection every 4 hours, a code security
audit at 03:00 and a dependency audit at 04:00 (`backend/src/services/aiOpsScheduler.ts:329-331`).
Ellis answers **"what did the last scan of each kind find, and when?"** from what those scanners stored.
It is read-only: it runs no scan, fixes nothing, and never repeats a secret.

Platform facts cite the public Colaberry platform repository at commit `c99021d`; every file cited
below is unchanged at upstream `13cb098`.

## What an answer looks like

One answer per scan kind, each with a status, the reason, when the scan ran, how much it examined, the
findings, and the ids of the rows it came from (`ai_agents`, `ai_agent_activity_logs`, `department_events`).

| Status | When |
|---|---|
| `findings` | The last scan examined something and found at least one issue |
| `clean` | The last scan examined at least one file or project and found nothing |
| `unknown` | Never run; only failed runs; skipped; examined 0 files or projects; no count recorded; or older than two of its scheduled intervals |

**A scan that has never run is `unknown`, never "no findings".** So is a scan that examined nothing:
a scan of nothing is not a clean scan.

## Where the answer comes from

- **The activity log.** All three scanners run through `runAgent` (`backend/src/services/aiOrchestrator.ts:818-828`),
  which stores each run's scan action and its counts (files or projects examined, findings) in
  `details.actions` (`aiOrchestrator.ts:247-251`). A failed run is not treated as a scan.
- **`department_events`.** Each scanner stores its findings as a row with `metadata.agent` set to its
  name, but only when a `security` department exists (for example `secretDetectionAgent.ts:129`).

**Secrets are never repeated.** Only these finding fields are passed on: file, line, type, pattern
name, vulnerability name, category, severity, module name, advisory title and URL, and directory.
Everything else, including the secret scanner's stored `snippet`, is dropped. A test plants a
key-shaped value in a stored finding and checks it appears nowhere in the output.

## What the code showed, and how Ellis handles it

1. **Two scanners report "clean" when they examined nothing.** The production image ships compiled
   code only, with no source tree (`backend/src/services/agents/security/sourceTreeRoot.ts:2-12`). The
   code audit knows this and records `scan_skipped_no_source` (`codeSecurityAuditAgent.ts:33`). The
   secret and dependency scanners still use the old path that resolves to `/` in the container
   (`secretDetectionAgent.ts:69-73`, `dependencySecurityAgent.ts:79-83`). So they examine nothing and
   record "Clean scan, no secrets detected in 0 files" (`secretDetectionAgent.ts:141`) and "0
   vulnerabilities across 0 project(s)". Ellis reports both as `unknown`. Tested.
2. **The secret ticket stores part of the secret.** The scanner keeps the first 80 characters of the
   matching line as `snippet` (`secretDetectionAgent.ts:104`) and puts up to five findings, snippets
   included, into the ticket's metadata (`:167`). The brief and the platform's own policy say the value
   must never reach a ticket. Ellis drops the snippet. Tested.
3. **Only one security ticket can be open at a time.** Ticket creation reuses any open ticket with the
   same entity and type, with no time limit (`backend/src/services/ticketService.ts:95-107`). All 8
   security agents file tickets as entity `system`, the security department's id, type `bug`
   (for example `secretDetectionAgent.ts:161-166`). So while any security ticket is open, a new one
   (a new leaked key, a new critical CVE) is merged into the old one instead of being raised.
4. **A failed dependency audit can look clean.** `npm audit` runs with errors discarded and `|| true`
   (`dependencySecurityAgent.ts:25`), and any failure returns nothing (`:65-66`), so a failed audit
   simply drops out of the count. Ellis counts projects examined, so 0 projects is `unknown`.
5. **The secret scanner skips silently.** Unreadable folders and files are skipped with an empty catch
   (`secretDetectionAgent.ts:44`, `:110`), and lines containing "example", "placeholder" or "xxx" are
   never checked (`:97`).

Not in this release: the accepted-risk decision for a CVE with no patched version. That is a human
decision record; this release only reports what the scans found.

## How to run it

```
npm run security-posture -- --snapshot examples/security-posture.example.json
```

The example is not production data. It shows the three cases: a secret scan of 0 files (`unknown`), a
code audit with 2 findings, and a dependency scan that never ran (`unknown`). Exit code 0 means every
scan has a known result, 3 means at least one is `unknown`, and 1 means bad input.

## Evidence

- **Named passing test:** "acceptance: a scan that has never run returns 'unknown', not 'no findings',
  for all three kinds". 13 tests in this file, 39 in the repo, all passing under `npm test`.
- **The tests catch defects:** making a never-run scan `clean` fails 3 tests, including the acceptance
  test; removing the 0-coverage rule fails 2; removing the redaction fails the secret test (each
  checked by editing the code, running `npm test`, and restoring it).
- **Not yet run on live records.** K.D. has no admin login (`backend/src/routes/admin/aiOpsRoutes.ts:60`);
  the first live check is one export from A.M.'s agent-management admin screen.
