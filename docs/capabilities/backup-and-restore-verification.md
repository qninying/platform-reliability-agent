# Backup and restore verification

**Story:** `platform.CAP.backup_and_restore_verification` · **Autonomy:** starts R0, first release R2, rung R3 built in a sandbox, ceiling R3 · **Approver:** K.D.
**Code:** `src/capabilities/backupRestoreVerification.ts`, `src/cli/backupPosition.ts` (R2), `src/sandbox/sandboxRestore.ts`, `src/capabilities/restoreRehearsal.ts` (R3) · **Tests:** `test/backupRestoreVerification.test.ts`, `test/restoreRehearsal.test.ts`

This first release states the recovery position and shows the search behind it. Today that position is
`unknown, no backup verification exists in this repository`. It takes no backup and restores nothing. Taking, reading
or restoring a production backup stays a person's at every autonomy level, and an agent cannot do it anyway:
`production_database` is default-denied (`delivery/execution/executionPolicy.ts:35`).

Platform facts cite the public Colaberry platform repository at upstream commit `bbde6ef`.

## How to run it

```
npm run backup-position -- --source <platform checkout>
```

Exit code 4 when nothing was found and the search was complete, 3 when lines need a person to read them, 5 when the
search could not establish anything, 1 for bad input.

## How it decides

The position is `unknown` on every path in this release. No record of a completed restore exists to read, so nothing
can move it. What changes is the reason.

| Basis | Means | Statement |
|---|---|---|
| `nothing_found` | The search was complete and no line runs a data backup or restore | `unknown, no backup verification exists in this repository` |
| `candidates_need_a_person` | A line may run one. It is listed for a person, never taken as a backup | `unknown, N line(s) may be a backup or restore and need a person to read them` |
| `search_incomplete` | A root or file could not be read, or the known `pg_dump` was not found | `unknown, the search could not establish anything` |

**An absence needs a control.** A broken search also finds nothing. So the search must first find the one `pg_dump` known
to exist, the schema-only one at `scripts/syncDevSchemaFromProd.sh:110`. If it does not, Ellis claims no absence.

## What the search reads

Eight roots (`backend/src`, `scripts`, `directives`, `docs`, `execution`, `nginx`, `preview-db-init`, `.github`), plus the
compose files and `package.json`, in text files only. It leaves out the capability records, which hold this story's own
wording, and `docs/sessions/`. The answer carries the terms, roots, exclusions and file count.

Each hit on a dump or restore tool gets one kind:

| Kind | Means |
|---|---|
| `schema_only` | Runs with `--schema-only` or `-s`, so it copies no data |
| `prose` | A comment, a log line, a string or a document |
| `test` | In a test file |
| `candidate` | Anything else, including `spawn('pg_dump', ...)` broken over lines |

Everything except a candidate is listed under `not_evidence`, so a reader can check the call instead of trusting it.

## Claims in the repository

The platform's own documents disagree, and the answer lists them as written. `docs/spec/out-of-scope-nfrs.md:37` says
recovery is "git history + Postgres snapshots". `scripts/artifacts/tickets/c77Data.js:57` says there is no database
backup of any kind. Ellis does not choose between them, because neither is a restore.

## What would count

A restore counts only if all three hold, and the answer states them every time:

1. It completed, and the restored database answered a known query. A file existing, or its size, proves nothing.
2. The target was isolated. A restore over anything live is the incident this exists to prevent.
3. The credential master key was available too. The tokens in a database backup cannot be read without it
   (`backend/src/scripts/generateCredentialMasterKey.ts:15-18`).

## The policy comes first

The recovery objective, destination and cadence are undefined, so there is nothing to verify against. K.D. and A.M. need
to agree them. The answer leaves all three null and records nobody as having agreed.

## Limits, stated in every answer

- This is about this repository. It does not say no backup exists: a host job, a provider snapshot or a copy taken by
  hand would not appear here.
- The crontab is held in no repository (`PROGRESS.md:11985`), so a backup job could run on the host unseen. Another
  system shares that host (`PROGRESS.md:11984`), and a backup script of its own is not this platform's.
