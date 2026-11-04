import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, loadRetentionFixture, isOld, type RetentionFixture, type Seeded } from '../src/capabilities/retentionSweepRehearsal.ts';
import { sweepRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox copy with invented ids, and its stated rule is a test input: not production data.
const FIXTURE = 'examples/retention-sweep.fixture.json';
const load = (): RetentionFixture => loadRetentionFixture(FIXTURE);
const NOW = '2026-11-04T15:00:00Z';
const daysAgo = (d: number, s = 0) => new Date(Date.parse(NOW) - d * 86_400_000 - s * 1000).toISOString();
const row = (id: string, at: string, expect: Seeded['expect']): Seeded => ({ decision_id: id, timestamp: at, expect });
const RULE = { days: 30, boundary: 'older_than' as const, source: 'test' };
const fx = (decisions: Seeded[], over: Partial<RetentionFixture> = {}): RetentionFixture =>
  ({ fixture_id: 't', description: 't', now: NOW, batch_limit: 2, stated_rule: RULE, decisions, strategic_actions: [], company_directives: [], ...over });
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };

test('acceptance (R4): rows exactly at the boundary are handled per the stated rule, dependents survive, and a second run deletes zero rows', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  const got = (id: string) => r.rows.find((x) => x.decision_id === id)!.got;
  assert.deepEqual([got('d-edge-before'), got('d-edge'), got('d-edge-after')], ['deleted', 'kept', 'kept'], 'older_than: a row exactly 30 days old is kept');
  assert.deepEqual([got('d-ref-action'), got('d-ref-directive')], ['held', 'held']);
  assert.deepEqual(r.ellis_losses, { unarchived_deleted: [], references_broken: [] });
  assert.deepEqual([r.runs[1].deleted, r.runs[1].archived], [[], []]);
  assert.match(r.statement, /Sandbox only; nothing reached a database/);
});

test('the boundary follows the stated rule: at_or_older removes the row exactly at the boundary, older_than keeps it', () => {
  const edge = row('edge', daysAgo(30), 'kept');
  assert.equal(isOld(edge, Date.parse(NOW), RULE), false);
  assert.equal(isOld(edge, Date.parse(NOW), { ...RULE, boundary: 'at_or_older' }), true);
  const seeded = [row('edge', daysAgo(30), 'deleted'), row('new', daysAgo(1), 'kept'), row('ref', daysAgo(40), 'held')];
  const r = rehearse(fx(seeded, { stated_rule: { ...RULE, boundary: 'at_or_older' }, strategic_actions: [{ id: 's', decision_id: 'ref' }] }));
  assert.equal(r.rows.find((x) => x.decision_id === 'edge')!.got, 'deleted');
});

test('every row is archived before it is deleted, and deletes happen in batches no larger than the limit', () => {
  const r = rehearse(load());
  assert.deepEqual([...r.runs[0].deleted].sort(), [...r.runs[0].archived].sort());
  assert.ok(r.runs[0].batches >= 2 && r.runs[0].deleted.length === 6, '6 old rows in batches of 3');
});

test('a row whose archive write fails is kept, not deleted unarchived, and is not retried in a loop within the run', () => {
  const r = rehearse(load());
  assert.equal(r.rows.find((x) => x.decision_id === 'd-archive-fails')!.got, 'kept');
  assert.deepEqual(r.runs[0].archive_failed, ['d-archive-fails']);
  assert.deepEqual(r.runs[1].archive_failed, ['d-archive-fails'], 'the next run tries it once more, and still does not delete it');
  assert.match(r.statement, /1 row\(s\) kept because their archive write failed/);
  const none = rehearse({ ...load(), archive_fails: [] });
  assert.equal(none.checks.every_delete_archived, false, 'with no failing archive write the archive check was not exercised');
});

test('with no stated rule the sweep is not run and nothing is verified: Ellis does not sweep against a window it was not given', () => {
  const f = load();
  const r = rehearse({ ...f, stated_rule: null });
  assert.equal(r.verified, false);
  assert.deepEqual(r.runs, []);
  assert.match(r.statement, /no stated retention rule/);
  assert.equal(sweepRehearsalOutput(r, { captured_at: NOW, captured_by: 'test' }, EMPTY).verdict, 'unknown');
});

test('on the same seed the platform\'s cycle deletes rows it never archived and rows other tables reference', () => {
  const r = rehearse(load());
  assert.deepEqual(r.platform_control.losses.unarchived_deleted, ['d-archive-fails', 'd-old-1', 'd-old-2']);
  assert.deepEqual(r.platform_control.losses.references_broken, ['d-ref-action']);
  assert.match(r.statement, /platform's cycle deleted 3 row\(s\) never archived and removed 1 row\(s\) other tables still reference/);
});

test('a seed with no referenced row, nothing at the boundary, or nothing the control loses is not verified', () => {
  const plain = rehearse(fx([row('old', daysAgo(40), 'deleted'), row('edge', daysAgo(30), 'kept')]));
  assert.equal(plain.checks.dependents_survive, false, 'no referenced row: the dependent check was not exercised');
  const noEdge = rehearse(fx([row('old', daysAgo(40), 'deleted'), row('ref', daysAgo(40), 'held')], { strategic_actions: [{ id: 's', decision_id: 'ref' }] }));
  assert.equal(noEdge.checks.boundary_per_stated_rule, false, 'nothing at the boundary: the boundary was not exercised');
  const one = rehearse(fx([row('new', daysAgo(1), 'kept'), row('edge', daysAgo(30), 'kept')]));
  assert.equal(one.checks.control_shows_a_loss, false);
  for (const r of [plain, noEdge, one]) assert.equal(r.verified, false);
});

test('a row whose seeded expectation does not match the sweep fails the rehearsal', () => {
  const f = load();
  const r = rehearse({ ...f, decisions: f.decisions.map((d) => (d.decision_id === 'd-edge' ? { ...d, expect: 'deleted' as const } : d)) });
  assert.equal(r.checks.boundary_per_stated_rule, false);
  assert.equal(r.verified, false);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified sweep is ok citing every row, and the platform\'s losses are named as the control\'s, not Ellis\'s', () => {
  const r = rehearse(load());
  const o = sweepRehearsalOutput(r, { captured_at: NOW, captured_by: 'test' }, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, r.rows.length);
  assert.match(o.as_of.note!, /sandbox fixture retention-sweep-sandbox-1, not production/);
  assert.ok(o.blind_spots.some((b) => /the platform's cycle, on the same seed, deleted rows it never archived: d-archive-fails, d-old-1, d-old-2/.test(b)));
});

test('the command exits 0 when verified, 3 with no stated rule, and 1 for a missing or malformed fixture', () => {
  const ok = spawnSync(process.execPath, ['src/cli/retentionSweepRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  assert.equal(spawnSync(process.execPath, ['src/cli/retentionSweepRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, ['src/cli/retentionSweepRehearsal.ts', '--fixture', 'test/fixtures/retention-sweep-no-rule.json'], { encoding: 'utf8' }).status, 3);
  const missing = spawnSync(process.execPath, ['src/cli/retentionSweepRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
  assert.throws(() => loadRetentionFixture('test/fixtures/retention-sweep-bad-rule.json'), /stated_rule needs days > 0/);
});
