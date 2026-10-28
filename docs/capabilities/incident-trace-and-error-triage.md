# Incident trace and error triage

**Story:** `platform.CAP.incident_trace_and_error_triage` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/incidentTrace.ts` · **Tests:** `test/incidentTrace.test.ts`

Ellis follows a failure from what a person sees back to the run that caused it, and states the probable
cause in the run's own words, citing the rows behind it. You can ask with any of four handles:
- a trace id;
- an activity row;
- an error record;
- a job's name, which means its latest failure.

Where no trace exists, Ellis says so and why, and pieces nothing together. It is read-only: marking an
error resolved stays with a person.

Platform facts cite the public Colaberry platform repository at upstream commit `c96f6a6`.

## Not traceable is an answer

The acceptance criterion is that a failure with no trace gets "not traceable, this job is untracked", never a
reconstructed narrative. Ellis says **"Not traceable: this job is untracked"** (a colon in place of the
criterion's dash). It never offers a cause where it has no trace, even when a row that looks related is
sitting next to the failure. Each not-traceable answer names its reason:

| Reason | Means |
|---|---|
| no row | no `ai_agents` row carries the job, so its wrapper runs it untracked |
| wrapper records no run | the job has a row, but its wrapper writes no activity row for a failure: `trackAgentRun`, a workforce director's gate, or `CampaignHealthScanner`, whose failures go to a system event |
| row has no trace | the row exists but carries no trace id: an agent's own rows get none |
| error links to no run | an error record's only link to a run is empty |
| events without a run | AI calls carry the trace id but no run row does: an untracked job or a web request, and the records do not say which |

## When there is a trace

- **Order:** Ellis lists every activity row with the trace id in time order, as the platform's trace view
  does (`backend/src/services/aiOpsService.ts:317-329`).
- **AI calls:** it adds the AI calls that share the trace id. The platform's view leaves these out.
- **Cause:** the probable cause is each failure in the run's own words:
  - "threw" for a thrown error;
  - "reported an error" for an error the agent returned;
  - "failed" otherwise.

  Each is cited to its row.
- **Error class and severity:** both are always empty. The cron path records no error class, and the
  platform records no severity for a run failure. Ellis says so rather than inventing one.

For an error record, Ellis also says how it was resolved:
- **By a person:** "a claim, not evidence".
- **By `CampaignRepairAgent`'s timer:** "because it was over 7 days old, not because the cause was fixed".

## What the code showed

**New**

1. **Reporting gap. No error on the errors surface leads to a run.**
   - **Its one writer:** the errors tab lists `campaign_errors`. The only code that writes that table is the
     stalled-campaign check in `CampaignRepairAgent` (`services/agents/campaignRepairAgent.ts:129`).
   - **Its only link to a run, `repair_attempt_id` (`models/CampaignError.ts:94`), is written nowhere.** So
     the error detail's repair attempt is always empty, and "open an error and follow its trace" cannot
     happen for any error.
   - **Run failures never appear there:** a failed agent run never becomes an error record, so the errors
     tab shows stalled campaigns only.
2. **Reporting gap. A runAgent trace is one row.**
   - **No trace context:** `runAgent` never opens one (only `cronInstrumentation.ts:23-24` and
     `middlewares/traceMiddleware.ts:20-24` do).
   - **No trace handed down:** it gives the agent no trace id (`aiOrchestrator.ts:213`), and
     `logAgentActivity` stamps one only when the caller passes it (`aiEventService.ts:49-76`).
   - **Effect:** for the 104 agents run this way, the agent's own activity rows and its AI calls carry no
     trace id. A trace holds the wrapper's summary row and nothing the agent did.
   - **The same holds for** `trackAgentRun`, which writes no activity row at all. A director's gate is
     different: it stamps a fresh trace id on its success and skip rows (`workforceAgentRuntime.ts:150`,
     `:164`, `:175`), but a failure leaves no row. `CampaignHealthScanner`'s failures go to a system event,
     not an activity row (`aiOrchestrator.ts:168-172`).
   - **Known in part:** the platform has work towards trace ids that are never null
     (`__tests__/utils/requestContext.test.ts`), but `runAgent` was never brought into it.
3. **Reporting gap. The trace view leaves out the AI calls that share the trace.** It reads activity rows
   only (`aiOpsService.ts:317-329`). For a cron job whose AI calls do carry the trace id, the calls never
   appear beside the run.
4. **Latent. Turning off auto-retry for `CampaignRepairAgent` does not stop it retrying.**
   - Its registry config seeds four settings: `auto_retry_enabled`, `max_retry_attempts`,
     `retry_delay_minutes` and `auto_resolve_stale_days` (`agentRegistrySeed.ts:342-347`).
   - The agent takes no config (`campaignRepairAgent.ts:16`). It retries up to a fixed 3 attempts (`:27`)
     and auto-resolves at a fixed 7 days (`:166`).
   - So a person who edits the setting to stop a burst of resends would see nothing change.
5. **Reporting gap, known in part. A weekly-reopening stall reads as fixed every week.**
   - **The resolve:** any unresolved error over 7 days old is marked resolved, whether or not the campaign
     is still stalled (`campaignRepairAgent.ts:161-169`).
   - **The reopen:** the next stall check looks only for an unresolved error (`:118-125`), so a campaign
     that stays stalled gets a new error each week, and the old one reads as resolved.
   - **Known in part:** the 7-day rule is documented (`docs/AI_AGENT_AUDIT.md:91`). Its effect on what a
     resolved error means is not.

## How to run it

```
npm run incident-trace -- --snapshot examples/incident-trace.example.json --job PaySimplePaymentSync
npm run incident-trace -- --snapshot examples/incident-trace.example.json --trace t-reese-1
npm run incident-trace -- --snapshot examples/incident-trace.example.json --error err-stalled
npm run incident-trace -- --snapshot examples/incident-trace.example.json --activity log-2
```

The example uses real agent names and timer lines at `c96f6a6`, with hand-written records. It holds one of
each case and is not production data. A snapshot missing any table is refused: a missing table is not an
empty one.

Exit codes:
- 0: traced
- 3: not traceable
- 4: nothing found, or no failure recorded
- 1: bad input

## Evidence

- **Named passing tests:**
  - "acceptance: where no trace exists for a failure, the answer is "not traceable: this job is untracked",
    never a narrative". It covers a job with no row, `trackAgentRun`, a director's gate and an unknown
    name, each with a failed row present that must not be cited.
  - "acceptance: no not-traceable answer cites a row it was not asked about, even one that looks related".
  - There are 9 tests in this file and 284 in the repo, all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - following the newest failed row when the job has no row fails 2;
  - treating `trackAgentRun` as recording fails 1, and a director's gate fails 1;
  - dropping AI calls from a trace fails 1;
  - following a row with no trace fails 2;
  - trusting an error link to an untraced row fails 1;
  - reading an auto-resolve as a fix fails 1;
  - not recognising a thrown failure fails 2, and a reported one fails 1;
  - reading AI calls alone as a trace fails 1;
  - losing the `CampaignHealthScanner` wording fails 1;
  - following the oldest failure fails 1;
  - accepting a missing table fails 1;
  - exiting 0 when not traceable fails 1;
  - dropping time order fails 1;
  - giving a cause for an untraced failed row fails 1, and for a job's untraced latest failure fails 1.
- **Not yet run on live records:** the first live check is one export of the four tables for a day, with
  the errors tab compared side by side.
