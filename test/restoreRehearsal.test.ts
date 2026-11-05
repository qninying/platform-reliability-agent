import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { rehearse, truncations, checkFixture, loadRestoreFixture, type RestoreFixture } from '../src/capabilities/restoreRehearsal.ts';
import { newTarget, proveIsolation, restore, runQueries, isolated } from '../src/sandbox/sandboxRestore.ts';
import { restoreRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The backup and its rows were written for this demonstration; no production backup or data.
const FIXTURE = 'examples/backup/restore.fixture.json';
const SQL = readFileSync('examples/backup/sandbox-backup.sql', 'utf8');
const load = (): RestoreFixture => loadRestoreFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const C = { captured_at: '2026-11-05T21:00:00Z', captured_by: 'test' };
const box = () => mkdtempSync(join(tmpdir(), 'ellis-restore-'));
const run = (fx: RestoreFixture = load(), path = FIXTURE) => rehearse(fx, path, box(), 'Q.N.');
const at = (r: ReturnType<typeof run>, a: string) => r.attempts.find((x) => x.attempt === a)!;
// A fixture beside its own backup, in a scratch folder.
function beside(sql: string, fx: Partial<RestoreFixture> = {}) {
  const dir = box();
  writeFileSync(join(dir, 'b.sql'), sql);
  const f = { ...load(), artefact: 'b.sql', ...fx };
  writeFileSync(join(dir, 'f.json'), JSON.stringify(f));
  return { fx: f, path: join(dir, 'f.json') };
}

test('acceptance (R3): a deliberately truncated artefact fails the restore assertion, and the restore target is proven isolated before the restore begins', () => {
  const r = run();
  assert.equal(r.verified, true, r.statement);
  for (const a of r.attempts) assert.deepEqual(Object.values(a.isolation), [true, true, true, true, true], `${a.attempt} proven isolated`);
  assert.deepEqual([at(r, 'full').restored, at(r, 'full').answered], [true, true]);
  assert.deepEqual([at(r, 'truncated_mid_statement').restored, at(r, 'truncated_mid_statement').error], [false, 'incomplete input']);
  const b = at(r, 'truncated_at_statement_boundary');
  assert.deepEqual([b.restored, b.answers.map((x) => [x.id, x.ok])], [true, [['agent_count', true], ['disabled_agents', true], ['unresolved_dead_letters', false]]]);
  assert.deepEqual(b.answers[2].rows, [{ job_name: 'SampleSweepAgent', error_class: 'TimeoutError' }]);
  assert.match(r.statement, /started by Q\.N\.: each target was proven isolated before its restore began\..*Cut cleanly between statements, it restored without an error but answered unresolved_dead_letters wrongly.*Sandbox only; nothing ran on the platform\.$/);
  assert.equal(r.limits.length, 4);
});

test('the truncated copies are cut at fixed places: inside a statement, and after every statement but the last', () => {
  const t = truncations(SQL);
  assert.equal(t.truncated_mid_statement.endsWith(';\n'), false);
  assert.ok(SQL.startsWith(t.truncated_mid_statement));
  const last = SQL.trimEnd().split('\n').at(-1)!;
  assert.equal(t.truncated_at_statement_boundary, SQL.slice(0, SQL.length - last.length - 1));
  assert.deepEqual(truncations(SQL), t);
  assert.equal(run().attempts[1].bytes, Buffer.byteLength(t.truncated_mid_statement));
});

test('a target is not isolated when its folder was not empty, the target exists or lies elsewhere, the artefact is inside, or a statement reaches out', () => {
  const artefact = join(box(), 'b.sql');
  writeFileSync(artefact, SQL);
  const fresh = newTarget(box());
  assert.equal(isolated(proveIsolation(fresh, artefact, SQL)), true);
  const busy = newTarget(box());
  writeFileSync(join(busy.folder, 'other'), 'x');
  assert.equal(proveIsolation(busy, artefact, SQL).folder_was_new_and_empty, false);
  const taken = newTarget(box());
  writeFileSync(taken.path, '');
  assert.deepEqual([proveIsolation(taken, artefact, SQL).target_did_not_exist, proveIsolation(taken, artefact, SQL).folder_was_new_and_empty], [false, false]);
  const elsewhere = newTarget(box());
  const away = join(box(), 'sub');
  mkdirSync(away);
  assert.equal(proveIsolation({ folder: elsewhere.folder, path: join(away, 'x.sqlite') }, artefact, SQL).target_inside_folder, false);
  const inside = newTarget(box());
  writeFileSync(join(inside.folder, 'b.sql'), SQL);
  const own = proveIsolation({ folder: inside.folder, path: join(inside.folder, 'r.sqlite') }, join(inside.folder, 'b.sql'), SQL);
  assert.equal(own.artefact_outside_folder, false);
  for (const s of ["ATTACH DATABASE '/elsewhere.db' AS x;", "attach database '/elsewhere.db' as x;", 'DETACH x;', "VACUUM INTO '/elsewhere.db';", "SELECT load_extension('x');", 'CREATE TEMP TABLE t (a);', 'CREATE TEMPORARY TABLE t (a);']) {
    assert.equal(proveIsolation(newTarget(box()), artefact, SQL + s + '\n').no_statement_reaches_out, false, s);
  }
});

test('a backup that could reach outside its folder is refused before the restore begins, and nothing is written', () => {
  // At the start, so the truncated copies carry it too.
  const { fx, path } = beside(`ATTACH DATABASE 'elsewhere.db' AS x;\n${SQL}`);
  const root = box();
  const r = rehearse(fx, path, root, 'Q.N.');
  assert.ok(r.attempts.every((a) => a.refused && !a.restored), 'every copy carries the statement and is refused');
  assert.equal(at(r, 'full').isolation.no_statement_reaches_out, false);
  assert.deepEqual([r.checks.isolation_proven_before_restore, r.checks.full_backup_answers_known_queries, r.verified], [false, false, false]);
  for (const f of readdirSync(root)) assert.deepEqual(readdirSync(join(root, f)), [], 'no database file was created');
});

test('a restore is one transaction: a backup that stops partway leaves no table behind', () => {
  const t = newTarget(box());
  assert.deepEqual(restore(t, 'CREATE TABLE a (x INTEGER);\nINSERT INTO a VALUES (1);\nINSERT INTO nope VALUES (2);\n'), { restored: false, error: 'no such table: nope' });
  const db = new DatabaseSync(t.path, { readOnly: true });
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), []);
  db.close();
  assert.deepEqual(runQueries(t, ['SELECT * FROM a']), [{ sql: 'SELECT * FROM a', rows: null, error: 'no such table: a' }]);
  // Queries run read-only: one that writes is refused by the database, never applied.
  const w = newTarget(box());
  restore(w, 'CREATE TABLE a (x INTEGER);\nINSERT INTO a VALUES (1);\n');
  assert.match(runQueries(w, ['DELETE FROM a'])[0].error!, /readonly/);
  assert.deepEqual(runQueries(w, ['SELECT x FROM a'])[0].rows, [{ x: 1 }]);
});

