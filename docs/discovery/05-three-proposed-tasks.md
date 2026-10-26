# Capture three proposed agent tasks with boundaries and completion evidence

**Story:** `platform.RESEARCH-5-THREE-PROPOSED-TASKS` · **Version:** 3 · **Date:** 2026-10-26 · **Autonomy level today:** R0
**Prepared by:** Q. Nkwain Ninying · **Approver for all three:** K.D., the accountable human

The three tasks are taken from this domain's own 48 draft capabilities, not invented. Platform
facts cite the public Colaberry platform repository at commit `c99021d`; `CAPS` means
`backend/src/services/agentDomain/capabilities/platform.json`, `LADDER` means
`backend/src/services/agentDomain/autonomyLadder.ts` and `BASELINE` means
`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts`.

**Why the evidence rule matters here:** the platform already has 106 approval rows whose only
recorded decider is a 4.25-hour timer
(`backend/src/services/agentDomain/__tests__/promotionCriteria.test.ts:591`). So for every task
below, completion evidence is something a person checks against a known answer, never the task
being marked done.

## Order, and why Task 1 comes first

The order is Task 1, then Task 2, then Task 3.

Task 1 is not one of the five monitoring capabilities named as first priorities (orchestration
health watch, system health probe and alerting, cron health alerting, agent health scoring,
incident trace and error triage). It comes first because those monitors read the same run
records, and the records have holes:

