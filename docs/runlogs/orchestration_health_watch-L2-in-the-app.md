# Run log: Curriculum content health scan, step 2 (do it in the app)

Story: `platform.CAP.orchestration_health_watch.L2-IN-THE-APP`. Capability titled "Curriculum content health scan".
Accountable human: K.D. Step 1: [orchestration_health_watch-L1-by-hand.md](orchestration_health_watch-L1-by-hand.md).

| | |
|---|---|
| Date | 2026-11-23 |
| Done by | Q.N. (Forward Deployed Engineer) |
| Method | The product only: the portal, Floor 4 Program. No agent, no script, no database. |
| Time it actually took | About 10 minutes |
| Result | **Not yet. It stops at the door:** the two screens that hold this capability's output are both No Access. |

## Steps I really performed

1. Signed in to the portal and went to Floor 4, Program. The floor reads "Your badge opens 1 of the 7 rooms here."
2. Tried **Curriculum** (`/admin/orchestration`), which holds the Health tab with the snapshot, score and findings.
   It shows **No Access**.
3. Tried **AI Organization** (`/admin/workforce`), which holds the Orchestration Health agent's page. It shows
   **No Access**.
4. Opened **Agents** (`/admin/agent-dashboard`), the only room that opens. It led to the Platform Agent page: status
   Inactive, autonomy `observe`, last active Never, 0 open tickets, and "No decisions or events recorded for this agent
   yet". It shows no Orchestration Health data.
5. Looked for Change Requests on the floor. It is no longer listed as a room.

## Named gap (the exact step that stopped me)

**Curriculum, `/admin/orchestration`: No Access.** Without it, none of the step 1 questions can be answered in the
app:
- the latest snapshot and its age;
- gaps in the run history;
- the current status and when it last changed;
- whether the findings match what the code checks.

## Differences from the step 1 run log (14 Nov)

| | Step 1 (by hand, 14 Nov) | Step 2 (in the app, 23 Nov) |
|---|---|---|
| Source of the answer | Platform code on main | The product, which stopped me at the door |
| Rooms that opened | My Domain and Change Requests | Agents only |
| Change Requests | A room on the floor | Not on the floor anymore |
| Finding 1 (record and code describe different agents) | Found from the code | Can't be checked in the app: the Health tab is locked |
| Time | About 15 minutes (estimated afterwards) | About 10 minutes |
| New | | The Agents room opens, to an inactive Platform Agent with no recorded events |

## What would let the app route work

View-only access to Curriculum (the Health tab) and to AI Organization (the Orchestration Health agent page), with no
enable, disable, run now or edit. Filed as a "change to the platform" request on 23 Nov (/admin/change-requests),
citing this log and step 1. Waiting on A.M. or K.D. Step 2 itself is complete: the named gap above is its result.

## Second attempt, 24 Nov (after A.M. answered the change request)

A.M. answered the view-only request on 24 Nov. He did not grant the whole "program" area. Instead, he added a read-only
page scoped to this capability, **System > Orchestration Health** (`/admin/orchestration-health`), and gave the
Orchestration Health agent's own page (`/admin/agents/<id>`) as the agent half.

| | |
|---|---|
| Date | 2026-11-24, 1:04 PM to 1:14 PM CT |
| Done by | Q.N. (Forward Deployed Engineer) |
| Method | The product only. No agent, no script, no database. |
| Time it actually took | About 10 minutes |
| Result | **Partly answered.** The health page opens and shows the latest snapshot. The agent page refuses. |

### Steps I really performed

1. Opened **System > Orchestration Health**. It opened.
2. Read the header: "Automated scan: 65/100, 3m ago", so the latest snapshot was about 1:01 PM. 125 mini-sections,
   1602 enrollments, 2 findings.
3. Read **Monitoring Agents**: one row per agent with a last-run time and an error count. OrchestrationHealth: 3m ago,
   **292 err**.
4. Read **Findings (2)**, 1 critical and 1 warning:
   - Integrity: "Integrity check found 3 issue(s)." The issues are not named.
   - Build sync: 29 of 43 bound build projects have not reported a push in 14 days. 3 named projects have never
     delivered a webhook.
5. Read **Entity Inventory**: 5 modules, 25 lessons, 125 mini-sections, 25 prompt templates, 14 variable definitions,
   191 skill definitions, 146 artifact definitions, 1602 enrollments, 50 lesson instances, 0 session gates.
6. Read **Prompt Backfill Status**: Total 125. With Inline, FK Only and Neither all show "-".
7. Opened the agent page from A.M.'s link. In a new private tab it asked for a password sign-in (I sign in by email
   link, so I have no password). When I pasted the link into the signed-in tab, it said **"This agent is not in your
   reporting chain."** (1:13:56 PM). I reported this and did not work around it.

### Step 1 questions, answered in the app

| Question | Answer from the product |
|---|---|
| Latest snapshot and its age | Yes: 65/100, 3 minutes old |
| Gaps in the run history | **No.** Only the latest snapshot is shown, so missed runs can't be seen |
| Current status and when it last changed | **Partly.** The score and findings are shown, but there is no history and no "changed at" |
| Do the findings match what the code checks? | **Yes.** They are content and build-sync checks, not a scheduler watchdog, which confirms finding 1 from step 1 |

### Named gaps (where the product can't do what the capability needs)

1. **No run history.** Only the latest snapshot is shown, so a missed or failed run can't be seen.
2. **The critical finding is a count, not a list.** "3 issue(s)" does not say which issues or where.
3. **No component scores on the page.** Only the overall 65/100 is shown.
4. **The error count has no date.** OrchestrationHealth shows "292 err" with nothing beside it. The count is
   lifetime, against 72,682 runs, and the most recent error was 26 Aug, three months earlier (confirmed in review,
   below). With no date it reads as a live incident, and it sent me looking for a current failure that did not exist.
5. **Prompt backfill is empty.** Three of the four tiles show "-".
6. **No sign of an alert.** Nothing on the page shows that the critical finding notified anyone.

### Review, 24 Nov

A.M. reviewed the second attempt and confirmed the six gaps above as step 2's result. Two corrections came with it:

- **The agent refusal was the wrong link, not a missing permission.** The link pointed to OrchestrationHealthAgent,
  which reports to nobody and so is in no one's reporting chain. The refusal was the system behaving correctly. This
  domain's agent is a different record, PlatformDomainAgent, which opens for the domain's verified builder.
- **The 292 errors are old.** The count is lifetime, and the last error was 26 Aug. Gap 4 is recorded as the missing
  date, not as an unexplained failure.

Next: step 3. The tool request filed on 23 Nov is open and waiting for a decision in the product.
