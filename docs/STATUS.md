# Status: current boundaries and next steps

Part of the [Ellis README](../README.md). This page is the one place for the numbers that change; dated records
and PDFs keep the figures they had on their date.

## Numbers

| | As of 2026-11-10 |
|---|---|
| Capabilities built (rows in the [catalog](capabilities/README.md)) | 39 |
| Build-plan stories verified by the platform | 40 of 48 |
| Tests | 926 passing |
| Higher-autonomy rungs rehearsed in a sandbox | 16 |
| [Decision records](decisions/README.md) | 7 |
| Fixes merged into the platform | 5 |

Some capabilities cover more than one build-plan story after A.M.'s 4 November ruling, which is why the two
first counts differ.

## Boundaries and next steps

| | |
|---|---|
| **Implemented** | 40 of 48 capabilities verified by the platform, the merged manager-access check and the folded untracked timer proposal among them; under A.M.'s 4 November ruling, 6 more are folded into others, and 2 are held. Every check returns one output shape. |
| **Validated in a sandbox** | Auto-repair and ticket resolution (R4), the R4 rungs of stale action recovery, preview stack reaping, data retention, the cron overlap guard, the default-on timer guard, the scheduler liveness probe, dead-letter capture, dead-letter replay, error classification, the idempotency audit, bug-fix verification, the health scoring model and the registry ratchet, the schema comparison, the timer proposals and the restore check (R3), bug baselines (R1). |
| **Not yet done** | No capability has run on a live production export; each read-only capability's write-up lists that check as outstanding. K.D. signs in through a management role, from which the portal mints an admin login (A.M., 4 November); A.M. is correcting the domain record to K.D.'s work address, which the agent's own pages need. |
| **Next** | The first live export and comparison with what the platform shows; the gate and broker that call these checks as tools; running shadow-mode evaluation (R5) on the built harness once K.D. sets its limits and references are approved; choosing the model and prompt for the reasoning layer. |
