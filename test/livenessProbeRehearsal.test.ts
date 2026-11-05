import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, probe, bootProcess, flagOn, checkFixture, loadLivenessFixture, type LivenessFixture } from '../src/capabilities/livenessProbeRehearsal.ts';
import { livenessRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is a sandbox process with invented timer names: not production data.
const FIXTURE = 'examples/liveness-probe.fixture.json';
const load = (): LivenessFixture => loadLivenessFixture(FIXTURE);
const fx = (over: Partial<LivenessFixture> = {}): LivenessFixture => ({
  fixture_id: 't', description: 't', registry: ['A', 'B', 'C', 'D'], pinned_expected: 4, min_registered: 3,
  unset_values: [null], fail_to_register: ['A', 'B'], ...over,
});
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const byId = (r: ReturnType<typeof rehearse>, id: string) => r.cases.find((c) => c.id === id)!;

test('acceptance (R4): with the flag unset the probe returns non-200 while the database is healthy, the exact case the current probe returns 200 for', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  const absent = byId(r, 'flag_absent_db_healthy');
  assert.equal(absent.registered, 0);
  assert.equal(absent.ellis.status, 503);
  assert.match(absent.ellis.body.detail!, /no timers registered at boot \(ENABLE_FOLLOWUP_SCHEDULER is absent\)/);
  assert.equal(absent.platform.status, 200, 'GET /health answers 200: it only runs SELECT 1');
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
  assert.match(r.statement, /GET \/health on the same cases returned 200 in 5 case\(s\) where too few timers had registered/);
});

test('only the exact string true turns the scheduler on, as the platform parses it; empty, TRUE and 1 all leave it off', () => {
  assert.equal(flagOn('true'), true);
  for (const v of [null, '', 'TRUE', '1', 'yes']) assert.equal(flagOn(v), false, String(v));
  const r = rehearse(load());
  for (const id of ['flag_""_db_healthy', 'flag_"TRUE"_db_healthy', 'flag_"1"_db_healthy']) {
    assert.deepEqual([byId(r, id).registered, byId(r, id).ellis.status, byId(r, id).platform.status], [0, 503, 200], id);
  }
});

test('a process that registered every timer passes with its count and the pinned expected count in the body', () => {
  const ok = byId(rehearse(load()), 'flag_true_db_healthy');
  assert.deepEqual(ok.ellis, { status: 200, body: { status: 'ok', detail: null, registered: 8, expected: 8 } });
});

test('a count above zero but below the pinned floor fails the probe; at the floor it passes', () => {
  const short = byId(rehearse(load()), 'flag_true_some_fail_to_register');
  assert.equal(short.registered, 5);
  assert.equal(short.ellis.status, 503);
  assert.match(short.ellis.body.detail!, /5 timers registered at boot, below the pinned floor of 6/);
  assert.equal(short.platform.status, 200);
  const f = fx();
  assert.deepEqual(probe(bootProcess(f, 'true', true, ['A']), f, 'ellis'), { status: 200, body: { status: 'ok', detail: null, registered: 3, expected: 4 } }, '3 registered meets a floor of 3');
  assert.equal(probe(bootProcess(f, 'true', true, ['A', 'B']), f, 'ellis').status, 503);
});

test('a down database still fails, and says so before anything about timers', () => {
  const r = rehearse(load());
  for (const id of ['flag_true_db_down', 'flag_absent_db_down']) {
    assert.deepEqual(byId(r, id).ellis, { status: 503, body: { status: 'error', detail: 'database unreachable' } }, id);
    assert.equal(byId(r, id).platform.status, 503);
  }
});

test('graded as the subject, GET /health fails the flag and shortfall checks; with Ellis\'s probe as the control, the positive control fails', () => {
  const r = rehearse(load(), { subject: 'platform', control: 'ellis' });
  assert.deepEqual(r.checks, {
    flag_unset_fails_probe: false, positive_control_returns_200: false, healthy_process_passes: true,
    shortfall_fails_probe: false,
  });
  assert.equal(r.verified, false);
  assert.match(r.statement, /not verified: flag_unset_fails_probe, positive_control_returns_200, shortfall_fails_probe/);
});

test('a fixture whose failures leave nothing registered, with no unset value, or with a floor the registry cannot reach is not verified', () => {
  const all = rehearse(fx({ fail_to_register: ['A', 'B', 'C', 'D'] }));
  assert.equal(all.checks.shortfall_fails_probe, false, 'zero registered is the flag case, not a shortfall');
  const none = rehearse(fx({ unset_values: [] }));
  assert.equal(none.checks.flag_unset_fails_probe, false);
  assert.equal(none.checks.positive_control_returns_200, false);
  const healthyEmpty = rehearse(fx({ registry: ['A'], pinned_expected: 1, min_registered: 1, fail_to_register: [] }));
  assert.equal(healthyEmpty.checks.healthy_process_passes, true);
  assert.equal(healthyEmpty.checks.shortfall_fails_probe, false);
  const tooHigh = rehearse(fx({ registry: ['A', 'B'], fail_to_register: ['A'], pinned_expected: 4, min_registered: 3 }));
  assert.equal(tooHigh.checks.healthy_process_passes, false, 'a floor above the registry means the probe never passes');
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each case and says it is not production; a wrong answer is the evidence when it fails', () => {
  const c = { captured_at: '2026-11-04T23:30:00Z', captured_by: 'test' };
  const r = rehearse(load());
  const o = livenessRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 8);
  assert.match(o.as_of.note!, /sandbox fixture liveness-probe-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const f = livenessRehearsalOutput(rehearse(load(), { subject: 'platform', control: 'ellis' }), c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((e) => e.id), ['flag_absent_db_healthy', 'flag_""_db_healthy', 'flag_"TRUE"_db_healthy', 'flag_"1"_db_healthy', 'flag_true_some_fail_to_register']);
});

test('a fixture is refused with no registry, a floor outside 1 to the pinned count, or an unset value that reads as on', () => {
  const at = 'inline';
  assert.throws(() => checkFixture(fx({ registry: [] }), at), /non-empty registry/);
  assert.throws(() => checkFixture(fx({ registry: [1] as never }), at), /non-empty registry/);
  assert.throws(() => checkFixture(fx({ fail_to_register: undefined as never }), at), /fail_to_register/);
  assert.throws(() => checkFixture(fx({ min_registered: 0 }), at), /from 1 to pinned_expected/);
  assert.throws(() => checkFixture(fx({ min_registered: 5 }), at), /from 1 to pinned_expected/);
  assert.throws(() => checkFixture(fx({ pinned_expected: 3.5 }), at), /from 1 to pinned_expected/);
  assert.throws(() => checkFixture(fx({ unset_values: ['true'] }), at), /other than 'true'/);
  assert.throws(() => checkFixture(fx({ unset_values: [1] as never }), at), /other than 'true'/);
  assert.equal(checkFixture(fx({ min_registered: 4 }), at).min_registered, 4);
});

test('the command exits 0 when verified, 3 when not, and 1 for a missing fixture', () => {
  const ok = spawnSync(process.execPath, ['src/cli/livenessProbeRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verified, true);
  const not = spawnSync(process.execPath, ['src/cli/livenessProbeRehearsal.ts', '--fixture', 'test/fixtures/liveness-probe-no-shortfall.json'], { encoding: 'utf8' });
  assert.equal(not.status, 3, not.stderr);
  assert.equal(JSON.parse(not.stdout).checks.shortfall_fails_probe, false);
  assert.equal(spawnSync(process.execPath, ['src/cli/livenessProbeRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/livenessProbeRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
