import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDriftLog, readAxes, readReconciler, schemaDriftAnswer, LIMITS, NOT_FOUND, DRIFT_SCRIPT, SYNC_SCRIPT, SERVER, RECONCILER, type DriftAnswer } from '../src/capabilities/schemaDriftDetection.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const FILES: Record<string, string> = {
  [DRIFT_SCRIPT]: '#!/usr/bin/env bash\n',
  [SYNC_SCRIPT]: `#!/usr/bin/env bash
# a table exists on dev only if ensureThingSchema created it or it was seeded
EXCLUDE_REGEX="\${EXCLUDE_REGEX:-_legacy_|_backup_|_bak$}"
list_enums() { docker exec "$PG_CONTAINER" psql -c "SELECT t.typname FROM pg_type t;"; }
list_colpairs() { docker exec "$PG_CONTAINER" psql -c "SELECT table_name||'.'||column_name FROM information_schema.columns;"; }
MISSING_TABLES=$(comm -23 <(printf '%s\\n' "$PROD_TABLES") <(printf '%s\\n' "$DEV_TABLES") | grep -vE "$EXCLUDE_REGEX" || true)
MISSING_COLPAIRS=$(comm -23 <(list_colpairs "$PROD_DB") <(list_colpairs "$DEV_DB") || true)
`,
  [SERVER]: `const a = 1;
const r = await reconcileMissingColumns([
  Enrollment,
  Lead,
]);
`,
  [RECONCILER]: `await qi.addColumn(model.getTableName(), column, {});\n`,
  'backend/src/services/aiOpsScheduler.ts': 'x',
  'backend/src/db/ensureOneSchema.ts': 'x',
  'backend/src/db/ensureTwoSchema.ts': 'x',
  'backend/src/db/__tests__/ensureOneSchema.test.ts': 'x',
};

class Missing extends Error { errorClass = 'SourceUnavailable'; }
const readerOf = (files: Record<string, string>): Reader => ({
  read(p) { if (files[p] === undefined) throw new Missing(p); return files[p]; },
  list(dir) { return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const R = readerOf(FILES);

// These blocks are what the real two scripts printed, run unchanged against a stand-in docker.
const NONE = '2026-11-01T06:00:01Z schema-drift: none\n';
const DRIFT = `2026-11-01T06:00:01Z schema-drift: DETECTED
== schema parity: accelerator_prod -> accelerator_dev1 (container accelerator-db) ==
-- missing enum types --
level_enum
-- missing tables --
orders
-- missing columns (drift on existing tables) --
  jobs.owner_id (uuid)

-- warnings --
  ! jobs.owner_id is NOT NULL on prod with no default -> added NULLABLE (backfill+enforce manually)

DRY-RUN: re-run with --apply to create the above on accelerator_dev1 (single transaction).
schema-drift alert sent to oncall@example.test
`;
const DOWN = `2026-11-01T06:00:01Z schema-drift: DETECTED
== schema parity: accelerator_prod -> accelerator_dev1 (container accelerator-db) ==
schema-drift alert sent to oncall@example.test
`;
const CUT = `2026-11-01T06:00:01Z schema-drift: DETECTED
== schema parity: accelerator_prod -> accelerator_dev1 (container accelerator-db) ==
-- missing enum types --
(none)
-- missing tables --
orders
-- missing columns (drift on existing tables) --
(none)
`;

const NOW = '2026-11-01T12:00:00Z';
const ask = (log: string | null, at = NOW, maxAge = 26): DriftAnswer => schemaDriftAnswer(R, log, at, { max_age_hours: maxAge, source_commit: 'abc' });
const at = (block: string, stamp: string) => block.replace('2026-11-01T06:00:01Z', stamp);

test('with no log the answer is unknown, last run not found, never no drift', () => {
  const a = ask(null);
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.statement, NOT_FOUND);
  assert.equal(a.unknown_because, 'log_not_supplied');
  assert.equal(a.last_completed, null);
  assert.equal(a.drift, null);
  assert.doesNotMatch(a.statement, /no drift/i);
});

test('an empty log, and a log holding nothing the script wrote, are no completed run', () => {
  for (const log of ['', '\n\n', 'cron: bad minute\nsomething else\n']) {
    const a = ask(log);
    assert.equal(a.verdict, 'unknown');
    assert.equal(a.statement, NOT_FOUND);
    assert.equal(a.unknown_because, 'no_completed_run');
  }
  assert.equal(ask('cron: bad minute\n').runs.lines_not_read, 1);
});

test('a run that never compared logs DETECTED but is not drift, and alone leaves the answer unknown', () => {
  const a = ask(DOWN);
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.unknown_because, 'last_attempt_incomplete');
  assert.ok(a.statement.startsWith(NOT_FOUND));
  assert.equal(a.drift, null);
  assert.equal(a.runs.incomplete, 1);
  assert.equal(a.runs.completed, 0);
});

test('a report cut off before its closing line is incomplete, and its partial lists are not reported as drift', () => {
  const parsed = parseDriftLog(CUT);
  assert.equal(parsed.runs[0].outcome, 'incomplete');
  assert.deepEqual(parsed.runs[0].drift?.tables, ['orders']);
  const a = ask(CUT);
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.drift, null);
});

