# Prepare a 30-minute interview with the accountable human and propose a weekly check-in

**Story:** `platform.RESEARCH-4-MANAGER-INTERVIEW` · **Version:** 2 · **Date:** 2026-10-21 · **Autonomy level:** R0
**Prepared by:** Q. Nkwain Ninying · **Interviewee:** K.D., the accountable human for this domain

This document is the agenda and question set. It arranges nothing: no invitation or message is
sent by this story. Platform facts cite the public Colaberry platform repository at commit
`c99021d`; `CAPS` means `backend/src/services/agentDomain/capabilities/platform.json`.

## Agenda (30 minutes)

| Minutes | Section | Questions |
|---|---|---|
| 0 to 3 | Purpose: what this domain's agent is for, and that every capability is still a draft | none |
| 3 to 8 | The access blocker (raise, do not solve) | Q1 |
| 8 to 14 | Which capabilities first | Q2, Q3 |
| 14 to 19 | What stays human forever | Q4, Q5 |
| 19 to 25 | What "good" looks like, in numbers | Q6, Q7 |
| 25 to 29 | What gets switched off immediately | Q8 |
| 29 to 30 | Confirm the weekly check-in | none |

## The access blocker (to raise)

K.D. cannot reach any agent surface today. K.D. has an `org_members` row but no `admin_users`
row, so the platform domain is marked `can_reach_surface: false`
(`backend/src/services/agentDomain/agentDomainRegistry.ts:227`;
`docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19`). Until that changes,
K.D. cannot see what K.D. is being asked to validate. This is raised in the interview, not fixed
there; provisioning a login is a governance decision.

## Questions, and what each answer changes

| # | Question | What the answer changes |
|---|---|---|
| Q1 | Should A.M. give you an admin login with a scoped role, or should the agent reach you some other way (for example a written weekly briefing) until then? | Decides how the agent reports (anatomy element 4, communication) and is raised with A.M. as a governance request |
| Q2 | Five monitoring capabilities need no human decision: `orchestration_health_watch`, `system_health_probe_and_alerting`, `cron_health_alerting`, `agent_health_scoring`, `incident_trace_and_error_triage`. Which would save you the most time first? | Becomes the first task in story 5 and the first capability built in release 3 |
| Q3 | The manager briefing (`reliability_briefing_for_manager`) is the only DA-related capability and does not exist yet. Before or after monitoring? | Sets its place in the build order, and confirms or removes it as the DA responsibility in story 3 |
| Q4 | Three capabilities may go past R5 without a human decision: `orchestration_auto_repair` and `agent_behavior_safety_watch` (up to R6), and `agent_ticket_auto_resolution` (up to R7). Should any of them be a human decision instead? | If yes, raised with A.M. as a change to `CAPS`, and capped in our own task proposals |
| Q5 | Who decides the disposition of the 38 inherited legacy records (`CAPS:7`): you alone, or with A.M.? | Names the approver in the legacy migration plan story |
| Q6 | In shadow mode over a past window, how many missed incidents and how many false alarms would you accept before approving monitoring at R5? | Becomes the readiness threshold in story 3 and the completion evidence in story 5 |
| Q7 | How many past failures with a known cause should the agent diagnose correctly, and out of how many, before you trust its diagnoses? | Sets the size of the diagnosis test set |
| Q8 | What would make you switch it off at once: any write attempt, a claim without a source, cost above a daily limit, something else? And who can stop it while you have no admin login? | Becomes the switch-off conditions in story 5 and the agent's guardrails |

## Proposed weekly check-in

| | |
|---|---|
| **Day and time** | Mondays, 1:30 pm Central |
| **Duration** | 30 minutes |
| **Reviews** | 1. Stories waiting for approval · 2. Blockers, starting with the access blocker · 3. The next two stories |
| **Decisions** | Recorded on each story's review page, not in the meeting |

## Answers (filled in after the interview)

| # | Answer | Change made |
|---|---|---|
| Q1 | | |
| Q2 | | |
| Q3 | | |
| Q4 | | |
| Q5 | | |
| Q6 | | |
| Q7 | | |
| Q8 | | |

## Version history

- **Version 1 (2026-10-19):** recorded a first working session with K.D. (review of stories 1 and 2) and the weekly check-in.
- **Version 2:** rewritten as the plan this story asks for: a timed 30-minute agenda, eight questions specific to this domain's capabilities, the access blocker as an item to raise, what each answer changes, and an empty answers section.
