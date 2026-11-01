# Schema drift detection

**Story:** `platform.CAP.schema_drift_detection` · **Autonomy:** starts R0, first release R2, ceiling R3 · **Approver:** K.D.
**Code:** `src/capabilities/schemaDriftDetection.ts`, `src/cli/schemaDrift.ts` · **Tests:** `test/schemaDriftDetection.test.ts`

This first release reports what the latest nightly drift run found and names what that run never compares. It
changes no schema. Applying a schema change, or re-syncing development, stays a person's decision at every autonomy
level.

Ellis cannot read the production schema: `production_database` is default-denied
(`delivery/execution/executionPolicy.ts:35`). So it reads a copy of the log the nightly script leaves, and the
platform source. Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run schema-drift -- --source <platform checkout> [--log <copy of schema-drift.log>] [--captured-at <ISO date>] [--max-age-hours 26]
```

Exit code 0 when a fresh run reported none, 3 when drift is reported, 4 when the answer is unknown, 1 for bad input.
`examples/schema-drift.example.log` shows the log format.

## How it decides

The script only speaks when it finds drift, so silence could mean agreement or could mean nothing ran. Ellis never
treats silence as agreement.

| Verdict | Means |
|---|---|
| `drift_reported` | The latest completed run named missing tables, enum types or columns. Each one is listed |
| `no_drift_reported` | A completed run within the last 26 hours reported none, and no later attempt failed. Scoped to the measured axes |
| `unknown` | Ellis cannot say, and says why |

**Reasons the answer is unknown**

| Reason | Means |
|---|---|
| `log_not_supplied` | No log was given. The statement is `unknown, last run not found` |
| `no_completed_run` | The log holds no finished run. Same statement |
| `last_attempt_incomplete` | The newest attempt never finished its comparison |
| `last_run_stale` | The last completed run said none, but it is older than the limit |

Stale drift stays reported, with a note that it may not be current: drift does not clear itself by going quiet.

## What counts as a completed run

The real `schemaDriftCheck.sh` and `syncDevSchemaFromProd.sh` were run, unchanged, against a stand-in `docker` to see
what they write. The test fixtures are that output.

| Situation | What the script logs | What Ellis reports |
|---|---|---|
| Databases match | `schema-drift: none` | `none` |
| Real drift | `DETECTED`, three sections, a closing `DRY-RUN:` line | `detected`, with every item |
| Database unreachable | `DETECTED`, with only a header under it | `incomplete`, not drift |
| Report cut short | `DETECTED`, with no `DRY-RUN:` line | `incomplete`, not drift |
| Column or enum read fails | `none` | `none`. See the first limit below |

The script decides "clean" only by finding the words `already schema-faithful`
(`scripts/schemaDriftCheck.sh:35`), so anything else logs `DETECTED`, including a run that compared nothing. A
finished report ends with the `DRY-RUN:` line (`scripts/syncDevSchemaFromProd.sh:115`). Without it, or without all
three sections, the run is incomplete.

The answer also carries the alert result: `sent`, `failed` or `not_recorded`. A failed alert does not fail the job
(`schemaDriftCheck.sh:64`, `:71`), so the log is the only place that shows it. The recipient address is left out.

## What is not measured

Each axis is read from the script's own code on every run, so the list changes if the script changes. A helper Ellis
cannot find reads as `not_read`, never as measured.

| Axis | Status at `bbde6ef` | Why |
|---|---|---|
| `dev_behind_prod_names` | Measured | Tables, enum types and column names on production, missing on development |
| `dev_ahead_of_prod` | Not measured | Only production minus development is taken (`syncDevSchemaFromProd.sh:68`, `:69`, `:74`). The platform chose this on purpose (`PROGRESS.md:10663`), but the story asks about a column in one environment and not the other, so this direction is named |
| `column_shape` | Not measured | Columns compare by name, so a changed type, nullability or default is not seen (`:56`) |
| `enum_values` | Not measured | Enum types compare by name, so an added value is not seen (`:51`) |
| `indexes_and_constraints` | Not measured | Not compared on a table that exists on both sides |
| `code_versus_database` | Not measured | Neither database is compared with the models or the ensure-schema modules |
| `excluded_names` | Not measured | Names matching `_legacy_\|_backup_\|_bak$` are left out of the table and column comparison (`:42`) |

## The boot reconciler

The answer lists the models the boot reconciler protects, read from the call at `backend/src/server.ts:3200`. At
`bbde6ef` that is 10 models, and none of `AiAgent`, `CronScheduleConfig`, `AiAgentActivityLog` or `DeadLetterJob` is
among them, so a new column on those tables depends on its ensure-schema module. The reconciler only adds nullable
columns (`backend/src/config/schemaReconcile.ts`).

The story's figures were written against an older commit. It cites a `CRITICAL_MODELS` list of 8 at `server.ts:3074`;
the list is now 10 models inline in the call, and there are 120 ensure-schema modules, not about 105. Ellis reads both
from source, so these figures stay current. The story also says there is no migrations directory, while
`backend/src/seeds/migrations/` holds SQL files. This capability does not read them.

## Limits, stated in every answer

- A `none` entry is not proof of agreement. When the column or enum read fails, the script still logs `none`, and the
  log cannot show it. Both cases were confirmed with the stand-in. Those reads run in process substitutions, where
  `set -e` does not stop the script (`syncDevSchemaFromProd.sh:69`, `:74`).
- Every answer covers the measured axes at the stamp of the last completed run, and nothing after it.
- The crontab is held in no repository (`PROGRESS.md:11985`), so source cannot prove the nightly job is installed.
  Only dated log entries show it ran.
- Ellis reads a log copy supplied by a person, and never re-checks an entry against production.
- A column whose type could not be read is dropped from the report without a warning (`syncDevSchemaFromProd.sh:81`).
- Whether `SCHEMA_RECONCILE` is on in production (`server.ts:3182`), and what each boot healed, is not read.

## Evidence

- **Acceptance:** `with no log the answer is unknown, last run not found, never no drift`, plus the empty-log and
  never-compared tests in `test/schemaDriftDetection.test.ts`. 30 tests.
- **Each rule can fail:** 43 of 43 deliberate breaks in the capability and CLI were caught. Four survived the first
  pass of 44; the tests were strengthened for three, and one break was removed along with a redundant filter.
- **On the real source:** run at `bbde6ef`, it read 1 measured axis, 6 not measured, 10 protected models with no domain
  model among them, and 120 ensure-schema modules. With no log it answered `unknown, last run not found`, exit 4.
- **Not done:** it has never read the real production log. Someone with VPS access needs to supply a copy of
  `/var/log/schema-drift.log`. The R3 sandbox comparison is not built.