test('a closing line with no sections, or sections with nothing in them, is incomplete', () => {
  const noSections = '2026-11-01T06:00:01Z schema-drift: DETECTED\nDRY-RUN: re-run\n';
  assert.equal(parseDriftLog(noSections).runs[0].outcome, 'incomplete');
  assert.equal(parseDriftLog(`${CUT.replace('orders', '(none)')}DRY-RUN: re-run\n`).runs[0].outcome, 'incomplete');
  const noColumns = '2026-11-01T06:00:01Z schema-drift: DETECTED\n-- missing tables --\norders\nDRY-RUN: re-run\n';
  assert.equal(parseDriftLog(noColumns).runs[0].outcome, 'incomplete');
});

test('a drifted run names every item and the alert result', () => {
  const a = ask(DRIFT);
  assert.equal(a.verdict, 'drift_reported');
  assert.deepEqual(a.drift, {
    enums: ['level_enum'],
    tables: ['orders'],
    columns: ['jobs.owner_id (uuid)'],
    warnings: ['jobs.owner_id is NOT NULL on prod with no default -> added NULLABLE (backfill+enforce manually)'],
  });
  assert.equal(a.alert, 'sent');
  assert.match(a.statement, /1 table\(s\), 1 enum type\(s\) and 1 column\(s\)/);
});

test('a failed alert and a missing alert line are told apart', () => {
  assert.equal(ask(DRIFT.replace('schema-drift alert sent to oncall@example.test', 'schema-drift alert FAILED: mandrill 500')).alert, 'failed');
  assert.equal(ask(DRIFT.replace('schema-drift alert sent to oncall@example.test\n', '')).alert, 'not_recorded');
});

test('a recipient address in the log never reaches the answer', () => {
  assert.doesNotMatch(JSON.stringify(ask(DRIFT)), /example\.test/);
});

test('a fresh none says only what it covers', () => {
  const a = ask(NONE);
  assert.equal(a.verdict, 'no_drift_reported');
  assert.match(a.statement, /on the axes listed as measured only/);
  assert.equal(a.alert, null);
  assert.equal(a.last_completed?.fresh, true);
  assert.equal(a.last_completed?.age_hours, 6);
});

test('a stale none is unknown, because silence is not agreement', () => {
  const a = ask(NONE, '2026-11-03T12:00:00Z');
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.unknown_because, 'last_run_stale');
  assert.match(a.statement, /54 hours old/);
  assert.notEqual(a.last_completed, null);
});

test('the freshness limit is inclusive and can be set', () => {
  assert.equal(ask(NONE, '2026-11-02T08:00:01Z').verdict, 'no_drift_reported');
  assert.equal(ask(NONE, '2026-11-02T08:30:00Z').verdict, 'unknown');
  assert.equal(ask(NONE, '2026-11-02T08:30:00Z', 48).verdict, 'no_drift_reported');
});

test('stale drift stays reported and says it may not be current', () => {
  const a = ask(DRIFT, '2026-11-03T12:00:00Z');
  assert.equal(a.verdict, 'drift_reported');
  assert.match(a.statement, /may not be current/);
});

test('an unfinished attempt after a none makes the answer unknown', () => {
  const a = ask(NONE + at(DOWN, '2026-11-01T07:00:00Z'));
  assert.equal(a.verdict, 'unknown');
  assert.equal(a.unknown_because, 'last_attempt_incomplete');
  assert.equal(a.last_completed?.outcome, 'none');
  assert.equal(a.latest_attempt?.outcome, 'incomplete');
});

test('an unfinished attempt after drift keeps the drift and says so', () => {
  const a = ask(DRIFT + at(DOWN, '2026-11-01T07:00:00Z'));
  assert.equal(a.verdict, 'drift_reported');
  assert.match(a.statement, /never finished/);
  assert.equal(a.drift?.tables[0], 'orders');
});

test('the newest completed run wins, whatever order the log is in', () => {
  assert.equal(ask(at(NONE, '2026-11-01T05:00:00Z') + DRIFT).verdict, 'drift_reported');
  assert.equal(ask(DRIFT + at(NONE, '2026-11-01T07:00:00Z')).verdict, 'no_drift_reported');
  assert.equal(ask(at(NONE, '2026-11-01T07:00:00Z') + DRIFT).verdict, 'no_drift_reported');
});

test('a run after the capture time is set aside and counted, never used', () => {
  const a = ask(NONE + at(DRIFT, '2026-11-02T06:00:00Z'));
  assert.equal(a.verdict, 'no_drift_reported');
  assert.equal(a.runs.dated_after_capture, 1);
});

test('a stamp that is not a date is not a run', () => {
  const parsed = parseDriftLog('2026-13-45T06:00:01Z schema-drift: none\n');
  assert.equal(parsed.runs.length, 0);
  assert.equal(parsed.lines_not_read, 1);
});

test('reading the same log twice gives the same answer, and line endings do not matter', () => {
  assert.deepEqual(ask(DRIFT), ask(DRIFT));
  assert.equal(ask(DRIFT.replace(/\n/g, '\r\n')).verdict, 'drift_reported');
});

