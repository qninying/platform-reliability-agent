// platform.schema_drift_detection, rung R3: runs an operator-initiated schema comparison between two sandbox
// databases and reports the differences in both directions: tables, columns, column type, nullability, default and
// indexes. Each database is built from DDL and read back from its own catalog. Planted changes to the compared
// database must each be reported exactly, so a spurious difference fails the plant it appears in. The additive-only view the platform's tools take runs beside it as the
// contrast: it reports only names the compared database lacks, so it misses a type change.
// Sandbox only: nothing runs on the platform, and no schema is changed anywhere but in the sandbox databases.
//
// Platform facts this rests on (platform repo, commit a29dfb245):
// - The boot reconciler diffs a model's attributes against the live columns and only adds the missing ones, always
//   nullable (backend/src/config/schemaReconcile.ts:22, :51-70).
// - The nightly drift check takes only production minus development, by name: tables, enum types and column names
//   (scripts/syncDevSchemaFromProd.sh:56, :68-74). A changed type is not seen.
// - The sandbox tables are modelled on AiAgent, CronScheduleConfig and DeadLetterJob (backend/src/models/).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { buildDatabase, readSchema, sandboxDir, type Schema } from '../sandbox/schemaDatabases.ts';

export const PINNED_AT = 'a29dfb245';
export const LIMITS: readonly string[] = [
  'The sandbox databases are SQLite, built from DDL modelled on three platform tables. The platform runs Postgres, whose catalog also carries enum values, constraints and column types SQLite does not check. Those are not compared here.',
  'A type is compared as declared. Two spellings of one type, such as VARCHAR(100) and CHARACTER VARYING(100), would be reported as a change.',
  'Comparing a production database needs production_database, which is default-denied. This comparison runs only on databases a person points it at in a sandbox.',
  'A difference is reported, never fixed. Changing a schema is a person\'s decision at every autonomy level.',
];

export type Kind = 'table_only_in_reference' | 'table_only_in_compared' | 'column_only_in_reference' | 'column_only_in_compared' | 'column_type_changed' | 'nullability_changed' | 'default_changed' | 'index_only_in_reference' | 'index_only_in_compared';
export const KINDS: Kind[] = ['table_only_in_reference', 'table_only_in_compared', 'column_only_in_reference', 'column_only_in_compared', 'column_type_changed', 'nullability_changed', 'default_changed', 'index_only_in_reference', 'index_only_in_compared'];
export interface Difference { kind: Kind; table: string; item: string | null; reference: string | null; compared: string | null }

const d = (kind: Kind, table: string, item: string | null = null, reference: string | null = null, compared: string | null = null): Difference => ({ kind, table, item, reference, compared });
const only = <T>(a: Record<string, T> | string[], b: Record<string, T> | string[]) => {
  const keys = (x: Record<string, T> | string[]) => (Array.isArray(x) ? x : Object.keys(x));
  return keys(a).filter((k) => !keys(b).includes(k)).sort();
};

// Every difference between the two schemas, in both directions.
export function compare(ref: Schema, cmp: Schema): Difference[] {
  const out: Difference[] = [
    ...only(ref, cmp).map((t) => d('table_only_in_reference', t)),
    ...only(cmp, ref).map((t) => d('table_only_in_compared', t)),
  ];
  for (const t of Object.keys(ref).filter((x) => x in cmp).sort()) {
    const a = ref[t], b = cmp[t];
    out.push(...only(a.columns, b.columns).map((c) => d('column_only_in_reference', t, c)), ...only(b.columns, a.columns).map((c) => d('column_only_in_compared', t, c)));
    for (const c of Object.keys(a.columns).filter((x) => x in b.columns).sort()) {
      const x = a.columns[c], y = b.columns[c];
      if (x.type !== y.type) out.push(d('column_type_changed', t, c, x.type, y.type));
      if (x.not_null !== y.not_null) out.push(d('nullability_changed', t, c, x.not_null ? 'not null' : 'null', y.not_null ? 'not null' : 'null'));
      if (x.default !== y.default) out.push(d('default_changed', t, c, x.default, y.default));
    }
    out.push(...only(a.indexes, b.indexes).map((i) => d('index_only_in_reference', t, i)), ...only(b.indexes, a.indexes).map((i) => d('index_only_in_compared', t, i)));
  }
  return out;
}

// The additive-only view: names the compared database lacks, which is all a tool that only adds can act on.
export const additiveOnly = (ref: Schema, cmp: Schema): Difference[] =>
  compare(ref, cmp).filter((x) => x.kind === 'table_only_in_reference' || x.kind === 'column_only_in_reference');

