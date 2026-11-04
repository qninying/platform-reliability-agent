import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, boot, reload, loadDefaultOnFixture, checkFixture, type DefaultOnFixture, type RowRecord } from '../src/capabilities/defaultOnRehearsal.ts';
import { defaultOnRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox registry with invented names: not production data.
const FIXTURE = 'examples/default-on.fixture.json';
const load = (): DefaultOnFixture => loadDefaultOnFixture(FIXTURE);
const fx = (over: Partial<DefaultOnFixture> = {}): DefaultOnFixture => ({
  fixture_id: 't', description: 't',
  registry: [{ name: 'A', schedule: '* * * * *' }, { name: 'B', schedule: '* * * * *' }, { name: 'C', schedule: '* * * * *' }],
  rows: [{ agent_name: 'A', enabled: true }, { agent_name: 'B', enabled: false }], ...over,
});
const broken = (): RowRecord[] => { throw Object.assign(new Error('down'), { errorClass: 'SourceUnavailable' }); };
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };

test('acceptance (R4): with no row the timer does not start; with the table unreadable the scheduler refuses to start, where the platform\'s boot path starts everything', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(r.ungoverned, ['SandboxAuditJob', 'SandboxSyncJob']);
  assert.deepEqual(r.passes.boot.guard.running, ['SandboxDigestJob', 'SandboxReportJob']);
  assert.equal(r.passes.boot_unreadable.guard.outcome, 'refused');
  assert.deepEqual(r.passes.boot_unreadable.guard.running, []);
  assert.match(r.passes.boot_unreadable.guard.reason!, /^SourceUnavailable: /);
  assert.equal(r.passes.boot_unreadable.platform.running.length, 5, 'the positive control: every name starts');
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
});

test('graded as the subject, the platform\'s code fails every check; with the guard as the control, the positive control fails too', () => {
  const r = rehearse(load(), { subject: 'platform', control: 'guard' });
  assert.deepEqual(r.checks, {
    no_row_does_not_start: false, only_enabled_rows_start: false, unreadable_refuses_to_start: false,
    positive_control_starts_everything: false, empty_is_not_unreadable: false, reload_unreadable_changes_nothing: false,
  });
  assert.equal(r.verified, false);
});

test('the platform\'s code on the same rows starts the names with no row, and leaves only the switched-off one stopped', () => {
  const r = rehearse(load());
  assert.deepEqual(r.passes.boot.platform.running, ['SandboxAuditJob', 'SandboxDigestJob', 'SandboxReportJob', 'SandboxSyncJob']);
  assert.deepEqual(r.names.filter((x) => x.platform && !x.guard).map((x) => x.name), ['SandboxAuditJob', 'SandboxSyncJob']);
});

test('at reload an unreadable table changes nothing under the guard; the platform\'s reload re-enables the job a row switched off', () => {
  const r = rehearse(load());
  assert.equal(r.passes.reload_unreadable.guard.outcome, 'kept');
  assert.deepEqual(r.passes.reload_unreadable.guard.running, r.passes.boot.guard.running);
  assert.ok(r.passes.reload_unreadable.platform.running.includes('SandboxCleanupJob'));
  assert.match(r.statement, /reload re-enabled SandboxCleanupJob, which a row had switched off/);
});

test('a reload that reads the table does reconcile: a row switched on starts its timer, a row switched off stops it', () => {
  const f = fx();
  const next = reload(f, ['A'], () => [{ agent_name: 'A', enabled: false }, { agent_name: 'B', enabled: true }], 'guard');
  assert.deepEqual(next, { outcome: 'started', running: ['B'], reason: null });
  assert.equal(reload(f, ['A'], () => [], 'guard').outcome, 'started_none');
});

test('an empty table is read, starts nothing and says so; it is not taken for a failed read', () => {
  const r = rehearse(load());
  assert.deepEqual(r.passes.boot_empty.guard, { outcome: 'started_none', running: [], reason: 'the table was read and holds no rows' });
  assert.equal(boot(fx(), () => [{ agent_name: 'B', enabled: false }], 'guard').reason, 'no row enables a registry timer');
  assert.equal(boot(fx(), broken, 'guard').outcome, 'refused');
});

test('a name registered twice is one name; a row naming no registry entry starts nothing and is listed', () => {
  const r = rehearse(load());
  assert.equal(r.names.filter((x) => x.name === 'SandboxAuditJob').length, 1);
  assert.deepEqual(r.rows_without_registry_entry, ['SandboxRetiredJob']);
  assert.ok(!r.passes.boot.guard.running.includes('SandboxRetiredJob'));
});

test('a fixture where every name has a row exercises nothing for the no-row case, and one with nothing running cannot show reload keeps it: neither is verified', () => {
  const all = rehearse(fx({ rows: ['A', 'B', 'C'].map((n) => ({ agent_name: n, enabled: true })) }));
  assert.equal(all.checks.no_row_does_not_start, false);
  assert.equal(all.verified, false);
  const none = rehearse(fx({ rows: [{ agent_name: 'A', enabled: false }] }));
  assert.equal(none.checks.reload_unreadable_changes_nothing, false);
  assert.match(none.statement, /not verified: reload_unreadable_changes_nothing/);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each name and says it is not production; a name started with no row is the evidence when it fails', () => {
  const c = { captured_at: '2026-11-04T23:00:00Z', captured_by: 'test' };
  const r = rehearse(load());
  const o = defaultOnRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 5);
  assert.match(o.as_of.note!, /sandbox fixture default-on-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const bad = { ...r, verified: false, checks: { ...r.checks, no_row_does_not_start: false }, names: r.names.map((x) => (x.name === 'SandboxSyncJob' ? { ...x, guard: true } : x)) };
  const f = defaultOnRehearsalOutput(bad, c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((e) => e.id), ['SandboxSyncJob']);
});

test('a fixture is refused with no registry entries, an entry with no schedule, or a row with no boolean enabled', () => {
  const at = 'inline';
  assert.throws(() => checkFixture(fx({ registry: [] }), at), /non-empty registry/);
  assert.throws(() => checkFixture(fx({ registry: [{ name: 'A' } as never] }), at), /a name and a schedule/);
  assert.throws(() => checkFixture(fx({ registry: [{ schedule: '* * * * *' } as never] }), at), /a name and a schedule/);
  assert.throws(() => checkFixture(fx({ rows: [{ agent_name: 'A', enabled: 'yes' } as never] }), at), /boolean enabled/);
  assert.equal(checkFixture(fx(), at).fixture_id, 't');
});

test('the command exits 0 when verified, 3 when not, and 1 for a missing fixture or a row with no boolean enabled', () => {
  const ok = spawnSync(process.execPath, ['src/cli/defaultOnRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  const not = spawnSync(process.execPath, ['src/cli/defaultOnRehearsal.ts', '--fixture', 'test/fixtures/default-on-all-governed.json'], { encoding: 'utf8' });
  assert.equal(not.status, 3, not.stderr);
  assert.equal(JSON.parse(not.stdout).checks.no_row_does_not_start, false);
  assert.equal(spawnSync(process.execPath, ['src/cli/defaultOnRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/defaultOnRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
  assert.throws(() => loadDefaultOnFixture('test/fixtures/default-on-bad-row.json'), /boolean enabled/);
});
