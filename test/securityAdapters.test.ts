import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSnapshot, snapshotSource } from '../src/readSource.ts';
import { securityPosture, type ScanAnswer } from '../src/capabilities/securityPostureScan.ts';
import { securityRollup, type Rollup } from '../src/capabilities/securityOversightRollup.ts';
import { loadAccessSnapshot } from '../src/access/accessSnapshot.ts';
import { accessReport, accessSweep } from '../src/capabilities/runtimeThreatAccessWatch.ts';
import { behaviorWatch, type BehaviorSnapshot, type BehaviorReport } from '../src/capabilities/agentBehaviorSafetyWatch.ts';
import type { AuthorityAnswer } from '../src/capabilities/autonomyAuthority.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { postureOutput, accessOutput, behaviorOutput, rollupOutput, authorityOutput } from '../src/output/securityAdapters.ts';

// Inputs are the repository's examples, or answers written in the checks' own shapes: not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const CAP = { captured_at: '2026-11-04T12:00:00Z', captured_by: 'test' };

function holds<D>(o: ToolOutput<D>, detail: D) {
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no evidence`);
  if (o.verdict === 'partly_unknown' || o.verdict === 'unknown') assert.ok(o.blind_spots.length > 0, `${o.tool}: ${o.verdict} names no blind spot`);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned');
  assert.equal(o.detail, detail);
}

const scan = (kind: ScanAnswer['scan'], status: ScanAnswer['status'], severity: string | null = null): ScanAnswer => ({
  scan: kind, agent_name: `${kind}-agent`, status, reason: `${kind} ${status}`, last_scan_at: CAP.captured_at, coverage: null,
  findings_count: severity ? 1 : 0, findings: severity ? [{ file: 'x.ts', severity }] : [], latest_run_failed: false,
  citations: [{ table: 'ai_agent_activity_logs', id: `run-${kind}`, fields: ['result'] }],
});

test('posture: the example holds the contract; findings are a problem citing those scans, with the scanner\'s top severity as the signal', () => {
  const snap = loadSnapshot('examples/security-posture.example.json');
  const scans = securityPosture(snapshotSource(snap), { now: new Date(snap.captured_at) });
  holds(postureOutput(scans, snap, EMPTY), scans);
  const mixed = [scan('secret', 'findings', 'high'), scan('code', 'findings', 'critical'), scan('dependency', 'clean')];
  const o = postureOutput(mixed, CAP, EMPTY);
  holds(o, mixed);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), ['run-secret', 'run-code']);
  assert.equal(o.platform_signal, 'highest scanner finding severity: critical');
  assert.equal(o.severity, 'unassigned', 'a scanner severity is a signal, never Ellis\'s severity');
});

test('posture: all clean is ok; a stale scan beside clean ones is partly unknown; all unknown is unknown', () => {
  assert.equal(postureOutput([scan('secret', 'clean'), scan('code', 'clean')], CAP, EMPTY).verdict, 'ok');
  const part = [scan('secret', 'clean'), scan('code', 'unknown')];
  const p = postureOutput(part, CAP, EMPTY);
  holds(p, part);
  assert.equal(p.verdict, 'partly_unknown');
  assert.deepEqual(p.blind_spots, ['code scan: code unknown']);
  assert.equal(postureOutput([scan('code', 'unknown')], CAP, EMPTY).verdict, 'unknown');
});

test('access watch: the example holds the contract; with no previous sweep, change is unknown, not nothing', () => {
  const snap = loadAccessSnapshot('examples/access-watch.example.json');
  const r = accessReport(snap, null);
  const o = accessOutput(r, snap, EMPTY);
  holds(o, r);
  assert.ok(o.blind_spots.includes('no previous sweep was given, so what changed is unknown, not nothing'));
  for (const l of r.limits) assert.ok(o.blind_spots.includes(l), 'the two platform limits travel with every answer');
});

test('access watch: an identity that gained access since the last sweep is a problem citing its rows', () => {
  const snap = loadAccessSnapshot('examples/access-watch.example.json');
  const now = accessSweep(snap);
  const before = { ...now, identities: now.identities.slice(1) };
  const r = accessReport(snap, before);
  const o = accessOutput(r, snap, EMPTY);
  holds(o, r);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  const added = now.identities[0];
  for (const c of added.citations) assert.ok(o.evidence.some((e) => e.id === c.id), c.id);
  // Only the identities under review are cited, not everyone in the sweep.
  const flagged = new Set([added.email, ...now.identities.filter((i) => i.status === 'bridge_only').map((i) => i.email)]);
  const theirs = new Set(now.identities.filter((i) => flagged.has(i.email)).flatMap((i) => i.citations.map((c) => c.id)));
  for (const e of o.evidence.filter((x) => x.table !== 'audit_logs')) assert.ok(theirs.has(e.id), `${e.id} is not under review`);
});

test('access watch: nobody to review and no previous sweep is partly unknown, never ok', () => {
  const snap = loadAccessSnapshot('examples/access-watch.example.json');
  const r = accessReport(snap, null);
  const calm = { ...r, sweep: { ...r.sweep, identities: r.sweep.identities.filter((i) => i.status !== 'bridge_only') } };
  assert.ok(calm.sweep.identities.length > 0);
  const o = accessOutput(calm, snap, EMPTY);
  holds(o, calm);
  assert.equal(o.verdict, 'partly_unknown');
});

test('behaviour watch: the example holds the contract; a write outside its grant is a problem citing that row', () => {
  const snap: BehaviorSnapshot = JSON.parse(readFileSync('examples/behavior-watch.example.json', 'utf8'));
  const r = behaviorWatch(snap, { now: new Date(snap.captured_at), windowHours: 24 * 365 });
  const o = behaviorOutput(r, snap, EMPTY);
  holds(o, r);
  if (r.findings.length) {
    assert.equal(o.verdict, 'problem');
    assert.deepEqual(o.evidence.map((e) => e.id), r.findings.map((f) => f.citation.id));
  }
});

test('behaviour watch: a clean window keeps no row ids, so it is unknown with the count it examined, never ok', () => {
  const r: BehaviorReport = { as_of: CAP.captured_at, window_hours: 24, grants_commit: 'abc', findings: [], unattributable: [], not_emitted: [], excluded_self: 0, rows_examined: { write_audits: 3, state_changes: 2, authorization_events: 0 } };
  const o = behaviorOutput(r, CAP, EMPTY);
  holds(o, r);
  assert.equal(o.verdict, 'unknown');
  assert.match(o.blind_spots[0], /^5 row\(s\) examined in 24 hours/);
  const allowed = { ...r, findings: [{ agent_name: 'A', agent_id: 'a', action: 'write', missing_grant: { kind: 'table' as const, name: 't', held: 'none' }, grant_source: 'agent_grant' as const, platform_verdict: 'allowed' as const, at: CAP.captured_at, citation: { table: 'agent_write_audits' as const, id: 'w1' } }] };
  assert.equal(behaviorOutput(allowed, CAP, { ...EMPTY, rules: [{ tool: 'platform.CAP.agent_behavior_safety_watch', case: 'write_outside_grant_allowed', severity: 'High', why: 'the platform let it through' }] }).severity, 'High');
});

test('security rollup: the example holds the contract; red is a problem, unknown is never green, and the director\'s read is a signal', () => {
  const snap = loadSnapshot('examples/security-rollup.example.json');
  const r = securityRollup(snapshotSource(snap), { now: new Date(snap.captured_at) });
  holds(rollupOutput(r, snap, EMPTY), r);
  const c = (name: string, k: 'clean' | 'dirty' | 'unknown') => ({ agent_name: name, contribution: k, reason: `${name} ${k}`, last_run_at: null, citations: [{ table: 'ai_agent_activity_logs' as const, id: `run-${name}`, fields: ['result'] }] });
  const red: Rollup = { verdict: 'red', reason: 'r', escalate: false, counts: { clean: 1, dirty: 1, unknown: 0 }, contributions: [c('A', 'clean'), c('B', 'dirty')], platform_director: { verdict: 'healthy', at: null, disagrees: true, citation: null } };
  const o = rollupOutput(red, CAP, EMPTY);
  holds(o, red);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), ['run-B']);
  assert.equal(o.platform_signal, 'security director reads healthy, which Ellis does not');
  const part: Rollup = { ...red, verdict: 'unknown', contributions: [c('A', 'clean'), c('C', 'unknown')] };
  assert.equal(rollupOutput(part, CAP, EMPTY).verdict, 'partly_unknown');
  const none: Rollup = { ...red, verdict: 'unknown', reason: 'no scanners contribute', contributions: [] };
  const n = rollupOutput(none, CAP, EMPTY);
  holds(n, none);
  assert.equal(n.verdict, 'unknown');
});

const authority = (match: boolean, ids: string[]): AuthorityAnswer => ({
  source_commit: 'abc', rules_match: match, rule_lines_missing: match ? [] : ['line'], statement: match ? 's' : 'unconfirmed: 1 rule line not found',
  counts: { capabilities: ids.length, no_authority: 0, resolved: ids.length },
  authorities: ids.map((id) => ({ capability_id: id, environment: 'sandbox' as const, effective_autonomy: 'autonomy:R1', binding_constraint: 'approved_level' as const, reasons: [], approved_autonomy: 'autonomy:R1', ceiling: 'autonomy:R2', granted_tools: [], human_decision: false, statement: 's' })),
  human_decision: { granting_or_raising_a_level: 'person_only', ellis_may: 'report' }, limits: ['from the commit, not the running system', 'grants listed, not issued', 'third'],
});

test('autonomy authority: resolved levels are ok citing each capability record; rules that do not match are unknown', () => {
  const a = authority(true, ['platform.CAP.x']);
  const o = authorityOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'ok');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['capability_record', 'platform.CAP.x']]);
  assert.deepEqual(o.blind_spots, ['from the commit, not the running system', 'grants listed, not issued']);
  const drift = authority(false, ['platform.CAP.x']);
  const u = authorityOutput(drift, CAP, EMPTY);
  holds(u, drift);
  assert.equal(u.verdict, 'unknown');
  assert.equal(u.blind_spots[0], 'unconfirmed: 1 rule line not found');
});