test('the axes are read from the script: only names on the behind side are measured', () => {
  const a = ask(NONE);
  assert.deepEqual(a.axes_measured.map((x) => x.axis), ['dev_behind_prod_names']);
  assert.deepEqual(a.axes_not_measured.map((x) => x.axis), ['dev_ahead_of_prod', 'column_shape', 'enum_values', 'indexes_and_constraints', 'code_versus_database', 'excluded_names']);
  assert.match(a.axes_not_measured.at(-1)!.why, /_legacy_\|_backup_\|_bak\$/);
});

test('an ensure mention in a comment does not count as a code comparison', () => {
  assert.equal(readAxes(R).find((x) => x.axis === 'code_versus_database')?.status, 'unmeasured');
});

test('an axis moves to measured when the script starts comparing it', () => {
  const sync = FILES[SYNC_SCRIPT]
    .replace('SELECT table_name||', 'SELECT data_type||table_name||')
    .replace('t.typname', 'e.enumlabel')
    .replace('comm -23 <(list_colpairs "$PROD_DB") <(list_colpairs "$DEV_DB")', 'comm -13 <(list_colpairs "$PROD_DB") <(list_colpairs "$DEV_DB")');
  const axes = readAxes(readerOf({ ...FILES, [SYNC_SCRIPT]: sync }));
  for (const name of ['dev_ahead_of_prod', 'column_shape', 'enum_values']) assert.equal(axes.find((x) => x.axis === name)?.status, 'measured', name);
});

test('an unreadable script leaves every axis not read, never measured', () => {
  const { [SYNC_SCRIPT]: _gone, ...rest } = FILES;
  const axes = readAxes(readerOf(rest));
  assert.ok(axes.length > 0);
  assert.ok(axes.every((x) => x.status === 'not_read'));
  const a = schemaDriftAnswer(readerOf(rest), null, NOW, { max_age_hours: 26, source_commit: null });
  assert.deepEqual(a.axes_measured, []);
  assert.equal(a.axes_not_measured.length, axes.length);
});

test('a reworked helper is not read rather than assumed unmeasured', () => {
  const sync = FILES[SYNC_SCRIPT].replace('list_enums()', 'enums_of()');
  assert.equal(readAxes(readerOf({ ...FILES, [SYNC_SCRIPT]: sync })).find((x) => x.axis === 'enum_values')?.status, 'not_read');
});

test('the reconciler list is read from source and shows no domain model protected', () => {
  const c = readReconciler(R);
  assert.deepEqual(c.models, ['Enrollment', 'Lead']);
  assert.deepEqual(c.domain_models_protected, []);
  assert.deepEqual(c.domain_models_not_protected, ['AiAgent', 'CronScheduleConfig', 'AiAgentActivityLog', 'DeadLetterJob']);
  assert.equal(c.additive_only, true);
  assert.equal(c.where, `${SERVER}:2`);
});

test('a domain model added to the list shows as protected', () => {
  const c = readReconciler(readerOf({ ...FILES, [SERVER]: 'await reconcileMissingColumns([ AiAgent, Lead ]);' }));
  assert.deepEqual(c.domain_models_protected, ['AiAgent']);
});

test('a reconciler that alters columns is not called additive', () => {
  assert.equal(readReconciler(readerOf({ ...FILES, [RECONCILER]: 'qi.addColumn(); qi.changeColumn();' })).additive_only, false);
});

test('a server with no reconciler call reads as not read, not as an empty list', () => {
  const c = readReconciler(readerOf({ ...FILES, [SERVER]: 'nothing here' }));
  assert.equal(c.read, false);
  assert.deepEqual(c.domain_models_not_protected, []);
});

test('ensure modules are counted without their tests, and the human decision and limits always travel', () => {
  for (const log of [null, NONE, DRIFT, DOWN]) {
    const a = ask(log);
    assert.equal(a.ensure_schema_modules, 2);
    assert.equal(a.human_decision.applying_any_schema_change, 'person_only');
    assert.deepEqual(a.limits, [...LIMITS]);
  }
});

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  for (const [p, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}
const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli/schemaDrift.ts', ...args], { encoding: 'utf8' });

test('the CLI gives unknown with no log, drift and none with their exit codes', () => {
  const dir = checkout();
  const log = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const none = cli('--source', dir);
  assert.equal(none.status, 4);
  assert.equal(JSON.parse(none.stdout).statement, NOT_FOUND);
  assert.equal(cli('--source', dir, '--log', log('d.log', DRIFT), '--captured-at', NOW).status, 3);
  assert.equal(cli('--source', dir, '--log', log('n.log', NONE), '--captured-at', NOW).status, 0);
});

test('the CLI refuses bad input', () => {
  const dir = checkout();
  assert.equal(cli('--source', join(dir, 'nowhere')).status, 1);
  assert.equal(cli('--source', dir, '--log', join(dir, 'nowhere.log')).status, 1);
  assert.equal(cli('--source', dir, '--captured-at', 'soon').status, 1);
  assert.equal(cli('--source', dir, '--max-age-hours', '0').status, 1);
});
