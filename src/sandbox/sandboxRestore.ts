import { existsSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Restores a SQL backup into a fresh SQLite database in its own sandbox folder, and runs known queries against it.
// Isolation is established before the restore begins. Nothing outside the folder is opened or written: a backup
// carrying a statement that could reach another file is refused before it runs.

// Statements that open or write another database file, or load code into the database. Temporary tables are kept in
// storage outside the database file, so they are refused too.
const REACHES_OUT = /\b(ATTACH|DETACH|VACUUM\s+INTO|load_extension|TEMP|TEMPORARY)\b/i;

export interface Isolation {
  folder_was_new_and_empty: boolean;
  target_inside_folder: boolean;
  target_did_not_exist: boolean;
  artefact_outside_folder: boolean;
  no_statement_reaches_out: boolean;
}
export const isolated = (i: Isolation) => Object.values(i).every(Boolean);

export interface Target { folder: string; path: string }

export function newTarget(sandboxRoot: string, name = 'restored.sqlite'): Target {
  const folder = realpathSync(mkdtempSync(join(resolve(sandboxRoot), 'restore-')));
  return { folder, path: join(folder, name) };
}

// Checked before the restore begins. Each fact is read from the filesystem or the backup, not assumed.
export function proveIsolation(t: Target, artefactPath: string, sql: string): Isolation {
  const folderReal = realpathSync(t.folder);
  const parentReal = existsSync(dirname(t.path)) ? realpathSync(dirname(t.path)) : null;
  return {
    folder_was_new_and_empty: readdirSync(folderReal).length === 0,
    target_inside_folder: parentReal === folderReal,
    target_did_not_exist: !existsSync(t.path),
    artefact_outside_folder: !realpathSync(artefactPath).startsWith(folderReal + sep),
    no_statement_reaches_out: !REACHES_OUT.test(sql),
  };
}

export interface Restore { restored: boolean; error: string | null }

// One transaction: a backup that stops partway leaves nothing behind, never half a database.
export function restore(t: Target, sql: string): Restore {
  const db = new DatabaseSync(t.path);
  try {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec('COMMIT');
      return { restored: true, error: null };
    } catch (err) {
      db.exec('ROLLBACK');
      return { restored: false, error: (err as Error).message };
    }
  } finally {
    db.close();
  }
}

export interface QueryResult { sql: string; rows: unknown[] | null; error: string | null }

export function runQueries(t: Target, queries: string[]): QueryResult[] {
  const db = new DatabaseSync(t.path, { readOnly: true });
  try {
    return queries.map((sql) => {
      try {
        return { sql, rows: db.prepare(sql).all().map((r) => ({ ...r })), error: null };
      } catch (err) {
        return { sql, rows: null, error: (err as Error).message };
      }
    });
  } finally {
    db.close();
  }
}
