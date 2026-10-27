# No evidence is not health

A rule for anyone building a monitor, check, resolver or cleanup on the Colaberry platform.

## The rule

**A check may say "healthy" only when it holds recent, positive evidence of health. When it has no
evidence, it must say "unknown" and why.**

Across 25 findings, at least eight share one cause: something reported health it had not measured. Each
one looks green on a dashboard. None of them is visible until someone reads the code.

## The five shapes it takes here

Code references are to the platform repository at commit `a284987`.

1. **Silence reads as normal.** The verdict asks "did anything bad arrive?" instead of "did the check run?"
   - The security director says `normal` when no threat arrived in ten minutes, so a scanner that never
     ran keeps it green (`backend/src/services/agents/security/securityDirectorAgent.ts:63`, `:119-123`).
   - Supervisors allow one hour of silence for every agent, including one that runs every minute
     (`backend/src/services/agents/departments/superAgents/superAgentHealth.ts:99`).
2. **A failure is recorded as a success.** The job catches its own error, so its wrapper sees no failure.
   - The intelligence cleanup logs `RETENTION_ERROR` and returns normally (`backend/src/services/cory/intelligenceRetention.ts:152-158`).
   - The resilience supervisor always returns `errors: []` (`superAgents/systemResilienceSuperAgent.ts:15-17`).
   - The preview reaper catches each stop error, so the run still succeeds (`backend/src/services/previewStackReaper.ts:33-38`).
3. **A record says an action happened when it did not.** A preview stack is marked `stopped` even when
   `docker compose` failed (`backend/src/services/previewStackService.ts:305-307`).
4. **Absent evidence closes a ticket.** The resolver reads "the failure is gone" as "recovered".
   - A failing agent that was disabled closes as recovered (`backend/src/intelligence/autonomy/coryEngineTicketResolutionRules.ts:158-184`).
   - A lead query that failed returns no problems, which closes the ticket as cleared
     (`backend/src/intelligence/agents/ProblemDiscoveryAgent.ts:86-88`).
5. **Too little data reads as fine.** Zero is treated as a measurement.
   - An agent with 0 runs has a 0% error rate (`backend/src/services/company/workforceTicketAutoResolver.ts:82-89`).
   - Under 7 leads a week, the expected daily count rounds to 0, so a drop is never reported
     (`backend/src/intelligence/agents/ProblemDiscoveryAgent.ts:65`, `:72-73`; the resolver repeats it at
     `backend/src/intelligence/autonomy/coryEngineTicketAutoResolver.ts:69`).
   - A circuit breaker with fewer than 5 tasks reads `CLOSED` (`backend/src/services/agents/openclaw/openclawCircuitBreaker.ts:61-63`).

## How a check should answer when it has no evidence

- **Use three answers, not two:** healthy, problem, unknown. Unknown always carries its reason.
- **Healthy needs evidence you can name,** with its time and age. Judge age against the thing's own
  schedule (Ellis uses twice its interval), not one global window.
- **A rollup with any unknown part is unknown,** never healthy. List the known problems anyway.
- **A count you could not take is "not recorded",** never 0. A rate over zero runs is undefined, not 0%.
- **A job that caught an error reports failure** to whatever records the run: rethrow it or return it.
- **Closing a ticket needs evidence of recovery:** the thing ran and succeeded after the fix. The failure
  being absent is not enough.
- **Check what the action returned** before recording that it happened.

## How to test it

For every check, write one test that removes the signal and asserts the answer is not healthy. If a
check passes that test only by luck, it is not finished. Every Ellis capability carries this test, and
each one is checked by breaking the code and confirming the test fails.