test('the full backup must answer every known query exactly; a wrong expectation or a failing query fails the run', () => {
  const fx = load();
  const wrong = run({ ...fx, queries: fx.queries.map((q) => (q.id === 'agent_count' ? { ...q, expect: [{ n: 5 }] } : q)) });
  assert.deepEqual([at(wrong, 'full').answers[0].ok, wrong.checks.full_backup_answers_known_queries, wrong.verified], [false, false, false]);
  const broken = run({ ...fx, queries: [...fx.queries, { id: 'missing_table', sql: 'SELECT * FROM nope', expect: [] }] });
  assert.deepEqual([at(broken, 'full').answers[3].ok, at(broken, 'full').answers[3].error], [false, 'no such table: nope']);
  // A query only the boundary cut cannot answer is what catches it; without one, the clean cut passes.
  const blind = run({ ...fx, queries: fx.queries.filter((q) => q.id !== 'unresolved_dead_letters') });
  assert.deepEqual([blind.checks.truncated_at_statement_boundary_fails, blind.verified], [false, false]);
  // The same holds inside a statement: a cut that lands in a comment restores, and a query blind to the lost rows passes.
  const note = `-- ${'-'.repeat(200)}\n`;
  const commented = beside(`CREATE TABLE a (x INTEGER);\n${[1, 2, 3, 4, 5].map((n) => `${note}INSERT INTO a VALUES (${n});\n`).join('')}`, { queries: [{ id: 'tables', sql: "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table'", expect: [{ n: 1 }] }] });
  const c = rehearse(commented.fx, commented.path, box(), 'Q.N.');
  assert.deepEqual([at(c, 'truncated_mid_statement').restored, c.checks.truncated_mid_statement_fails], [true, false]);
});

