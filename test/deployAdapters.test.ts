import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ReadinessAnswer } from '../src/capabilities/deployReadiness.ts';
import { judgeRelease, type Evidence as ReleaseEvidence } from '../src/capabilities/deployVerificationEvidence.ts';
import type { PositionAnswer } from '../src/capabilities/backupRestoreVerification.ts';
import type { DriftAnswer } from '../src/capabilities/schemaDriftDetection.ts';
import { reapingReport, REAPER, type PreviewSnapshot } from '../src/capabilities/previewStackReaping.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { readinessOutput, releaseOutput, backupOutput, driftOutput, previewOutput } from '../src/output/deployAdapters.ts';

// Inputs are the repository's examples, or answers written in the checks' own shapes: not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'));
const CAP = { captured_at: '2026-11-04T12:00:00Z', captured_by: 'test' };

function holds<D>(o: ToolOutput<D>, detail: D) {
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no evidence`);
  if (o.verdict === 'partly_unknown' || o.verdict === 'unknown') assert.ok(o.blind_spots.length > 0, `${o.tool}: ${o.verdict} names no blind spot`);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned');
  assert.equal(o.detail, detail);
}

const readiness = (r: ReadinessAnswer['readiness'], origin: string | null = 'bbb'): ReadinessAnswer => ({
  source_commit: 'aaa', readiness: r, statement: 's', tree: { clean: r !== 'not_ready', tracked_changes: 0, untracked: 0, tracked_paths: [] },
  head: { sha: 'aaa', branch: 'main' }, origin_main: { sha: origin, read_from: origin ? 'remote' : 'none', local_ref: null, local_ref_stale: null },
  head_matches_origin_main: origin === null ? null : r === 'facts_ready', not_measured: ['Whether the change has been reviewed or approved.'],
  approval: { state: 'unknown', gate: 'g' }, isolation: 'i', grants: [], denied_in_grants: [], policy_list: { read: true, matches: true }, never_does: ['merge', 'push', 'deploy'],
  human_decision: { merging_and_deploying: 'person_only', ellis_may: 'report_and_propose' }, limits: [],
});

test('deploy readiness: not ready is a problem citing HEAD and origin/main; facts ready is ok but still names what was not measured', () => {
  const a = readiness('not_ready');
  const o = readinessOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['git', 'aaa'], ['git', 'bbb']]);
  const ok = readinessOutput(readiness('facts_ready'), CAP, EMPTY);
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual(ok.blind_spots, ['Whether the change has been reviewed or approved.']);
  const unread = readiness('unknown', null);
  const u = readinessOutput(unread, CAP, EMPTY);
  holds(u, unread);
  assert.equal(u.verdict, 'unknown');
});

test('release evidence: the example holds the contract, and a disagreeing check is a problem naming that check', () => {
  const e = json<ReleaseEvidence>('examples/release-evidence.example.json');
  const a = judgeRelease(e);
  holds(releaseOutput(a, CAP, EMPTY), a);
  const bad = judgeRelease({ ...e, deployed_sha: 'fedcba9876543210fedcba9876543210fedcba98' });
  const o = releaseOutput(bad, CAP, EMPTY);
  holds(o, bad);
  assert.equal(o.verdict, 'problem');
  assert.ok(o.evidence[0].fields.includes('deployed_sha'));
});

test('release evidence: nothing supplied is unknown, never ok', () => {
  const a = judgeRelease({});
  const o = releaseOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'unknown');
});

const position = (basis: PositionAnswer['basis'], candidates: string[]): PositionAnswer => ({
  source_commit: 'abc', position: 'unknown', basis, statement: `unknown: ${basis}`, newest_backup_age: null, restore_last_exercised: null,
  search: { terms: 't', roots_searched: [], roots_not_found: [], excluded: [], files_read: 1, files_not_read: [], control: { file: 'c', found: true }, hit_counts: { schema_only: 0, prose: 0, test: 0, candidate: candidates.length } },
  candidates: candidates.map((where) => ({ where, term: 'pg_dump', kind: 'candidate' as const, text: 'x' })), verifying_hits: [], not_evidence: [], claims_in_the_repo: [],
  policy: { recovery_objective: null, destination: null, cadence: null, agreed_by: [], to_agree: ['recovery objective'], note: 'n' },
  a_restore_counts_only_if: [], human_decision: { taking_reading_or_restoring_a_production_backup: 'person_only', ellis_may: 'report_and_propose' }, limits: [],
});

test('backup position: always unknown, citing any candidate line for a person to read, and never ok', () => {
  const a = position('candidates_need_a_person', ['scripts/n.sh:1', 'scripts/n.sh:1']);
  const o = backupOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'unknown');
  assert.deepEqual(o.evidence.map((e) => e.id), ['scripts/n.sh:1']);
  assert.deepEqual(o.blind_spots, ['unknown: candidates_need_a_person', 'recovery objective']);
  assert.equal(backupOutput(position('nothing_found', []), CAP, EMPTY).verdict, 'unknown');
});

const drift = (verdict: DriftAnswer['verdict'], alert: DriftAnswer['alert'] = null): DriftAnswer => ({
  captured_at: CAP.captured_at, source_commit: 'abc', verdict, unknown_because: verdict === 'unknown' ? 'log_not_supplied' : null, statement: 's',
  last_completed: verdict === 'unknown' ? null : { stamp: '2026-11-04T03:00:00Z', outcome: verdict === 'drift_reported' ? 'detected' : 'none', age_hours: 9, fresh: true },
  latest_attempt: null, drift: null, alert, runs: { completed: 1, incomplete: 0, dated_after_capture: 0, lines_not_read: 0 },
  axes_measured: [], axes_not_measured: [{ axis: 'indexes', status: 'unmeasured', why: 'the script does not compare them', where: null }],
  reconciler: {} as DriftAnswer['reconciler'], ensure_schema_modules: null, human_decision: { applying_any_schema_change: 'person_only', ellis_may: 'report_and_propose' }, limits: [],
});

test('schema drift: reported drift is a problem citing the log stamp, with the script\'s alert as the platform signal', () => {
  const a = drift('drift_reported', 'sent');
  const o = driftOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['schema_drift_log', '2026-11-04T03:00:00Z']]);
  assert.equal(o.platform_signal, 'the drift script sent its alert');
  assert.deepEqual(o.blind_spots, ['indexes: the script does not compare them']);
});

test('schema drift: none reported is ok with the axes it did not measure; no log is unknown with the reason', () => {
  assert.equal(driftOutput(drift('no_drift_reported'), CAP, EMPTY).verdict, 'ok');
  const a = drift('unknown');
  const o = driftOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'unknown');
  assert.equal(o.evidence.length, 0);
});

test('preview reaping: the example holds the contract; a failed stack is a problem citing that stack', () => {
  const s = json<PreviewSnapshot>('examples/preview-reaping.example.json');
  const r = reapingReport(s, { now: new Date(s.captured_at) });
  const o = previewOutput(r, s, EMPTY);
  holds(o, r);
  const failed = { ...s, preview_stacks: [{ id: 'st-f', slug: 'f', status: 'failed' as const, last_accessed_at: null, last_started_at: null }] };
  const f = previewOutput(reapingReport(failed, { now: new Date(s.captured_at) }), failed, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.ok(f.evidence.some((e) => e.id === 'st-f'));
});

test('preview reaping: a disabled reaper is a problem citing its row; nothing running and no reaper row is unknown', () => {
  const now = '2026-10-27T15:00:00Z';
  const reaper = { id: 'id-reaper', agent_name: REAPER, status: 'idle' as const, enabled: false, schedule: '*/5 * * * *', last_run_at: now, updated_at: null };
  const off: PreviewSnapshot = { captured_at: now, captured_by: 'test', preview_stacks: [], preview_events: [], ai_agents: [reaper], ai_agent_activity_logs: [] };
  const o = previewOutput(reapingReport(off, { now: new Date(now) }), off, EMPTY);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['ai_agents', 'id-reaper']]);
  const bare: PreviewSnapshot = { ...off, ai_agents: [] };
  const r = reapingReport(bare, { now: new Date(now) });
  const u = previewOutput(r, bare, EMPTY);
  holds(u, r);
  assert.equal(u.verdict, 'unknown');
});
