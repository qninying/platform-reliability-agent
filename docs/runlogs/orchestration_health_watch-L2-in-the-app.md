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
