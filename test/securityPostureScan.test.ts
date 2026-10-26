import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityLogRow, AiAgentRow, DepartmentEventRow } from '../src/records.ts';
import { snapshotSource } from '../src/readSource.ts';
import { answerScan, securityPosture, SCANNERS, type ScanKind } from '../src/capabilities/securityPostureScan.ts';

// Rows are shaped as the platform's scanners and runAgent write them; they are test inputs, not
// production data. The fake key below is built at run time so no secret-shaped string sits in the repo.
const NOW = new Date('2026-10-26T12:00:00Z');
const FAKE_KEY = ['AKIA', 'TESTONLY', 'NOTAREALKEY'].join('').slice(0, 20);
const NAMES = (kind: ScanKind) => SCANNERS[kind].agentName;

test('the three scanners are the platform\'s (aiOpsScheduler.ts:329-331)', () => {
  assert.deepEqual((Object.keys(SCANNERS) as ScanKind[]).map(NAMES), ['SecretDetectionAgent', 'CodeSecurityAuditAgent', 'DependencySecurityAgent']);
});

function agent(kind: ScanKind): AiAgentRow {
  return { id: `id-${kind}`, agent_name: NAMES(kind), status: 'idle', enabled: true, schedule: null, last_run_at: null, updated_at: null };
}

function run(kind: ScanKind, id: string, hoursAgo: number, action: string, after: Record<string, unknown>, result: ActivityLogRow['result'] = 'success'): ActivityLogRow {
  return { id, agent_id: `id-${kind}`, action: `1 action(s): ${action}`, result, created_at: iso(hoursAgo), details: { actions: [{ action, after_state: after }] } };
}

function event(kind: ScanKind, id: string, hoursAgo: number, metadata: Record<string, unknown>): DepartmentEventRow {
  return { id, department_id: 'dept', event_type: 'security_scan', title: 't', created_at: iso(hoursAgo), metadata: { agent: NAMES(kind), ...metadata } };
}

function iso(hoursAgo: number) {
  return new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
}

function ask(kind: ScanKind, opts: { agents?: AiAgentRow[]; runs?: ActivityLogRow[]; events?: DepartmentEventRow[] }) {
  const src = snapshotSource({ captured_at: NOW.toISOString(), captured_by: 'test', ai_agents: opts.agents ?? [agent(kind)], ai_agent_activity_logs: opts.runs ?? [], department_events: opts.events ?? [] });
  return answerScan(src, kind, { now: NOW });
}

test("acceptance: a scan that has never run returns 'unknown', not 'no findings', for all three kinds", () => {
  for (const kind of ['secret', 'code', 'dependency'] as ScanKind[]) {
    const a = ask(kind, {});
    assert.equal(a.status, 'unknown', kind);
    assert.match(a.reason, /never run/);
    assert.equal(a.findings_count, null, 'no count is invented for a scan that never ran');
  }
});

test("a scanner with no ai_agents row is 'unknown'", () => {
  assert.equal(ask('secret', { agents: [] }).status, 'unknown');
});

test("a failed run is not a scan: only failed runs on record is still 'never run'", () => {
  const a = ask('dependency', { runs: [run('dependency', 'r1', 1, 'dependency_audit', { projects_audited: 2, total_vulns: 0 }, 'failed')] });
  assert.equal(a.status, 'unknown');
  assert.equal(a.latest_run_failed, true);
});

test("a secret scan of 0 files is 'unknown', not clean (the production image has no source tree)", () => {
  const a = ask('secret', { runs: [run('secret', 'r1', 1, 'secret_scan', { files_scanned: 0, findings_count: 0 })], events: [event('secret', 'e1', 1, { files_scanned: 0, findings_count: 0, top_findings: [] })] });
  assert.equal(a.status, 'unknown');
  assert.match(a.reason, /0 files/);
});

test("a dependency audit of 0 projects is 'unknown', not clean", () => {
  const a = ask('dependency', { runs: [run('dependency', 'r1', 1, 'dependency_audit', { projects_audited: 0, total_vulns: 0 })] });
  assert.equal(a.status, 'unknown');
});