test('a restore is started by a named operator, and each attempt has its own fresh folder', () => {
  assert.throws(() => rehearse(load(), FIXTURE, box(), ''), /named operator/);
  const root = box();
  rehearse(load(), FIXTURE, root, 'Q.N.');
  const folders = readdirSync(root).sort();
  assert.equal(folders.length, 3);
  assert.deepEqual(folders.map((f) => readdirSync(join(root, f))).flat().sort(), ['full.sqlite', 'truncated_at_statement_boundary.sqlite', 'truncated_mid_statement.sqlite']);
  assert.deepEqual(run().attempts, run().attempts, 'the same backup gives the same attempts');
});

test('in the shared output, a verified run is ok citing each attempt; a failed run cites the attempts that went wrong', () => {
  const o = restoreRehearsalOutput(run(), C, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence.map((x) => [x.id, x.fields[1]]), [
    ['full', 'restored, answered every known query'], ['truncated_mid_statement', 'did not restore: incomplete input'],
    ['truncated_at_statement_boundary', 'restored, answered wrongly: unresolved_dead_letters'],
  ]);
  assert.match(o.as_of.note!, /sandbox fixture restore-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 4);
  const fx = load();
  const blind = restoreRehearsalOutput(run({ ...fx, queries: fx.queries.filter((q) => q.id !== 'unresolved_dead_letters') }), C, EMPTY);
  assert.deepEqual([blind.verdict, blind.evidence.map((x) => x.id)], ['problem', ['truncated_at_statement_boundary']]);
  const reach = beside(`DETACH x;\n${SQL}`);
  const refused = restoreRehearsalOutput(rehearse(reach.fx, reach.path, box(), 'Q.N.'), C, EMPTY);
  assert.deepEqual(refused.evidence.map((x) => x.fields[1]), Array(3).fill('refused: isolation not proven'));
});

test('a fixture is refused without its parts or with a query that is not a SELECT; the command exits 0, 3 and 1', () => {
  const base = load();
  const bad: RestoreFixture[] = [
    { ...base, fixture_id: 1 as never }, { ...base, artefact: undefined as never }, { ...base, queries: [] }, { ...base, queries: undefined as never },
    { ...base, queries: [{ ...base.queries[0], id: 1 as never }] }, { ...base, queries: [{ ...base.queries[0], sql: 'DELETE FROM ai_agents' }] },
    { ...base, queries: [{ ...base.queries[0], expect: {} as never }] }, { ...base, queries: [{ ...base.queries[0], sql: 1 as never }] },
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture({ ...base, queries: [base.queries[0], base.queries[0]] }, 'inline'), /listed once/);
  const one = beside('CREATE TABLE a (x);\n');
  assert.throws(() => rehearse(one.fx, one.path, box(), 'Q.N.'), /at least two statements/);
  assert.throws(() => rehearse({ ...base, artefact: 'nope.sql' }, FIXTURE, box(), 'Q.N.'), (e: Error & { errorClass?: string }) => e.errorClass === 'SourceUnavailable' && /artefact nope\.sql could not be read/.test(e.message));
  const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli/restoreRehearsal.ts', ...a], { encoding: 'utf8' });
  const ok = cli('--fixture', FIXTURE, '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(ok.status, 0, ok.stderr);
  const wrong = beside(SQL, { queries: base.queries.filter((q) => q.id !== 'unresolved_dead_letters') });
  assert.equal(cli('--fixture', wrong.path, '--sandbox', box(), '--operator', 'Q.N.').status, 3);
  const noOperator = cli('--fixture', FIXTURE, '--sandbox', box());
  assert.equal(noOperator.status, 1);
  assert.match(noOperator.stderr, /named person/);
  const missing = cli('--fixture', 'examples/nope.json', '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