- Cron health alerting is "structurally blind to unregistered, disabled and phantom crons" (`CAPS:1875`).
- Agent health scoring gives a never-run agent a perfect 100 (`CAPS:1926`).
- Incident triage has no trace for untracked jobs, and the cron path records no error class (`CAPS:2669`).
- Jobs scheduled directly on the host server write nothing to the agent activity log, so their
  failures leave no platform record at all (A.M., from the host's crontab, 2026-10-22).

Task 1 measures which jobs are recorded and which are not. Until that is known, a quiet result
from any of the five monitors cannot be told apart from a blind spot. Task 2 then diagnoses
failures with that map in hand, and Task 3 comes last because the briefing depends on several
capabilities and its unmeasured section reuses Task 1's list of unrecorded jobs.

## Rules for all three

- Read-only. The agent reads records where they live and never copies them.
- Every claim in its output cites the record or line it came from.
- **No count is copied from a document.** Every count is published with the list of names behind
  it and the date it was measured. The earlier figures of 33 and 34 untracked timers disagree and
  are not used (`CAPS:3742` sets the same rule for drift detection).
- **Missing input is never good news.** Where an input is missing, the answer is "unknown",
  "not instrumented" or "not traceable", never "healthy", "clean", "none" or "did not run".
- Step and cost limits per run; cost, accuracy and latency are recorded for every run.
- Tool grants are approved by A.M. and K.D. before any run. No tool grant record exists on the
  platform yet (see story 2), so the grant is written down outside the agent.

### Switch off any of the three if

- it attempts any write, or calls a tool outside its grant;
- its cost passes the daily limit [K.D. to set];
- it answers "healthy", "clean" or "none" where an input was missing;
- plus the task's own conditions below.

## How K.D. checks the answers

| Kind of claim | How it is checked |
|---|---|
| About the code (which job exists, what it records) | The answer cites a file and line in the public platform repository. K.D. opens it on GitHub; no login is needed. |
| About the host's scheduled jobs | Checked against A.M.'s dated listing of the host crontab. |
| A diagnosis of a past failure | Checked against the cause K.D. confirmed before the agent ran (Task 2). |
| About live records (a run, a count, a figure in the briefing) | Checked on the admin screen for agent management that A.M. is building. No access grant is planned in the meantime. |

Tasks 1 and 2 can be checked today. Task 3 waits for the admin screen; it is designed on the
assumption that K.D. can verify every figure, not around the gap.

## Task 1: Logging coverage audit

**Capability:** `platform.cron_run_instrumentation` (`CAPS:1688`), implementation state `partial`.

**Completion evidence (written first):**
- A report with one row per scheduled job, both the platform's own timers and the jobs on the
  host server's crontab. The unit is the scheduled entry: one row per cron entry, even where
  several entries run the same script. Each row says whether the job records that it ran, its duration, its
  failures and an error class, with the source for each answer. The list of jobs and its count
  are dated.
- **The capability's own test (`CAPS:1781`):** for an untracked job the answer is "not
  instrumented, no record exists", never "did not run".
- **Main check:** every job on A.M.'s dated host crontab listing is reported as "not
  instrumented, no record exists", because none of them writes to the agent activity log.
  Reporting any of them as recorded, or leaving one out, fails the task.
- **Second named check:** `WorkforceIntelligence` runs every 6 hours with no seed row
  (`BASELINE:196`). It must also be reported as "not instrumented, no record exists".
- **Agreed in advance:** the cron path's error class is "not captured" (`CAPS:1774`). A report
  that says otherwise fails.
- K.D. checks 5 rows of K.D.'s choosing, using the methods above, and all 5 match.

| | |
|---|---|
| **Tools and data** | `read_cron_run_logs`, `read_activity_log`, `read_agent_registry`; the scheduler registry, `ai_agents` rows, activity logs, and A.M.'s dated host crontab listing, supplied as an approved input. No source-tree tool is needed: the host jobs are in the server's crontab, not the repository. |
| **Must NOT** | Change any instrumentation, write to any table, copy logs, or call any tool that is not read-only |
| **Autonomy** | Starts at R0; ceiling R2, answering from approved records (`LADDER:61`) |
| **Why the ceiling is R2** | Instrumentation is deterministic plumbing and must stay deterministic. The agent reads what it recorded and reports the gaps; it never becomes the instrumentation (`CAPS`, this capability's `max_autonomy_rationale`) |
| **Approves** | K.D. approves the report; A.M. and K.D. approve the tool grants |
| **Switch it off if** | The shared conditions apply, or it produces a row without a source, or it reports any host crontab job or `WorkforceIntelligence` as recorded |

## Task 2: Diagnose a past failure

**Capability:** `platform.incident_trace_and_error_triage` (`CAPS:2577`), implementation state `partial`.

**The test set:** nine real production failures assembled by A.M. on 2026-10-22. Some can be
diagnosed from the records; some cannot, because the evidence is thin or the failing job leaves no
platform record at all. The cases, their proposed causes and how they group are the answer key.
They stay with K.D. and are not in this repository.

**Completion evidence (written first):**
- Every cause in A.M.'s set is marked PROPOSED. **K.D. confirms or corrects each cause before the
  agent sees anything**, and keeps the key. The agent's version is frozen before the run, and the
  agent is never tuned against the proposed causes.
- The agent sees the nine cases without the causes.
- **The capability's own test (`CAPS:2676`):** where no trace exists, the answer is "not
  traceable, this job is untracked", never a reconstructed story.
- Each diagnosis cites the trace, activity record or log line it used. K.D. compares it with the
  confirmed cause.
- **Scoring:**
  - Inventing a cause for a case that cannot be diagnosed fails the test outright, however many
    of the others are right. On those cases the correct answer is no cause, plus what record would
    settle it.
  - **Inventing** means stating a cause as fact without a record behind it. A clearly labelled
    hypothesis, with the record that would confirm or rule it out, is not inventing.
  - Where two cases may share a cause, the agent is scored on flagging the possible link, not on
    asserting it.
  - The pass mark for the diagnosable cases (interview question 7) is agreed with K.D.

| | |
|---|---|
| **Tools and data** | `read_activity_log`, `read_cron_run_logs`, `read_audit_log`, `compose_report_draft`; a trace id, activity id or error id |
| **Must NOT** | Mark any error as resolved, re-run any job, or change anything |
| **Autonomy** | Starts at R0; ceiling R5, shadow evaluation against approved reference outcomes (`LADDER:64`) |
| **Why the ceiling is R5** | Tracing and diagnosing is reading and reasoning over records, which can be compared against diagnoses a human approved. Marking an error resolved is a claim about reality, so it stays with a person (`CAPS`, this capability's `max_autonomy_rationale`) |
| **Approves** | K.D. confirms the causes, holds the key, and judges each diagnosis |
| **Switch it off if** | The shared conditions apply, or it states a cause without citing a record, attempts to resolve an error, or invents a cause for a case that cannot be diagnosed |

## Task 3: Weekly reliability briefing for the manager

**Capability:** `platform.reliability_briefing_for_manager` (`CAPS:4630`), implementation state
`absent`. This is the only DA-related responsibility found (story 3), and it is proposed rather
than inherited.

**Completion evidence (written first):**
- For one week, a briefing is written by hand from the same records, and the agent writes its own
  draft without seeing it.
- Every figure in the agent's draft traces to a query or record. K.D. marks each claim right or
  wrong on the agent-management admin screen, and compares the draft with the hand-written
  briefing.
- **The capability's own test (`CAPS:4731`):** no percentage appears without the record count
  behind it, and an unmeasured section names the untracked timers, the host crontab jobs and the
  phantom crons rather than leaving them out.
- The unmeasured section reuses Task 1's dated list of unrecorded jobs, so Task 3 runs after
  Task 1.

| | |
|---|---|
| **Tools and data** | `read_health_metrics`, `read_activity_log`, `read_cron_run_logs`, `compose_report_draft`, plus Task 1's dated list of unrecorded jobs; run and failure counts, alerts, open decisions |
| **Must NOT** | Send the briefing (sending email is denied to agents, `backend/src/services/delivery/execution/executionPolicy.ts:33-42`), or include any figure without a source |
| **Autonomy** | Starts at R0; ceiling R5 (`LADDER:64`) |
| **Why the ceiling is R5** | Writing a sourced report is reading and writing over records, and comparing it with a briefing a person wrote is the right top rung. Sending it is a live external effect, so delivery stays with the existing briefing service (`CAPS`, this capability's `max_autonomy_rationale`) |
| **Approves** | K.D. approves the content; A.M. and K.D. approve the tool grants |
| **Switch it off if** | The shared conditions apply, or any figure cannot be traced to a record, a percentage appears without its count, or it attempts to send anything |

## Before the first run

These do not block approval of this proposal. They block running the tasks.

| Needed | From | For |
|---|---|---|
| Approval of the read tools | K.D. reviews scope, then A.M. | All three |
| The daily cost limit | K.D. | All three |
| Confirm or correct the proposed causes, and freeze the agent version | K.D. | Task 2 |
| Pass mark for the diagnosable cases (interview question 7) | K.D. | Task 2 |
| The admin screen for agent management | A.M. (being built) | Task 3 |

## Version history

- **Version 1 (2026-10-19):** proposed a logging audit, a failure diagnosis, and explaining a
  legacy app. Never sent for review.
- **Version 2 (2026-10-21):** tied each task to a real platform capability. Task 3 changed from
  legacy-app explanation to the manager briefing, because legacy apps have no capability of their
  own; they are covered by the separate legacy migration plan story. K.D. requested changes on
  2026-10-22.
- **Version 3 (2026-10-22):** order set to Task 1, 2, 3, with the reason Task 1 comes first;
  Task 1's main check is now the host crontab jobs that leave no platform record, plus
  `WorkforceIntelligence`; no copied counts; each capability's own acceptance test carried in;
  shared switch-off conditions for cost and for "healthy" answers on missing input; cron error
  class agreed as "not captured"; Task 2 uses A.M.'s nine-case test set, kept outside this
  repository, with all-or-nothing scoring on the cases that cannot be diagnosed and a definition
  of inventing a cause; audit unit set to the cron entry; verification through the
  agent-management admin screen, with Task 3 waiting for it.
