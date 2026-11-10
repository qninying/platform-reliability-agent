import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ContractViolation, loadSeverityTable, type ToolOutput } from '../src/output/toolOutput.ts';
import { makeRecord, mergeRecords, pair, recordId, reviewSheet, type ReviewSheet } from '../src/shadow/observationBuilder.ts';
import { recordMonitor, SourceUnavailable } from '../src/shadow/monitorRecorders.ts';
import { evaluateShadow } from '../src/shadow/shadowEvaluation.ts';

// Test inputs are the repository's example exports and hand-made outputs; not production data.
const TOOL = 'platform.CAP.cron_health_alerting';

function out(verdict: ToolOutput<unknown>['verdict'], at = '2026-11-10T02:00:00Z', tool = TOOL): ToolOutput<unknown> {
  return {
    tool, as_of: { captured_at: at, captured_by: 'test', note: null }, verdict, severity: 'unassigned', severity_rule: 'test',
    platform_signal: null, evidence: verdict === 'problem' || verdict === 'ok' ? [{ table: 'ai_agents', id: `row-${at}`, fields: ['status'] }] : [],
    blind_spots: verdict === 'partly_unknown' ? ['x'] : [], detail: { secret_answer: verdict },
  };
}

function fill(sheet: ReviewSheet, id: string, verdict: 'problem' | 'ok', approved_by: string | null = 'K.D.') {
  const row = sheet.rows.find((r) => r.id === id);
  assert.ok(row, id);
  row.reference = { verdict, source: 'platform activity log, reviewed', approved_by, approved_at: '2026-11-11' };
}

test('record ids are stable and do not depend on how the time is written', () => {
  assert.equal(recordId(TOOL, 'fleet', '2026-11-10T02:00:00Z'), recordId(TOOL, 'fleet', '2026-11-10T02:00:00.000Z'));
  assert.notEqual(recordId(TOOL, 'fleet', '2026-11-10T02:00:00Z'), recordId(TOOL, 'fleet', '2026-11-10T03:00:00Z'));
  assert.notEqual(recordId(TOOL, 'fleet', '2026-11-10T02:00:00Z'), recordId(TOOL, 'job-a', '2026-11-10T02:00:00Z'));
  assert.equal(makeRecord(out('ok')).subject, 'fleet');
});

test('a record needs a capture time and a subject', () => {
  const noTime = { ...out('ok'), as_of: { captured_at: null, captured_by: null, note: null } };
  assert.throws(() => makeRecord(noTime), ContractViolation);
  assert.throws(() => makeRecord(out('ok'), '  '), ContractViolation);
  assert.throws(() => makeRecord(out('ok', 'not a time')), ContractViolation);
});

test('idempotent: recording the same output again adds nothing', () => {
  const r = makeRecord(out('problem'));
  const first = mergeRecords([], [r]);
  const second = mergeRecords(first.records, [makeRecord(out('problem'))]);
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.deepEqual(second.records, first.records);
});

test('a different output for the same tool, subject and time is refused, not overwritten', () => {
  const { records } = mergeRecords([], [makeRecord(out('problem'))]);
  assert.throws(() => mergeRecords(records, [makeRecord(out('ok'))]), (e: Error) => e instanceof ContractViolation && /already holds a different output/.test(e.message));
});

test('records are kept in id order whatever order they arrive in', () => {
  const rs = ['2026-11-10T01:00:00Z', '2026-11-10T02:00:00Z', '2026-11-10T03:00:00Z'].map((t) => makeRecord(out('ok', t)));
  assert.deepEqual(mergeRecords([], rs).records, mergeRecords([], [...rs].reverse()).records);
});

test('the review sheet is blind: Ellis\'s verdict and answer are not on it', () => {
  const { records } = mergeRecords([], [makeRecord(out('problem'))]);
  const sheet = reviewSheet(records);
  const text = JSON.stringify(sheet);
  assert.doesNotMatch(text, /"problem"|"ok"|secret_answer|severity|blind_spots/);
  assert.equal(sheet.rows[0].reference.verdict, null);
  assert.deepEqual(sheet.rows[0].rows_to_check, records[0].output.evidence);
  assert.match(sheet.instructions, /left off this sheet on purpose/);
});

test('regenerating the sheet keeps what a person already filled in', () => {
  const a = makeRecord(out('ok', '2026-11-10T01:00:00Z'));
  const b = makeRecord(out('ok', '2026-11-10T02:00:00Z'));
  const sheet = reviewSheet([a]);
  fill(sheet, a.id, 'problem');
  const again = reviewSheet([a, b], sheet);
  assert.equal(again.rows.find((r) => r.id === a.id)?.reference.verdict, 'problem');
  assert.equal(again.rows.find((r) => r.id === b.id)?.reference.verdict, null);
});

