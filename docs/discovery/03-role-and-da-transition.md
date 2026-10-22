# Document the accountable human's role, and which DA responsibilities transition

**Story:** `platform.RESEARCH-3-ROLE-AND-DA-TRANSITION` · **Version:** 2 · **Date:** 2026-10-21 · **Autonomy level today:** R0
**Prepared by:** Q. Nkwain Ninying

Platform facts come from the public Colaberry platform repository
([ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator](https://github.com/ColaberryIntern/ColaberryEnterprise_AI_LeadershipAccelerator))
at commit `c99021d` (2026-10-21). `CAPS` means `backend/src/services/agentDomain/capabilities/platform.json`.

## The accountable human

**K.D.**, recorded as the accountable human for this domain at `CAPS:3` and as the owner of
Platform Automation & Reliability, team Operations, at
`docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19`. All 48 capabilities list
K.D. as an intended user (`jq '[.capabilities[]|select(.intended_users|tostring|test("Kesetebirhan"))]|length' CAPS`
returns 48).

## The DA duties: what was searched, and what was found

**The source does not exist.** No document in the platform repository lists DA duties for this
domain.

| Search | Result |
|---|---|
| `git grep -l -i "data analyst"` | 39 files: course material, and `docs/agent-catalog/assistant/data-analyst-agent.md`, which describes a SQL-result labelling agent, not a human role (`:4`) |
| `git grep -l -i "DA responsibilities"` | 6 files, all capability files or the story template; none lists duties |
| `CAPS:4638` | The briefing capability is "proposed as the Data-Analyst-style reporting responsibility ... the amendment's own source document naming DA responsibilities is not in the repository" |
| `CAPS:4670` | "The DA responsibilities this is meant to absorb are not documented anywhere in the repository" |
| `.loop-architect/runs/20261007-school-agent-factory/` (cited at `CAPS:4640-4641`) | Not in the public repository (`git ls-files .loop-architect` returns nothing) |

**Two readings of "DA" exist.** The platform's brief reads it as Data Analyst duties. This
project's assignment reads it as the existing Data Analytics (DA) student processes
(`assignment.md:31` in this repository). Neither is documented. Which one applies is question 1
for K.D.

**What would have to be written, and by whom:** a one-page duty list by K.D., covering each
recurring DA task, how often it happens, the systems it touches, and who receives the output.
A.M. confirms which reading of DA applies. Until it exists, the only DA-related responsibility
below is the reporting one, and it is marked as proposed.

## The role today

Described by K.D. during onboarding (2026-10-07 to 2026-10-14). None of it is documented in the
platform repository, so each row is the manager's account, not a sourced fact.

| Responsibility | What it involves |
|---|---|
| Monitoring | Watches existing apps for performance, quality and compliance |
| Fixing | Repairs apps when they break |
| Deployment support | Helps new apps go live on the platform |
| Understanding legacy apps | Works out how undocumented apps behave and why; there are 38 inherited legacy records (`CAPS:7`) |
| Approvals | Approves tool requests with A.M., and the agent's work and actions |
| Managing the intern | Weekly check-in and review of each story |

## Responsibilities that transition to the agent

Each one starts at R0 (read-only). "Ready" means the evidence that would justify approving the
next autonomy level. R5 is shadow-mode evaluation against approved reference outcomes
(`backend/src/services/agentDomain/autonomyLadder.ts:64`).

| Responsibility | Capabilities (`CAPS`) | Evidence the agent is ready to hold it |
|---|---|---|
| Monitoring platform health | `orchestration_health_watch`, `system_health_probe_and_alerting`, `cron_health_alerting`, `agent_health_scoring`, `runtime_cron_drift_detection` | In shadow mode over a past window, it flags every incident K.D. recorded in that window, and K.D. confirms the flags it raised beyond them are real or explained |
| Incident triage and diagnosis | `incident_trace_and_error_triage`, `dead_letter_capture` | On past failures with a known cause, its diagnosis names that cause, citing the trace or log line |
| Reliability reporting to the manager (the only DA-related item; proposed) | `reliability_briefing_for_manager` | K.D. receives the briefing for four weeks, every claim carries a source, and K.D. confirms it replaces the manual data pull |
| Security posture watch | `security_posture_scan`, `runtime_threat_and_access_watch`, `security_oversight_rollup` | Each finding names the specific grant or rule involved, and K.D. confirms a sample of findings |

## Responsibilities that split

| Responsibility | The agent | The human |
|---|---|---|
| Fixing | Diagnoses, drafts the fix and verifies it in a sandbox (`platform_bug_fix_dispatch`, capped at R4) | Merges and deploys. Both `push_to_protected_main` and `production_deploy` are denied to agents (`backend/src/services/delivery/execution/executionPolicy.ts:33-42`) |
| Deployment support | Assembles the deploy evidence and checks health after release (`deploy_verification_evidence`) | Approves the release (`production_deploy_review_and_approval`, capped at R1) |
| Reliability thresholds | Proposes a threshold and replays it against a past window (`reliability_threshold_ownership`) | K.D. sets the threshold |
| Understanding legacy apps | Reads code and logs and drafts a summary and a runbook | K.D. decides each legacy record's disposition; a draft is not trusted until reviewed |
| Production changes found by checks | Detects the problem and builds or verifies the change in a sandbox (`schema_drift_detection`, `default_on_timer_guard`, `dead_letter_triage`, `untracked_timer_registration_proposal`, `backup_and_restore_verification`) | Applies the change in production |

## Responsibilities that stay human

23 capabilities are marked `human_decision`: a human makes that decision at every autonomy level
(`autonomyLadder.ts:213-219`). Nine of them are splits above, where the agent prepares and a human
decides. The other 14 are responsibilities the human keeps whole:

| Responsibility | Capabilities (`CAPS`) | Why it is reserved |
|---|---|---|
| Approving the agent's own authority | `capability_autonomy_authority_resolution`, `agent_promotion_and_approval_decision`, `execution_policy_enforcement` | An agent that could raise its own level or widen its own policy would make every other limit meaningless |
| Turning agents and timers on or off | `agent_enable_disable_control`, `schedule_governance_live_reload`, `emergency_stop_and_kill_switch`, `agent_discovery_sync` | Each one changes which automation runs in production; a kill switch the agent can pull is one it can pull on its own supervision |
| Who reports to whom, and who can reach what | `agent_identity_attribution`, `manager_scoped_authorization`, `manager_reachable_agent_surface`, `manager_restriction_directives` | These are the accountability and authorization boundaries the agent itself is held inside |
| Technology and architecture direction | `infrastructure_evolution_proposals`, `workforce_technology_direction`, `prompt_and_performance_optimization` | Adopting them changes production behaviour or strategy, which are escalation decisions; the agent may propose with evidence |
| Approving tools | (no capability; governance) | A.M. and K.D. approve every tool request |
| Managing the intern | (no capability) | People management is not agent work |

The `max_autonomy_rationale` field of each capability in `CAPS` gives the full reason for its cap.

## Questions for K.D.

1. Which DA applies here: Data Analyst duties, or the existing Data Analytics student processes? Which of those tasks do you do today?
2. Walk through one real task from start to finish, for example the last time something broke.
3. Are the split lines above right, especially for fixing and legacy apps?
4. Is anything in "The role today" missing or wrong?

## Sources

- `CAPS:3`, `:7`, `:4638`, `:4640-4641`, `:4670`, and the `jq` queries above
- `docs/architecture/ai-workforce-management/HUMAN_OWNERSHIP_MAP.md:19`
- `docs/agent-catalog/assistant/data-analyst-agent.md:4`
- `backend/src/services/agentDomain/autonomyLadder.ts:64`, `:213-219`
- `backend/src/services/delivery/execution/executionPolicy.ts:33-42`
- `assignment.md:31` (this repository)

## Version history

- **Version 1 (2026-10-19):** the role as described in onboarding, a first proposal of what moves to the agent, and questions about the DA part.
- **Version 2 (approved by K.D. 2026-10-21):** names the accountable human from the platform records; proves the DA duty list does not exist and says what would have to be written; maps each responsibility to the platform's own capabilities as transitions, splits or stays human; states the evidence that would show the agent is ready for each transitioning one.
