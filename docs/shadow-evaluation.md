# Shadow evaluation (R5 groundwork)

**Status:** the harness is built and tested. No capability is in shadow mode yet: K.D. has not set the limits, and
no approved reference outcomes have been recorded. Nothing here claims an R5 rung.
**Code:** `src/shadow/shadowEvaluation.ts`, `src/cli/shadowEvaluation.ts` · **Limits:** `governance/shadow-criteria.json`
(owner K.D.) · **Tests:** `test/shadowEvaluation.test.ts`

The platform defines R5 as *evaluate in shadow mode against approved reference outcomes*
(`autonomyLadder.ts`, `AUTONOMY_MEANINGS`). In shadow mode Ellis gives its verdict as usual, nobody acts on it,
and each verdict is later compared with an approved reference outcome for the same subject and time, such as
the platform's own check after a person has reviewed it. This harness does that comparison. It does not choose
the limits, approve references, or promote anything.

## What it reports, per tool

| Outcome | Ellis said | Approved reference | Counts as |
|---|---|---|---|
| caught | problem | problem | agreement |
| agreed ok | ok | ok | agreement |
| miss | ok | problem | miss |
| unseen problem | unknown or partly unknown | problem | **miss**: the problem was not caught |
| false alarm | problem | ok | false alarm |
| unknown on ok | unknown or partly unknown | ok | reported apart; not a false alarm |

- **Miss rate** is misses and unseen problems over all reference problems. **False alarm rate** is false alarms
  over all reference oks. Each rate is given with its numerator and denominator.
- The observation ids behind every miss and false alarm are listed, so a person knows what to review first.

## Rules the code enforces

- **Only approved references count.** A reference with no named approver, or no reference at all, is listed as
  unreferenced and never scored.
- **No rate from nothing.** With no reference problems in the window, the miss rate is `null` with the reason,
  never 0%. The same applies to false alarms.
- **No judgement without K.D.'s limits.** A tool is `meets` or `does_not_meet` only against its
  `max_miss_rate`, `max_false_alarm_rate` and `min_observations` in `governance/shadow-criteria.json`. With any
  of them unset, the tool is `not_judged` and the report names which ones are missing. Today all of them are
  unset for all eight tools listed, so every run is `not_judged`.
- **A rate at the limit meets; above it does not.** The run as a whole meets only if every tool meets.
- **Acts on nothing.** The report carries `mode: "shadow"` and `acted_on: false`. The function reads two inputs
  and returns a report.
- **Idempotent.** The same observations in any order give the same report. A repeated observation id is refused,
  because counting it twice would skew every rate.
- **Contract.** An observation must name its tool, subject and time. Ellis's output must come from that tool and
  carry a shared verdict, and a `problem` or `ok` must cite a row. A reference is `problem` or `ok` with a
  source. Limits must be rates from 0 to 1 and a whole number of observations. Anything else is a
  `ContractViolation`.

## How to run it

```
npm run shadow-evaluation -- --observations examples/shadow-observations.example.json
npm run shadow-evaluation -- --observations <file> --criteria <limits.json>
```

Exit code 0 when every tool meets K.D.'s limits, 4 when any does not, 3 when not judged, 1 for bad input.
The example is invented to show the shape, and exits 3 under the shipped limits.

## Failure paths

| What goes wrong | What happens |
|---|---|
| Observations file missing or unreadable | exit 1, `SourceUnavailable` |
| Not JSON, or no `observations[]` | exit 1, `ContractViolation` |
| A malformed observation, repeated id or out-of-range limit | exit 1, `ContractViolation` naming it |
| Limits not set, too few observations, or an empty denominator | exit 3, `not_judged` with the reasons |

## What it does not do yet

- **Collect observations.** Pairing a recorded Ellis output with an approved reference depends on live exports
  (waiting on A.M.'s approval) and on someone approving references. Until then, the inputs are files.
- **Set or suggest limits.** Choosing the acceptable misses and false alarms is K.D.'s decision.
- **Weigh severity.** Every miss counts the same. Once K.D.'s severity table has rules, missing a Critical could
  be scored apart from missing a Low; that is a decision for K.D., not a default.

## The tests catch defects

Each key rule was broken in the code, and a named test failed every time before the code was restored
([decision 004](decisions/004-prove-each-test-can-fail.md)). 14 mutations, 14 caught:

| Mutation | Tests failing |
|---|---|
| An unapproved reference is scored | 1 |
| An unknown on a real problem is not counted as a miss | 1 |
| An empty denominator gives a 0% rate | 2 |
| Unset limits are treated as set | 3 |
| A repeated observation id is allowed | 1 |
| Observations are not sorted by id | 1 |
| Tools are not sorted | 1 |
| A rate exactly at the limit fails | 1 |
| The minimum number of observations is ignored | 1 |
| One tool meeting its limits is enough for the run | 1 |
| A verdict that cites no row is scored | 1 |
| An unknown on an ok is counted as a false alarm | 2 |
| The report says it acted | 2 |
| Ellis's output from a different tool is accepted | 1 |

The first run of the sort mutation was not caught: the idempotency test had only one miss, so order could not
show. The test now holds two misses and two unreferenced observations across two tools.