- Claims are listed as written, not judged.
- Prose and tests are read by line shape, so a hit can be misread. A candidate needs a person.
- A hit outside the searched roots and file types is not seen.

## Evidence

- **Acceptance:** `with no backup job the answer is the exact unknown, with the search that establishes it` and
  `pg_dump in unrelated scripts is listed as not evidence and never moves the position` in
  `test/backupRestoreVerification.test.ts`. 23 tests.
- **Each rule can fail:** 38 of 38 deliberate breaks were caught, after three that survived the first valid pass led to
  stronger tests.
- **On the real source:** run at `bbde6ef`, it read 7,951 files, found the control, classified 8 hits (1 schema-only,
  6 prose, 1 test), found 0 candidates and listed 6 claims. It answered the exact statement, exit 4.
- **Not done:** no backup policy exists, nobody has checked the host for backups, and the R3 sandbox restore is not built.

## R3: a supplied backup, restored into an isolated sandbox target

The rung's acceptance: **a deliberately truncated artefact fails the restore assertion, the positive control that
the check can fail; and the restore target is proven isolated before the restore begins.**

`npm run restore-sandbox -- --fixture examples/backup/restore.fixture.json --sandbox <empty dir> --operator <name>`
(exit 0 verified, 3 not, 1 bad input). A run without `--operator` is refused.

The R2 answer is unchanged: the platform's recovery position is unknown, because no backup verification exists.
This rung builds the check a person could run once there is a backup to verify. A person supplies the backup; Ellis
never takes or reads one.

**Isolation, proven before the restore begins.** Each attempt gets a fresh folder. Before anything is restored,
Ellis reads, not assumes, that the folder was new and empty, the target resolves inside it, nothing exists at the
target, the backup lies outside it, and no statement in the backup could reach another file (`ATTACH`, `DETACH`,
`VACUUM INTO`, `load_extension`, or a temporary table, which SQLite keeps outside the database file). If any fails,
the restore is never begun and nothing is written. The restore is one transaction, so a backup that stops partway
leaves no table behind. The known queries run on a read-only connection.

**The assertion.** The restored database must answer each known query with exactly the rows the fixture expects:
6 agents, the 2 disabled ones by name, and the 2 unresolved dead-letter jobs by name and class.

| Attempt | Bytes | Restored | Answered |
|---|---|---|---|
| the backup as supplied | 2,004 | yes | **all 3 queries** |
| cut inside a statement | 1,350 | **no**: incomplete input | |
| cut after every statement but the last | 1,858 | **yes, with no error** | **wrongly**: one unresolved dead-letter job, not two |

The second truncated copy is the point of the control. It restores cleanly, so a check that only asks whether the
restore succeeded would pass it. Only a query whose answer depends on the lost rows catches it, and a fixture without
one is not verified.

**What this does not prove.**
- The backup is SQL restored into SQLite. A platform backup is a Postgres dump restored with Postgres tools; restoring
  one needs both, and the artefact needs `production_database`, which is default-denied.
- The known queries are the fixture's. A real verification needs queries K.D. and A.M. agree answer for the platform,
  alongside the recovery objective, destination and cadence they have not set.
- A restore that answers its queries shows the backup holds those answers, not that it is current, complete beyond
  what is queried, or taken on schedule.
- The reach-out check reads the backup's text, so a value that merely contains one of those words is refused too:
  it errs toward refusing.
- Taking, reading and restoring a production backup, and keeping or rotating backups, are a person's actions.

**Tested:** 9 tests, including the acceptance test named after the criterion. 44 deliberate breaks: 43 caught.
- **Removed.** A check that each database held only its own schema after the restore. It could not fail: a
  temporary schema closes with its connection, and `ATTACH` is refused before the restore. Temporary tables are
  now refused before the restore instead.
- **Tests added.** That the reach-out check ignores case, that a query cannot write, that a cut landing in a comment
  restores and passes a query blind to the lost rows (so the control can fail), and that a missing backup is
  `SourceUnavailable`.
- **The survivor.** Removing the explicit rollback changes nothing: closing the connection without a commit
  discards the transaction anyway. It stays for the reader.

Its rung story id is on the platform board but not yet in this repository's plan, so it is recorded here and in the
commit.
