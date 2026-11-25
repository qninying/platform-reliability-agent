# Run log: Curriculum content health scan, step 0.2 (scope sheet)

Story: `platform.CAP.orchestration_health_watch.L0-SCOPE-SHEET`. Capability titled "Curriculum content health scan".
Accountable human: K.D.

| | |
|---|---|
| Date | Scope sheet filed 23 Nov with the step 3 tool request; recorded here 24 Nov |
| Done by | Q.N. (Forward Deployed Engineer) |
| Why this step applies | A.M. ruled on 24 Nov that this is the builder's side: the tool request records the capability as not built, so it needs a scope sheet before anything is built |

## 1. Who acts on the output

**Kesetebirhan Delele**, the capability's accountable human, by name as the people record spells it.

## 2. The number that decides it worked

**10 of 10 answers match the latest snapshot on the health page, and a scan older than 10 minutes is reported as
stale every time.**

Somebody else can check it: ask the same question ten times, compare each answer with System > Orchestration Health
(`/admin/orchestration-health`), and compare each scan time with the clock. The scan is scheduled every 5 minutes, so
10 minutes is two missed runs.

## 3. What the system already records that produces it

Every scan writes one row to `orchestration_health` with `scan_timestamp`, `health_score`, `status`,
`component_scores` and `findings`. Comparing an answer with the latest row gives the match count, and
`scan_timestamp` against the current time gives staleness. Nothing new has to be measured.

## What this scope does not include

- Run history and status changes as a screen: that is a product gap for Ali (step 2, gaps 1 and 2).
- Alerting a person when the status changes: not in the first release, which answers questions and does nothing else.
- Any write. The tool requested in step 3 only reads the one table.
