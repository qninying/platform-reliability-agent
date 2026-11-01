# Backup and restore verification

**Story:** `platform.CAP.backup_and_restore_verification` · **Autonomy:** starts R0, first release R2, ceiling R3 · **Approver:** K.D.
**Code:** `src/capabilities/backupRestoreVerification.ts`, `src/cli/backupPosition.ts` · **Tests:** `test/backupRestoreVerification.test.ts`

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
