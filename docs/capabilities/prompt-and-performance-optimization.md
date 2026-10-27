# Prompt and performance optimisation

**Story:** `platform.CAP.prompt_and_performance_optimization` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/promptPerformance.ts` · **Tests:** `test/promptPerformance.test.ts`

Ellis answers **"which prompts cost the most, which are slowest, and which have open change proposals?"**
from recorded runs.

**Adopting a prompt change is a human decision at every autonomy level.** Ellis measures and ranks. It
proposes nothing and adopts nothing, and shipping a prompt needs a deploy that a person performs.

Platform facts cite the public Colaberry platform repository at upstream commit `8c16250`.

## How the answer is decided

**A prompt is a prompt version on recorded model calls.** Each call through the platform's instrumented
client writes an `ai_events` row (`llm.call`) with its cost, duration and outcome, and the prompt version in
`metadata.prompt_version` (`backend/src/services/openaiInstrumented.ts:57-97`,
`backend/src/services/aiEventService.ts:160-164`).

**Every figure traces to recorded runs.** For each prompt, Ellis reports:
- total and per-run cost;
- p50 and p95 latency;
- failures;
- the ids of the exact runs each figure was computed from.

**No runs is unknown, never zero.** A known prompt with no recorded runs in the window has no cost and no
latency, and is listed as not ranked. Otherwise it would rank as the cheapest and fastest prompt.

Missing data is said, not filled in:
- **A run with no cost is not free.** A streamed call carries no usage (`openaiInstrumented.ts:57-65`) and a
  failed call records no cost. Ellis marks the figure `partial` and calls the total a floor. If no run has a
  cost, the cost is `unknown`.
- **Bad data is excluded and counted:** duplicates, unreadable times, and runs outside the window or in the
  future. A negative cost does not count as a measurement. A recorded cost of 0 does count.
- **Calls that name no prompt** are counted with their cost, so the reader sees how much spend cannot be
  attributed.
- **Proposals:** with no proposal record, open proposals are `unknown`. When proposals are exported, each
  open one says whether it has a before-measurement. A change without one is a guess.

## What the code showed

None of these is a live risk.

**New: reporting gaps with no runtime consequence**

1. **A loop whose every step failed is recorded as a success.** MetaAgentLoop catches each of its four
   steps' errors, logs a warning and carries on with zeros (`backend/src/intelligence/meta/metaAgentLoop.ts:33`,
   `:41`, `:49`, `:57`). Its tracker records success unless the run throws
   (`backend/src/services/agentRunTracker.ts:40`). This is shape 2 on the
   [no-evidence page](../no-evidence-is-not-health.md).
2. **Experiments change nothing, and "adopted" means the numbers drifted.** Every experiment starts with an
   empty variant (`backend/src/intelligence/meta/experimentAgent.ts:147`). After 24 hours it is "adopted"
   if the agent's success rate or duration happened to improve (`:225`), and the loop logs "Adopted N
   improvement(s)" (`:283-286`). Experiments are held in server memory (`:59`), so a restart loses them.
3. **Prompt proposals are fixed sentences, kept only in vector memory.** The header says the agent uses a
   model to propose improved prompts (`promptOptimizationAgent.ts:2`). The proposals are three fixed
   strings, such as "Review error patterns and add defensive checks or retry logic" (`:62`, `:74`, `:94`).
   They are stored only in vector memory (`:109`), so there is no record of an open proposal against a
   prompt.
4. **The low-confidence check never fires.** It reads `avg_confidence` (`promptOptimizationAgent.ts:52`), and
   nothing writes that field: the performance step leaves it out (`performanceAgent.ts:74-86`).
5. **The loop measures no cost, and reads no runs as zero.** Its metrics come from activity logs, with no
   tokens or cost. An agent with no recorded durations gets an average of 0, not unknown
   (`performanceAgent.ts:54-56`). Skipped runs count against the success rate (`:51`, `:63`), so an agent
   that was correctly skipped looks like it is failing.
6. **The one-minute "prompt monitor" checks references, not behaviour.** PromptMonitorAgent checks that
   course prompt templates are active and referenced correctly, and counts prompt error events in the
   last hour (`backend/src/services/agents/promptMonitorAgent.ts:29-59`, `:169-171`). It does not look at
   prompt outputs, cost or latency. Running it every minute (`aiOpsScheduler.ts:203`) checks templates that
   change rarely.

**Already known**

7. **Some model calls record no cost at all.** 12 places in `backend/src` create a raw OpenAI client, bypassing the
   instrumented one. The platform's trust audit tracks this as P1-2 (`docs/trust-audit/gap-analysis.md:24`).
8. **Few calls name their prompt.** About 11 of 113 instrumented call sites pass a prompt version. The trust
   audit tracks prompt versioning as P2-3 (`gap-analysis.md:37`). Ellis reports the untagged share in every
   answer.
9. **PerformanceAgent and PromptOptimizationAgent are steps inside MetaAgentLoop,** not agents that can run
   on their own. The platform's cron baseline already records this
   (`backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts:85`, `:90`), and so does the brief.

Before a prompt change can be judged at all, K.D. has to state the quality bar it must clear. "Better" is
not defined for this loop yet.

## How to run it

```
npm run prompt-performance -- --snapshot examples/prompt-performance.example.json
```

The example is not production data. The prompt versions are real ones from the platform's instrumented call
sites; the runs are illustrative. It shows:
- a fully measured prompt (`landing-page-draft-v6`);
- two prompts with a run that has no cost, so their totals are floors;
- two known prompts with no runs, reported as unknown;
- two calls that name no prompt;
- no proposal record.

Exit codes:
- 0: every prompt fully measured
- 3: any figure partial or unknown
- 1: bad input

## Evidence

- **Named passing test:** "acceptance: every cost or latency figure traces to recorded runs; a prompt with
  no recorded runs reports unknown rather than zero". There are 11 tests in this file and 194 in the repo,
  all passing under `npm test`.
- **The tests catch defects.** Each check was done by editing the code, running the tests and restoring
  the code:
  - reporting no runs as zero cost fails 2;
  - reporting no runs as zero latency fails 2;
  - counting uncosted runs as zero fails 2;
  - reporting a partial figure as measured fails 2;
  - not listing unmeasured prompts fails 1;
  - ranking unmeasured prompts fails 2;
  - an off-by-one percentile fails 1;
  - counting future runs fails 1;
  - counting duplicates fails 1;
  - reading a missing proposal record as "none open" fails 1;
  - accepting a before-measurement over no runs fails 1;
  - listing closed proposals as open fails 1;
  - dropping prompts seen only in runs fails 1;
  - citing uncosted runs for a cost figure fails 1;
  - accepting a negative cost fails 1;
  - dropping the "floor" warning fails 1;
  - not reporting untagged calls fails 1.
- **Not yet run on live records.** K.D. cannot open the activity surface (`backend/src/routes/admin/aiOpsRoutes.ts:52`).
  The first live check is one export of `llm.call` rows from `ai_events` for the last 7 days.
