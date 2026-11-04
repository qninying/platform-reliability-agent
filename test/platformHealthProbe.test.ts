import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { probeHealth, ALWAYS_REPORTED, PROBES_CANNOT_SEE, type HealthCheck, type HealthFullExport } from '../src/capabilities/platformHealthProbe.ts';

// Check names, details and thresholds follow systemHealthService.ts at cc1ebc5; values are test inputs, not production data.
const NOW = '2026-10-27T15:10:00Z';
const ok = (name: string, detail = 'fine', metric = 1): HealthCheck => ({ name, severity: 'ok', detail, metric });
const allOk = () => ALWAYS_REPORTED.map((n) => ok(n));
const exp = (checks: HealthCheck[], over: Partial<HealthFullExport['report'] & object> = {}): HealthFullExport => ({
  captured_at: NOW, captured_by: 'test',
  report: { timestamp: '2026-10-27T15:05:00Z', overall_status: checks.some((c) => c.severity === 'critical') ? 'critical' : checks.some((c) => c.severity === 'warning') ? 'warning' : 'ok', duration_ms: 500, checks, ...over },
});
const state = (a: ReturnType<typeof probeHealth>, name: string) => a.checks.find((c) => c.name === name)?.state;

test('acceptance: the report names "scheduler never registered" as undetectable by GET /health, on every answer', () => {
  for (const a of [probeHealth(exp(allOk()), NOW), probeHealth(null, NOW)]) {
    const spot = a.cannot_see.find((b) => /never registered/.test(b.what));
    assert.ok(spot, 'the disclosure is always present');
    assert.match(spot!.what, /undetectable by GET \/health/);
    assert.match(spot!.ref, /healthRoutes\.ts:7-15/);
  }
});

test('every always-reported check present and passing, in a fresh report, is ok', () => {
  const a = probeHealth(exp(allOk()), NOW);
  assert.equal(a.verdict, 'ok');
  assert.deepEqual(a.platform_says_ok_but, []);
});

test('a check missing from the report is unknown, because the platform drops a check that throws', () => {
  const a = probeHealth(exp(allOk().filter((c) => c.name !== 'memory_pressure')), NOW);
  assert.equal(state(a, 'memory_pressure'), 'unknown');
  assert.equal(a.verdict, 'partly_unknown');
  assert.match(a.platform_says_ok_but[0], /memory_pressure: .*dropped/);
});

test('"Check failed" is unknown, not a warning about the subsystem', () => {
  const checks = allOk().map((c) => (c.name === 'scheduler_liveness' ? { name: c.name, severity: 'warning' as const, detail: 'Check failed: timeout' } : c));
  const a = probeHealth(exp(checks), NOW);
  assert.equal(state(a, 'scheduler_liveness'), 'unknown');
  assert.equal(a.verdict, 'partly_unknown');
});

test('no email in the window is not health: email_delivery reads unknown though the platform says ok', () => {
  const checks = allOk().map((c) => (c.name === 'email_delivery' ? ok('email_delivery', 'No email activity in the last 2 hours.', 0) : c));
  const a = probeHealth(exp(checks), NOW);
  assert.equal(state(a, 'email_delivery'), 'unknown');
  assert.equal(a.platform_overall, 'ok');
  assert.notEqual(a.verdict, 'ok');
});

test('a warning or critical that ran is a problem, and a problem outranks an unknown', () => {
  const checks = allOk().filter((c) => c.name !== 'frontend_nginx').map((c) => (c.name === 'memory_pressure' ? { name: c.name, severity: 'critical' as const, detail: 'Heap usage at 93%', metric: 93 } : c));
  const a = probeHealth(exp(checks), NOW);
  assert.equal(state(a, 'memory_pressure'), 'problem');
  assert.equal(a.verdict, 'problem');
});

test('a report older than 30 minutes, in the future, or undated says nothing about now', () => {
  assert.equal(probeHealth(exp(allOk(), { timestamp: '2026-10-27T14:39:00Z' }), NOW).verdict, 'unknown');
  assert.equal(probeHealth(exp(allOk(), { timestamp: '2026-10-27T14:40:00Z' }), NOW).verdict, 'ok', 'exactly 30 minutes is still fresh');
  assert.equal(probeHealth(exp(allOk(), { timestamp: '2026-10-27T15:20:00Z' }), NOW).verdict, 'unknown');
  const undated = probeHealth(exp(allOk(), { timestamp: 'yesterday' }), NOW);
  assert.equal(undated.verdict, 'unknown');
  assert.match(undated.platform_says_ok_but[0], /undated/);
});

test('no export is unknown, never healthy', () => {
  const a = probeHealth(null, NOW);
  assert.equal(a.verdict, 'unknown');
  assert.deepEqual(a.checks, []);
  assert.equal(probeHealth({ captured_at: NOW, captured_by: 't', report: null }, NOW).verdict, 'unknown');
});

test('the blind spots name the window, the two-hour clock at boot, the one heartbeat and the unrecorded monitor', () => {
  const all = PROBES_CANNOT_SEE.map((b) => b.what).join(' | ');
  for (const re of [/weekdays between 07:00 and 18:00 Central/, /first alert waits two hours/, /heartbeat of one job/, /no ai_agents row/, /once every two hours/, /dropped/]) assert.match(all, re);
  for (const b of PROBES_CANNOT_SEE) assert.ok(b.ref.length > 0, b.what);
});

test('the same export always gives the same answer', () => {
  const e = exp(allOk().reverse());
  assert.deepEqual(probeHealth(e, NOW), probeHealth(exp(allOk()), NOW));
});

test('the command adds the probes to the posture and exits 3 when they are partly unknown', () => {
  const ex = JSON.parse(readFileSync('examples/health-full.example.json', 'utf8')) as HealthFullExport;
  assert.equal(ex.report!.overall_status, 'ok');
  const r = spawnSync(process.execPath, ['src/cli/resiliencePosture.ts', '--snapshot', 'examples/resilience-posture.example.json', '--health-full', 'examples/health-full.example.json', '--now', NOW], { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(JSON.parse(r.stdout).platform_probes.verdict, 'partly_unknown');
  const bad = spawnSync(process.execPath, ['src/cli/resiliencePosture.ts', '--snapshot', 'examples/resilience-posture.example.json', '--health-full', 'examples/does-not-exist.json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});
