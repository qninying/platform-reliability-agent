# Reliability threshold ownership

**Story:** `platform.CAP.reliability_threshold_ownership` · **Autonomy:** starts R0, first release R2, ceiling R5 · **Approver:** K.D.
**Code:** `src/capabilities/reliabilityThresholds.ts`, `src/cli/reliabilityThresholds.ts` · **Tests:** `test/reliabilityThresholds.test.ts`

This first release puts the numbers that decide when the platform complains in one list: each value, its file and line,
how its alerts are delivered, and what it is producing. A number with no recorded alert outcomes is reported as
`unmeasured`, never as well-tuned. It changes nothing and proposes no number. Setting a threshold is K.D.'s decision at
every autonomy level, which is why the ceiling is R5 (`autonomyLadder.ts:170-176`).

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run reliability-thresholds -- --source <platform checkout> [--alerts <alerts.json>]
```

`--alerts` takes a saved `GET /api/admin/alerts` response with `captured_at` added. The route returns 50 rows unless asked
for more (`backend/src/routes/admin/alertRoutes.ts:23`), so ask for every row. Saved responses stay out of this repository.

Exit code 4 while anything is unmeasured or sits outside the inventory, 5 when the inventory could not be read, 1 for bad
input, 0 otherwise.

## How it decides

The inventory is a fixed list of 31 numbers in `src/capabilities/reliabilityThresholds.ts`. It holds what to look for, and
the value and line are read from the checkout on every run. This matters: the two-hour system health cooldown was
hand-cited as `schedulerService.ts:3281-3289`, and at `bbde6ef` it sits at line 3343.

A number that cannot be found, or that matches twice, is kept in the list and makes the inventory incomplete. A run never
quietly gets shorter.

Each number is delivered one of four ways, and that decides what can ever be known about it.

| Delivery | Means | What can be measured today |
|---|---|---|
| `alert_table` | Raised through `emitAlert`, stored with a status (`alertService.ts:206-237`) | Volume and closures, given a saved alert record |
| `email_only` | Sent directly, nothing stored (`reliabilityAlertingService.ts:80`, `schedulerService.ts:3401`) | Nothing |
| `dead_letter_row` | Writes a dead-letter row, raises no alert (`deadLetterService.ts:17`) | Nothing about outcomes |
| `response_only` | A flag computed on each read (`cbSystemRoutes.ts:181-190`) | Nothing |

## What each number reports

| State | Reason | Means |
|---|---|---|
| `unmeasured` | `no_outcome_record_exists` | The delivery path stores no outcome |
| `unmeasured` | `no_alert_record_read` | Outcomes may exist, and no alert record was given |
| `unmeasured` | `not_attributable_to_alert_titles` | The number shapes every alert, so no rows belong to it alone |
| `unmeasured` | `nothing_fired_in_record` | A full record shows nothing fired. Silence is not evidence |
| `unmeasured` | `not_in_a_partial_record` | The record is cut short, so absence says nothing |
| `unmeasured` | `fired_with_no_outcome` | It fired and nobody closed it. That is volume, not measurement |
| `outcomes_recorded` | | Some alerts were resolved or dismissed. Counts are given |

`false_positive_rate` is null in every case. A dismissal records that a person closed an alert, not that it was false.

## Ownership

A source comment naming someone's decision is reported as a claim, with its line. It is not reported as a review.
`owner_review_on_record` is false for every number, because the platform has nowhere to record one. A number recorded as
somebody's discretion and never reviewed by them is an unowned number wearing an owner's name, and this keeps the two
apart.

## Other things in the answer

- **Same kind of number, different values.** Error-rate limits, minimum samples and cooldowns are shown side by side where
  services set them differently. Windows and status flags are left out, because their units differ.
- **Outside the inventory.** A sweep lists threshold-shaped constant names in alerting files that are not on the list.
  A person decides whether each one belongs. If the sweep cannot finish, the inventory reports incomplete.
- **No proposals.** `proposals_in_this_release` is 0, with the reason: no false-positive rate exists to base one on.

## Limits, stated in every answer

- No false-positive rate exists, so none is given.
- Incident detection latency is not measured. Nothing links an alert to the incident it caught or missed.
- Unmeasured does not mean badly tuned. There is no evidence either way.
- A threshold that fired nothing may be well set or may be missing incidents.
- The inventory can fall behind the platform. The sweep reads names only, in alerting files only.
- Owner claims come from source comments.
- The source shows the number in the commit read, not the running deploy.

## Evidence

- **Acceptance:** `each threshold is reported with its source file and line` and
  `a threshold whose alert outcomes were never recorded is reported as unmeasured, not as well-tuned` in
  `test/reliabilityThresholds.test.ts`. 21 tests.
- **Each rule can fail:** 39 of 39 deliberate breaks were caught, after two that survived the first valid pass led to
  stronger tests.
- **On the real source:** run at `bbde6ef`, it read all 31 numbers across 7 files and reported all 31 unmeasured (18 with no
  alert record read, 13 with no outcome record possible), 17 owner claims with no review, 14 numbers naming no owner, and
  20 names outside the inventory. Exit 4. Run again at upstream `5ec9750`, every value and line matched.
- **Not done:** no production alert record has been read, so no real volume is reported. K.D. has not yet decided which of
  the 20 outside names belong. No threshold has an owner decision on record. The proposal and shadow-replay rungs are not
  built.