export interface Edit { find: string; replace: string }
export interface Plant { id: string; what: string; edits: Edit[]; expect: Difference[] }
export interface CompareFixture { fixture_id: string; description: string; reference_ddl: string; plants: Plant[] }

export function plantDdl(ddl: string, edits: Edit[]): string | { missed: string } {
  let out = ddl;
  for (const e of edits) {
    const at = out.indexOf(e.find);
    if (at === -1 || out.indexOf(e.find, at + 1) !== -1) return { missed: `the passage to replace ${at === -1 ? 'is not in the DDL' : 'appears more than once'}` };
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}

const key = (x: Difference) => [x.kind, x.table, x.item, x.reference, x.compared].join('|');
const same = (a: Difference[], b: Difference[]) => JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());

export interface PlantResult { id: string; what: string; missed: string | null; differences: Difference[] | null; additive_only: Difference[] | null; expect: Difference[] }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  initiated_by: string;
  databases: string[];
  plants: PlantResult[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: CompareFixture, sandboxRoot: string, operator: string): Rehearsal {
  if (!operator.trim()) throw new SandboxError('ContractViolation', 'a comparison is started by a named operator');
  const dir = sandboxDir(sandboxRoot);
  const databases = [buildDatabase(dir, 'reference', fx.reference_ddl)];
  const ref = readSchema(databases[0]);
  const plants = fx.plants.map((p): PlantResult => {
    const base = { id: p.id, what: p.what, expect: p.expect };
    const ddl = plantDdl(fx.reference_ddl, p.edits);
    if (typeof ddl !== 'string') return { ...base, missed: ddl.missed, differences: null, additive_only: null };
    const path = buildDatabase(dir, `compared-${p.id}`, ddl);
    databases.push(path);
    const cmp = readSchema(path);
    return { ...base, missed: null, differences: compare(ref, cmp), additive_only: additiveOnly(ref, cmp) };
  });
  const has = (kind: Kind) => plants.find((p) => p.expect.some((x) => x.kind === kind));
  const typePlant = has('column_type_changed');
  const checks: Record<string, boolean> = {
    ...Object.fromEntries(plants.map((p) => [p.id, p.differences !== null && same(p.differences, p.expect)])),
    // The contrast: an additive-only view does not see the type change.
    additive_only_misses_type_change: typePlant?.additive_only?.length === 0,
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const missedByAdditive = plants.filter((p) => p.additive_only !== null && p.additive_only.length === 0).map((p) => p.id);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, initiated_by: operator, databases: databases.map((x) => x.slice(dir.length + 1)), plants, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}, started by ${operator}: each of ${plants.length} planted changes to the compared database was reported exactly, the type change and the dropped column among them. An additive-only comparison, which reports only names the compared database lacks, saw nothing for ${missedByAdditive.join(', ')}. No schema was changed to resolve a difference. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

export function loadCompareFixture(path: string): CompareFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: CompareFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const strOrNull = (v: unknown) => v === null || typeof v === 'string';
export function checkFixture(fx: CompareFixture, path: string): CompareFixture {
  const bad = (what: string) => new SandboxError('ContractViolation', `fixture ${path}: ${what}`);
  if (typeof fx?.fixture_id !== 'string' || typeof fx.reference_ddl !== 'string' || fx.reference_ddl.trim() === '' || !Array.isArray(fx.plants)) throw bad('needs fixture_id, reference_ddl and plants[]');
  for (const p of fx.plants) {
    const diffOk = (x: Difference) => KINDS.includes(x?.kind) && typeof x.table === 'string' && strOrNull(x.item) && strOrNull(x.reference) && strOrNull(x.compared);
    const ok = typeof p?.id === 'string' && /^[a-z0-9-]+$/.test(p.id) && typeof p.what === 'string'
      && Array.isArray(p.edits) && p.edits.length > 0 && p.edits.every((e) => typeof e?.find === 'string' && e.find !== '' && typeof e.replace === 'string')
      && Array.isArray(p.expect) && p.expect.length > 0 && p.expect.every(diffOk);
    if (!ok) throw bad(`plant ${p?.id ?? '?'} needs an id of lower-case letters, digits and dashes, what, edits[] (find, replace) and expect[] (kind, table, item, reference, compared)`);
  }
  if (new Set(fx.plants.map((p) => p.id)).size !== fx.plants.length) throw bad('each plant id is listed once');
  for (const k of ['column_type_changed', 'column_only_in_reference'] as Kind[]) {
    if (!fx.plants.some((p) => p.expect.length === 1 && p.expect[0].kind === k)) throw bad(`the acceptance needs a plant whose one expected difference is ${k}`);
  }
  return fx;
}