test('pair: filled rows become references, blank rows wait, orphans are listed not scored', () => {
  const a = makeRecord(out('ok', '2026-11-10T01:00:00Z'));
  const b = makeRecord(out('problem', '2026-11-10T02:00:00Z'));
  const sheet = reviewSheet([a, b]);
  fill(sheet, a.id, 'problem');
  sheet.rows.push({ ...sheet.rows[0], id: 'obs-orphan', reference: { verdict: 'ok', source: 'x', approved_by: 'K.D.', approved_at: null } });
  const r = pair([a, b], sheet);
  assert.equal(r.observations.length, 2);
  assert.equal(r.observations.find((o) => o.id === a.id)?.reference?.verdict, 'problem');
  assert.equal(r.observations.find((o) => o.id === b.id)?.reference, null);
  assert.deepEqual(r.awaiting_review, [b.id]);
  assert.deepEqual(r.orphaned, ['obs-orphan']);
});

test('pair refuses a repeated row, a verdict other than problem or ok, and a reference that names no source', () => {
  const a = makeRecord(out('ok'));
  const dup = reviewSheet([a]);
  dup.rows.push(dup.rows[0]);
  assert.throws(() => pair([a], dup), /appears twice/);
  const bad = reviewSheet([a]);
  bad.rows[0].reference = { verdict: 'fine' as 'ok', source: 'reviewed', approved_by: 'K.D.', approved_at: null };
  assert.throws(() => pair([a], bad), /verdict must be problem, ok or null/);
  const noSource = reviewSheet([a]);
  noSource.rows[0].reference = { verdict: 'ok', source: ' ', approved_by: 'K.D.', approved_at: null };
  assert.throws(() => pair([a], noSource), /where the reviewer looked/);
});

test('an unsigned reference passes through and is then not scored by the shadow run', () => {
  const a = makeRecord(out('ok'));
  const sheet = reviewSheet([a]);
  fill(sheet, a.id, 'problem', null);
  const { observations } = pair([a], sheet);
  const report = evaluateShadow(observations, { owner: 'K.D.', status: 'test', tools: {} });
  assert.deepEqual(report.tools[0].unreferenced, [a.id]);
  assert.equal(report.tools[0].scored, 0);
});

test('end to end on the example exports: record, blind sheet, signed review, scored', () => {
  const table = loadSeverityTable();
  const cron = makeRecord(recordMonitor('cron_health', 'examples/cron-health.example.json', table));
  const orch = makeRecord(recordMonitor('orchestration_health', 'examples/orchestration-health.example.json', table));
  const { records } = mergeRecords([], [cron, orch]);
  const sheet = reviewSheet(records);
  fill(sheet, cron.id, 'problem');
  fill(sheet, orch.id, 'ok');
  const { observations, awaiting_review } = pair(records, sheet);
  assert.deepEqual(awaiting_review, []);
  const report = evaluateShadow(observations, { owner: 'K.D.', status: 'test', tools: {} });
  assert.equal(report.judgement, 'not_judged');
  assert.equal(report.tools.reduce((n, t) => n + t.scored, 0), 2);
  assert.equal(report.acted_on, false);
});

test('recorders refuse an unknown monitor and report a missing export as unavailable', () => {
  const table = loadSeverityTable();
  assert.throws(() => recordMonitor('weather', 'examples/cron-health.example.json', table), /no recorder for monitor/);
  assert.throws(() => recordMonitor('cron_health', 'no-such-export.json', table), SourceUnavailable);
});

test('CLI: record twice, sheet, pair; blank sheet exits 3; bad mode exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-obs-'));
  const run = (...args: string[]) => spawnSync(process.execPath, ['src/cli/shadowObservations.ts', ...args], { encoding: 'utf8' });
  const rec = ['--mode', 'record', '--monitor', 'cron_health', '--snapshot', 'examples/cron-health.example.json', '--records', join(dir, 'r.json')];
  assert.equal(run(...rec).status, 0);
  assert.equal(JSON.parse(run(...rec).stdout).added, 0);
  assert.equal(run('--mode', 'sheet', '--records', join(dir, 'r.json'), '--sheet', join(dir, 's.json')).status, 0);
  const blank = run('--mode', 'pair', '--records', join(dir, 'r.json'), '--sheet', join(dir, 's.json'), '--out', join(dir, 'o.json'));
  assert.equal(blank.status, 3);
  const sheet = JSON.parse(readFileSync(join(dir, 's.json'), 'utf8')) as ReviewSheet;
  sheet.rows[0].reference = { verdict: 'ok', source: 'reviewed', approved_by: 'K.D.', approved_at: '2026-11-11' };
  writeFileSync(join(dir, 's.json'), JSON.stringify(sheet));
  assert.equal(run('--mode', 'pair', '--records', join(dir, 'r.json'), '--sheet', join(dir, 's.json'), '--out', join(dir, 'o.json')).status, 0);
  const bad = run('--mode', 'guess');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).error_class, 'ContractViolation');
});