test("a code audit skipped for lack of source is 'unknown'", () => {
  const a = ask('code', { runs: [run('code', 'r1', 1, 'scan_skipped_no_source', { skipped: true })] });
  assert.equal(a.status, 'unknown');
  assert.match(a.reason, /skipped/);
});

test("a scan that examined files and found nothing is 'clean', with when and how many", () => {
  const a = ask('secret', { runs: [run('secret', 'r1', 1, 'secret_scan', { files_scanned: 900, findings_count: 0 })], events: [event('secret', 'e1', 1, { files_scanned: 900, findings_count: 0, top_findings: [] })] });
  assert.equal(a.status, 'clean');
  assert.deepEqual(a.coverage, { unit: 'files', count: 900 });
  assert.equal(a.last_scan_at, iso(1));
  assert.deepEqual(a.citations.map((c) => c.id), ['id-secret', 'r1', 'e1']);
});

test('a secret finding names where it is, never the secret: the stored snippet is not passed on', () => {
  const stored = { file: 'backend/src/config/x.ts', line: 7, pattern_name: 'AWS Access Key', severity: 'critical', snippet: `const k = '${FAKE_KEY}';`, value: FAKE_KEY };
  const a = ask('secret', { runs: [run('secret', 'r1', 1, 'secret_scan', { files_scanned: 900, findings_count: 1 })], events: [event('secret', 'e1', 1, { files_scanned: 900, findings_count: 1, top_findings: [stored] })] });
  assert.equal(a.status, 'findings');
  assert.deepEqual(a.findings, [{ file: 'backend/src/config/x.ts', line: 7, pattern_name: 'AWS Access Key', severity: 'critical' }]);
  assert.equal(JSON.stringify(securityPosture(snapshotSource({ captured_at: NOW.toISOString(), captured_by: 't', ai_agents: [agent('secret')], ai_agent_activity_logs: [], department_events: [event('secret', 'e1', 1, { files_scanned: 900, findings_count: 1, top_findings: [stored] })] }), { now: NOW })).includes(FAKE_KEY), false);
});

test('dependency findings come from the stored npm audit results', () => {
  const results = [{ directory: 'backend', critical: 1, high: 0, moderate: 0, low: 0, total: 1, advisories: [{ id: 1, title: 'Prototype pollution', severity: 'critical', module_name: 'lib', url: 'https://example.invalid/a' }] }];
  const a = ask('dependency', { runs: [run('dependency', 'r1', 2, 'dependency_audit', { projects_audited: 1, total_vulns: 1 })], events: [event('dependency', 'e1', 2, { results })] });
  assert.equal(a.status, 'findings');
  assert.equal(a.findings[0].module_name, 'lib');
  assert.equal(a.findings[0].directory, 'backend');
});

test("a scan older than two of its intervals is 'unknown': an old clean result does not describe today's code", () => {
  const a = ask('secret', { runs: [run('secret', 'r1', 9, 'secret_scan', { files_scanned: 900, findings_count: 0 })] });
  assert.equal(a.status, 'unknown');
  assert.match(a.reason, /hours old/);
});

test('a newer failed run after a clean scan is flagged on the answer', () => {
  const runs = [run('secret', 'r2', 1, 'secret_scan', {}, 'failed'), run('secret', 'r1', 3, 'secret_scan', { files_scanned: 900, findings_count: 0 })];
  const a = ask('secret', { runs });
  assert.equal(a.status, 'clean');
  assert.equal(a.latest_run_failed, true);
  assert.match(a.reason, /newest run after it failed/);
  assert.ok(a.citations.some((c) => c.id === 'r2'));
});

test('another agent\'s rows are never used', () => {
  const other = { ...run('secret', 'r1', 1, 'secret_scan', { files_scanned: 900, findings_count: 0 }), agent_id: 'someone-else' };
  assert.equal(ask('secret', { runs: [other] }).status, 'unknown');
});
