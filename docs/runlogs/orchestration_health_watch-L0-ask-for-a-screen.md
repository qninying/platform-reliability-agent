# Run log: Curriculum content health scan, step 0.3 (waiting on the platform)

Story: `platform.CAP.orchestration_health_watch.L0-ASK-FOR-A-SCREEN`. Capability titled "Curriculum content health
scan". Accountable human: K.D.

| | |
|---|---|
| Dates | Request filed 23 Nov; answered by A.M. 24 Nov |
| Done by | Q.N. (Forward Deployed Engineer) |
| Front door answer | **Partly.** The product holds this capability's output, but the screens were closed to the builder |
| Result | The screen was asked for, built and tested. A second candidate was started while it waited |

## Why this is the right fork

The product already runs the scan and stores its snapshots (`orchestration_health`). What was missing was a screen
the builder could open: on 23 Nov both screens holding the output were No Access
([step 2 run log](orchestration_health_watch-L2-in-the-app.md)). So the next move was Ali's, not a build request,
and no scope sheet was written.

## The request (23 Nov)

Filed in the product as a "change to the platform" request (`/admin/change-requests`):

- **Screens and routes:** Curriculum, Health tab (`/admin/orchestration`), and AI Organization, the Orchestration
  Health agent page (`/admin/workforce`).
- **What it asked for:** view-only access. No enable, disable, run now or edit.
- **Evidence:** the step 1 and step 2 run logs.
- **What it did not do:** argue that the capability should exist. The product already does most of it; the request
  only asked to see what it does.

## The answer (24 Nov)

A.M. did not open the whole Program area. He built a read-only page scoped to this capability, **System >
Orchestration Health** (`/admin/orchestration-health`). Q.N. tested it the same day and recorded six named gaps
(second attempt in the step 2 run log). The agent link first given pointed to OrchestrationHealthAgent, which reports
to nobody; the domain's own agent, PlatformDomainAgent, opens for the builder (checked 24 Nov: inactive, autonomy
observe, nothing recorded yet).

The request record in the product is still open: an email answer is not a decision, and the approver field is signed
in the product.

## Second candidate, started while waiting

**`scheduler_liveness_watch`** (scheduler and agent liveness watch), started 23 Nov with a code read:
[scheduler_liveness_watch-L1-code-read.md](scheduler_liveness_watch-L1-code-read.md). It found that a missed-run
detector already exists, but about a third of the timers are not watched by it. A.M. confirmed the gap on 24 Nov
and pointed to the Platform Operations page, which shows it live. The board has no step stories for that capability
yet, so its work is recorded there and continues when they appear.
