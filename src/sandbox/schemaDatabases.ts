import { mkdtempSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Builds sandbox databases from DDL and reads their schema back from the database's own catalog, never from the DDL
// text. Each database is a SQLite file in a fresh folder under the sandbox root; nothing else is opened or written.

export interface Column { type: string; not_null: boolean; default: string | null; primary_key: boolean }
// An index is keyed by what it covers, because SQLite names the index behind a UNIQUE constraint itself.
export interface Table { columns: Record<string, Column>; indexes: string[] }
export type Schema = Record<string, Table>;

export function sandboxDir(sandboxRoot: string): string {
  return realpathSync(mkdtempSync(join(resolve(sandboxRoot), 'schema-')));
}

// Creates the database file and runs the DDL in it. A statement SQLite refuses is an error, never a partial schema.
export function buildDatabase(dir: string, name: string, ddl: string): string {
  const path = join(dir, `${name}.sqlite`);
  const db = new DatabaseSync(path);
  try {
    db.exec(ddl);
  } finally {
    db.close();
  }
  return path;
}

type Row = Record<string, unknown>;
export function readSchema(path: string): Schema {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const out: Schema = {};
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[];
    for (const { name } of tables) {
      const t = String(name);
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const columns: Record<string, Column> = {};
      for (const c of db.prepare(`PRAGMA table_xinfo(${q(t)})`).all() as Row[]) {
        columns[String(c.name)] = { type: String(c.type), not_null: c.notnull === 1, default: c.dflt_value === null ? null : String(c.dflt_value), primary_key: Number(c.pk) > 0 };
      }
      const indexes = (db.prepare(`PRAGMA index_list(${q(t)})`).all() as Row[]).filter((i) => i.origin !== 'pk').map((i) => {
        const cols = (db.prepare(`PRAGMA index_info(${q(String(i.name))})`).all() as Row[]).sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((c) => String(c.name));
        return `${i.unique === 1 ? 'unique ' : ''}(${cols.join(', ')})`;
      }).sort();
      out[t] = { columns, indexes };
    }
    return out;
  } finally {
    db.close();
  }
}
