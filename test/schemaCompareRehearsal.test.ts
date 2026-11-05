import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehearse, compare, additiveOnly, plantDdl, checkFixture, loadCompareFixture, type CompareFixture, type Plant, type Difference } from '../src/capabilities/schemaCompareRehearsal.ts';
import { buildDatabase, readSchema, sandboxDir } from '../src/sandbox/schemaDatabases.ts';
import { schemaCompareOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The DDL is modelled on three platform models; no production schema or data is used.
const FIXTURE = 'examples/schema-compare.fixture.json';
const load = (): CompareFixture => loadCompareFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const C = { captured_at: '2026-11-05T19:00:00Z', captured_by: 'test' };
const box = () => mkdtempSync(join(tmpdir(), 'ellis-schema-'));
const run = (fx: CompareFixture = load()) => rehearse(fx, box(), 'Q.N.');
const by = (r: ReturnType<typeof run>, id: string) => r.plants.find((p) => p.id === id)!;
const withPlant = (fx: CompareFixture, id: string, over: Partial<Plant>): CompareFixture => ({ ...fx, plants: fx.plants.map((p) => (p.id === id ? { ...p, ...over } : p)) });
const schemaOf = (ddl: string) => readSchema(buildDatabase(sandboxDir(box()), 'x', ddl));

test('acceptance (R3): a planted type change and a planted dropped column are both reported, so the comparison is not additive-only', () => {
  const r = run();
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(by(r, 'type-change').differences, [{ kind: 'column_type_changed', table: 'dead_letter_jobs', item: 'error_class', reference: 'VARCHAR(100)', compared: 'TEXT' }]);
  assert.deepEqual(by(r, 'dropped-column').differences, [{ kind: 'column_only_in_reference', table: 'ai_agents', item: 'error_count', reference: null, compared: null }]);
  assert.deepEqual([by(r, 'type-change').additive_only, by(r, 'dropped-column').additive_only!.length], [[], 1], 'additive-only sees the dropped column and not the type change');
  assert.equal(r.initiated_by, 'Q.N.');
  assert.match(r.statement, /started by Q\.N\..*saw nothing for type-change, added-column, nullability-change, default-change, dropped-index\. No schema was changed to resolve a difference\. Sandbox only; nothing ran on the platform\.$/);
  assert.equal(r.limits.length, 4);
});

test('every plant is reported in its own kind, read from the database catalog', () => {
  const r = run();
  assert.deepEqual(r.plants.map((p) => [p.id, p.differences!.map((x) => x.kind)]), [
    ['type-change', ['column_type_changed']], ['dropped-column', ['column_only_in_reference']], ['added-column', ['column_only_in_compared']],
    ['nullability-change', ['nullability_changed']], ['default-change', ['default_changed']], ['dropped-index', ['index_only_in_reference']], ['dropped-table', ['table_only_in_reference']],
  ]);
  assert.deepEqual(by(r, 'nullability-change').differences![0], { kind: 'nullability_changed', table: 'ai_agents', item: 'agent_type', reference: 'not null', compared: 'null' });
  assert.deepEqual(by(r, 'default-change').differences![0], { kind: 'default_changed', table: 'cron_schedule_configs', item: 'enabled', reference: 'TRUE', compared: 'FALSE' });
  assert.deepEqual(r.databases.slice(0, 2), ['reference.sqlite', 'compared-type-change.sqlite']);
});

test('the comparison runs both ways: what only the reference has, and what only the compared database has', () => {
  const a = schemaOf('CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT, y TEXT); CREATE TABLE gone (id INTEGER); CREATE INDEX t_x ON t (x);');
  const b = schemaOf('CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT, z TEXT); CREATE TABLE extra (id INTEGER); CREATE UNIQUE INDEX t_z ON t (z);');
  assert.deepEqual(compare(a, b).map((x) => [x.kind, x.table, x.item]), [
    ['table_only_in_reference', 'gone', null], ['table_only_in_compared', 'extra', null],
    ['column_only_in_reference', 't', 'y'], ['column_only_in_compared', 't', 'z'],
    ['index_only_in_reference', 't', '(x)'], ['index_only_in_compared', 't', 'unique (z)'],
  ]);
  assert.deepEqual(additiveOnly(a, b).map((x) => x.kind), ['table_only_in_reference', 'column_only_in_reference']);
  assert.deepEqual(compare(b, a).map((x) => x.kind).sort(), compare(a, b).map((x) => x.kind.replace('reference', 'X').replace('compared', 'reference').replace('X', 'compared')).sort());
});

test('the catalog is read, not the DDL: a unique constraint and a unique index read the same, and a primary key is not an index', () => {
  const a = schemaOf('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE, n INTEGER NOT NULL DEFAULT 0);');
  const b = schemaOf('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER NOT NULL DEFAULT 0); CREATE UNIQUE INDEX t_name ON t (name);');
  assert.deepEqual(compare(a, b), []);
  assert.deepEqual(a.t.indexes, ['unique (name)']);
  assert.deepEqual(a.t.columns.n, { type: 'INTEGER', not_null: true, default: '0', primary_key: false });
  assert.equal(a.t.columns.id.primary_key, true);
  const multi = schemaOf('CREATE TABLE t (a TEXT, b TEXT); CREATE INDEX t_ba ON t (b, a);');
  assert.deepEqual(multi.t.indexes, ['(b, a)'], 'index columns keep their order');
  assert.throws(() => schemaOf('CREATE TABLE t (a TEXT'), /incomplete input|syntax error/);
  // SQLite's own tables are not the schema, a primary key's index is not an index, and a generated column is a column.
  const own = schemaOf('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, u TEXT, g INTEGER GENERATED ALWAYS AS (1) VIRTUAL); CREATE TABLE k (id TEXT PRIMARY KEY);');
  assert.deepEqual(Object.keys(own), ['k', 't']);
  assert.deepEqual(own.k.indexes, []);
  assert.deepEqual(Object.keys(own.t.columns), ['id', 'u', 'g']);
  // The schema is read without opening for writing, so a missing database is an error, never a new empty file.
  assert.throws(() => readSchema(join(box(), 'missing.sqlite')), /unable to open/);
});

test('a plant passes its check only when it reports exactly what it expects, and the contrast can fail', () => {
  const fx = load();
  const nothing = run(withPlant(fx, 'type-change', { edits: [{ find: '  error_class VARCHAR(100) NOT NULL,', replace: '  error_class VARCHAR(100) NOT NULL,' }] }));
  assert.deepEqual([by(nothing, 'type-change').differences, nothing.checks['type-change']], [[], false]);
  assert.equal(nothing.checks.additive_only_misses_type_change, true, 'the contrast reads the type-change plant');
  const wrong: Difference = { kind: 'column_type_changed', table: 'dead_letter_jobs', item: 'error_class', reference: 'VARCHAR(100)', compared: 'VARCHAR(200)' };
  assert.equal(run(withPlant(fx, 'type-change', { expect: [wrong] })).checks['type-change'], false);
  const extra = run(withPlant(fx, 'type-change', { edits: [{ find: '  error_class VARCHAR(100) NOT NULL,', replace: '  error_class TEXT,' }] }));
  assert.equal(extra.checks['type-change'], false, 'a difference the record did not expect is not ignored');
  // A type change that also drops a column is seen by the additive view, so the contrast fails.
  const both = run(withPlant(fx, 'type-change', { edits: [{ find: '  error_class VARCHAR(100) NOT NULL,\n  resolved', replace: '  error_class TEXT NOT NULL,\n  resolved' }, { find: '  created_at TIMESTAMPTZ\n);\nCREATE INDEX', replace: '  x INTEGER\n);\nCREATE INDEX' }] }));
  assert.equal(both.checks.additive_only_misses_type_change, false);
  const missed = run(withPlant(fx, 'type-change', { edits: [{ find: 'not in the DDL', replace: 'x' }] }));
  assert.deepEqual([by(missed, 'type-change').missed, missed.checks['type-change'], missed.checks.additive_only_misses_type_change], ['the passage to replace is not in the DDL', false, false]);
});

test('planting replaces one exact passage that appears once', () => {
  assert.deepEqual(plantDdl('a b a', [{ find: 'a', replace: 'c' }]), { missed: 'the passage to replace appears more than once' });
  assert.equal(plantDdl('a b', [{ find: 'a', replace: 'c' }, { find: 'b', replace: 'd' }]), 'c d');
});

test('a comparison is started by a named operator, and every database it builds stays in its own sandbox folder', () => {
  assert.throws(() => rehearse(load(), box(), '  '), /named operator/);
  const root = box();
  const r = rehearse(load(), root, 'Q.N.');
  const [folder] = readdirSync(root);
  assert.match(folder, /^schema-/);
  assert.deepEqual(readdirSync(join(root, folder)).sort(), [...r.databases].sort());
});

test('in the shared output, a verified run is ok citing every plant; a failed run cites the plants that went wrong', () => {
  const o = schemaCompareOutput(run(), C, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 7);
  assert.deepEqual(o.evidence[0], { table: 'sandbox_databases', id: 'compared-type-change', fields: ['dead_letter_jobs.error_class widened from VARCHAR(100) to TEXT', 'column_type_changed dead_letter_jobs.error_class (VARCHAR(100) to TEXT)'] });
  assert.equal(o.evidence[6].fields[1], 'table_only_in_reference cron_schedule_configs');
  assert.match(o.as_of.note!, /sandbox fixture schema-compare-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 4);
  const fx = load();
  const f = schemaCompareOutput(run(withPlant(fx, 'dropped-index', { edits: [{ find: 'CREATE INDEX dead_letter_jobs_job_name ON dead_letter_jobs (job_name);\n', replace: 'CREATE INDEX dead_letter_jobs_job_name ON dead_letter_jobs (job_name);\n' }] })), C, EMPTY);
  assert.deepEqual([f.verdict, f.evidence.map((x) => [x.id, x.fields[1]])], ['problem', [['compared-dropped-index', 'no difference reported']]]);
  const missed = schemaCompareOutput(run(withPlant(fx, 'dropped-table', { edits: [{ find: 'absent', replace: 'x' }] })), C, EMPTY);
  assert.match(missed.evidence[0].fields[1], /is not in the DDL/);
});

test('a fixture is refused without its parts, with a malformed plant, or without the two acceptance plants; the command exits 0, 3 and 1', () => {
  const base = load();
  const p0 = base.plants.find((p) => p.id === 'added-column')!;
  const bad: CompareFixture[] = [
    { ...base, fixture_id: 1 as never }, { ...base, reference_ddl: ' ' }, { ...base, reference_ddl: undefined as never }, { ...base, plants: undefined as never },
    withPlant(base, p0.id, { id: 'Bad Id' }), withPlant(base, p0.id, { id: 1 as never }), withPlant(base, p0.id, { what: undefined as never }),
    withPlant(base, p0.id, { edits: [] }), withPlant(base, p0.id, { edits: [{ find: '', replace: 'x' }] }), withPlant(base, p0.id, { edits: [{ find: 'x', replace: 1 as never }] }),
    withPlant(base, p0.id, { expect: [] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], kind: 'renamed' as never }] }),
    withPlant(base, p0.id, { expect: [{ ...p0.expect[0], table: 1 as never }] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], item: 1 as never }] }),
    withPlant(base, p0.id, { expect: [{ ...p0.expect[0], reference: 1 as never }] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], compared: 1 as never }] }),
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture({ ...base, plants: [...base.plants, p0] }, 'inline'), /listed once/);
  assert.throws(() => checkFixture({ ...base, plants: base.plants.filter((p) => p.id !== 'type-change') }, 'inline'), /column_type_changed/);
  assert.throws(() => checkFixture({ ...base, plants: base.plants.filter((p) => p.id !== 'dropped-column') }, 'inline'), /column_only_in_reference/);
  const two = withPlant(base, 'dropped-column', { expect: [...base.plants[1].expect, base.plants[1].expect[0]] });
  assert.throws(() => checkFixture(two, 'inline'), /column_only_in_reference/, 'the dropped-column plant must expect that one difference alone');
  const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli/schemaCompareRehearsal.ts', ...a], { encoding: 'utf8' });
  const ok = cli('--fixture', FIXTURE, '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(ok.status, 0, ok.stderr);
  const notFx = join(box(), 'f.json');
  writeFileSync(notFx, JSON.stringify(withPlant(base, 'type-change', { expect: [{ ...base.plants[0].expect[0], compared: 'BLOB' }] })));
  assert.equal(cli('--fixture', notFx, '--sandbox', box(), '--operator', 'Q.N.').status, 3);
  const noOperator = cli('--fixture', FIXTURE, '--sandbox', box());
  assert.equal(noOperator.status, 1);
  assert.match(noOperator.stderr, /named person/);
  const missing = cli('--fixture', 'examples/nope.json', '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
