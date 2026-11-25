# Scheduler and agent liveness watch, R0: workflow, requirements, risks and human decisions

Story: `platform.CAP.scheduler_liveness_watch`. Accountable human on the card: K.D. Written by Q.N. on 24 Nov; section 5 updated the same day with A.M.'s answer.

| | |
|---|---|
| Status on the board | Candidate: not started, not assigned |
| Outcome wanted | Somebody is told when a scheduled agent stops running, instead of the silence being mistaken for health |
| Finding | **Mostly built already.** The platform has the detector, and Ellis has two verified checks that answer this card's first release. What is missing is coverage and a person being told |
| Decision | **Keep it separate** (A.M., 24 Nov). Scope, who is told and tolerance are the builder's to decide (section 5) |

## 1. What already exists

The card says "Built today: absent". That is not what the code shows.

| The card's workflow step | Where it already happens |
|---|---|
| Pair each timer with its `ai_agents` row | Platform: `cronHealthAlertService.ts` selects rows with trigger_type cron and enabled true. Ellis: [registry and runtime reconciliation](../capabilities/registry-runtime-reconciliation.md), verified 27 Oct, lists every timer with no row |
| Compute the expected run from the cron expression and `last_run_at` | Platform: the same service, using the gap between the schedule's next two fires. Ellis: [cron health alerting](../capabilities/cron-health-alerting.md), verified 27 Oct, reproduces it and was compared with the platform's cron parser on 655 cases with no difference |
| Classify on time, late or silent against a tolerance | Platform: warning at 2x the expected interval, critical at 4x (A.M.'s decision of 15 Jul, K.D.'s discretion) |
| Alert once per silence, not once per check | Platform: `alertService.ts` dedups on the open condition |
| Answer "which scheduled agents have not run when they should have" (the card's R2) | Ellis: cron health alerting already answers it in four lists (alerting, clear, evaluated in part, not evaluated), and never says "clear" while a job cannot be evaluated |
| Know whether any timer registered at all | Ellis: [scheduler registration liveness probe](../capabilities/scheduler-registration-liveness-probe.md), verified 2 Nov |
| A screen a person can operate by hand | Platform: System > Platform Operations (`/admin/system/operations`), Fleet tab, added in Nov. It shows each scheduled agent's last run, which have not fired, and which nothing has ever reported on |

## 2. What is genuinely new

These are the gaps left after section 1. They are what this capability would add.

1. **Coverage.** The platform's detector only sees enabled cron rows. On 24 Nov the Platform Operations page read
   "122 timers in the source, 84 of them watched by nothing", and "31 [scheduled agents] silent about themselves for
   30 days". Ellis reports these as "not evaluated", but no person is told.
2. **Never-run agents.** An agent with no `last_run_at` never alerts. The card wants one full interval of grace,
   then an alert.
3. **A person is told.** Ellis reproduces what the platform would raise; it never raises anything itself. The card's
   outcome needs an alert that reaches someone for the cases the platform cannot see.
4. **The check is recorded.** The platform writes alerts, but no activity-log row for the check itself, so the
   watcher cannot be audited.
5. **One schedule to judge against.** The detector judges against `ai_agents.schedule`, which can differ from what
   fires (the code, or a `cron_schedule_configs` override). On 24 Nov the page showed WeeklyStrategicBriefing "Has
   not fired" at "Mondays at 07:45 (override)", where the seeded row says 06:45.

## 3. Requirements for the new part

- Every answer cites the `ai_agents` row and the activity-log rows behind it, and the time it was measured.
- A timer with no row is reported as unmeasurable, never skipped and never "healthy".
- A disabled or paused agent is expected to be silent and does not alert.
- A new agent gets one full interval before it can alert.
- One alert per silence. A long silence does not alert every check.
- Every check leaves a record, including a check that found nothing.
- Read-only. Restarting a silent agent is `platform.orchestration_auto_repair`'s job, not this one's.

## 4. Risks

| Risk | What it would cause | How it is contained |
|---|---|---|
| Building it twice | A second check that disagrees with the verified one | Extend cron health alerting instead (decision 1 below) |
| Alert noise | 84 unwatched timers alerting at once, so people learn to ignore it | Report the backlog once as a list; alert only on new silence |
| Wrong schedule | A false "stopped" alert, as for AutonomousRampEvaluator (row every 2 hours, timer once a weekday) | Judge against the schedule that fires, and say which one was used |
| Treating silence as health | The original problem | "Not evaluated" is never shown as clear |
| Acting, not reporting | Restarting or disabling agents | No write tool; that belongs to another capability |

## 5. Decisions

**Merge or keep separate: keep separate (A.M., 24 Nov).** The reason is structural. `cronHealthAlertService`
evaluates registered, enabled agent entries only. A job with no registry row runs untracked by design, and a disabled
row is a deliberate skip. The unwatched timers are exactly that population, so the existing detector cannot reach them
however it is tuned. The two answer different questions:

- **Cron health alerting:** is a watched timer running and succeeding?
- **This capability:** is every timer that should be watched registered at all?

So the risk of building it twice (section 4) does not apply, and section 1 describes the neighbour, not this
capability. Its core is section 2, items 1 and 2.

A.M. said the remaining three are the builder's to decide. Q.N.'s decisions:

1. **Scope.** Every timer in the source, registered or not, because the unregistered ones are the point. Disabled
   rows are reported as deliberately skipped, not as silent.
2. **The backlog of unwatched timers.** Reported once as a dated list, each with the row it would need (the Platform
   Operations page already proposes one). After that, only a newly unwatched timer is raised.
3. **Who is told.** Kesetebirhan Delele, the accountable human, through Ellis's answer. Anything that would page or
   email someone is a later rung, not the first release.
4. **Tolerance.** Not needed for the core question, which is registered or not. Where a time test is used (an agent
   that has never run), the grace is one full interval of its schedule, the same rule the card asks for.

## Corrections to the card

- "Built today: absent" and the absence evidence: the detector exists (section 1).
- "tolerance_undefined": set at 2x and 4x since 15 Jul.
- "manager_has_no_admin_login": A.M. said on 4 Nov that this planning line is stale. K.D. signs in with his Colaberry
  address.

The code read behind this is [scheduler_liveness_watch-L1-code-read.md](scheduler_liveness_watch-L1-code-read.md).
