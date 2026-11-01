import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { reliabilityBriefing, renderBriefing, share, LIMITS, SCOPE, DELIVERY, OPEN_DECISIONS, type BriefingInput, type Records, type Briefing } from '../src/capabilities/reliabilityReport.ts';
import type { ReconAnswer } from '../src/capabilities/registryReconciliation.ts';
import type { DriftAnswer } from '../src/capabilities/schemaDriftDetection.ts';
import type { PositionAnswer } from '../src/capabilities/backupRestoreVerification.ts';
import { FILES } from './fixtures/registryCheckout.ts';

const recon = (untracked: string[] = ['TimerA', 'TimerB'], phantom: string[] = ['GhostA']) => ({
  source_commit: 'abc1234',
  classes: { scheduledNamesWithNoSeedRow: { count: untracked.length, entries: untracked }, cronSeedRowsWithNoRegistration: { count: phantom.length, entries: phantom } },
  beyond_the_platform_reconciler: { timers_with_no_name: [{ ref: 'backend/src/server.ts:10', schedule: '* * * * *' }] },
}) as unknown as ReconAnswer;
const drift = (over: Partial<DriftAnswer> = {}) => ({ verdict: 'unknown', statement: 'unknown, last run not found', drift: null, axes_not_measured: [{ axis: 'column_shape' }], ...over }) as unknown as DriftAnswer;
const backup = { statement: 'unknown, no backup verification exists in this repository' } as PositionAnswer;
const records = (over: Partial<Records['totals']> = {}): Records => ({
  captured_at: '2026-11-01T10:00:00Z',
  totals: { rows: 4, runs: 40, failures: 3, ...over },
  agents: { scored: [{}, {}], unscored: [{ name: 'Idle' }], no_row: [{ name: 'Rowless' }] },
  cron: { alerting: [{}], clear: [{}, {}], partly_evaluated: [{}], not_evaluated: [{ name: 'Unseen' }] },
}) as unknown as Records;
const ask = (over: Partial<BriefingInput> = {}): Briefing => reliabilityBriefing({ produced_at: '2026-11-01T12:00:00Z', recon: recon(), drift: drift(), backup, records: records(), ...over });
const item = (b: Briefing, name: string) => b.unmeasured.find((u) => u.item === name);
const fig = (b: Briefing, name: string) => b.measured.find((f) => f.label === name)!;

test('the unmeasured section names the untracked timers and the phantom crons', () => {
  const b = ask();
  assert.equal(b.unmeasured[0].item, 'Untracked timers');
  assert.deepEqual(item(b, 'Untracked timers')?.names, ['TimerA', 'TimerB']);
  assert.equal(item(b, 'Untracked timers')?.count, 2);
  assert.equal(b.unmeasured[1].item, 'Phantom crons');
  assert.deepEqual(item(b, 'Phantom crons')?.names, ['GhostA']);
  const text = renderBriefing(b);
  for (const name of ['TimerA', 'TimerB', 'GhostA']) assert.ok(text.includes(name), name);
});

test('they stay present at zero rather than being omitted', () => {
  const b = ask({ recon: recon([], []) });
  assert.equal(item(b, 'Untracked timers')?.count, 0);
  assert.equal(item(b, 'Phantom crons')?.count, 0);
  assert.match(renderBriefing(b), /Untracked timers: 0/);
});

test('no percentage appears without the record count behind it', () => {
  for (const b of [ask(), ask({ records: null }), ask({ records: records({ runs: 0, failures: 0 }) })]) {
    const text = renderBriefing(b);
    for (const m of text.matchAll(/[\d.]+%/g)) {
      assert.match(text.slice(m.index), /^[\d.]+% \(\d+ of \d+ /, m[0]);
    }
    for (const f of b.measured) if (f.percent !== null) assert.ok(f.of !== null && f.of > 0 && f.value !== null, f.label);
  }
  assert.match(renderBriefing(ask()), /7\.5% \(3 of 40 runs\)/);
});

test('share never makes a percentage from an empty list', () => {
  assert.equal(share(0, 0), null);
  assert.equal(share(3, 0), null);
  assert.equal(share(null, 10), null);
  assert.equal(share(3, null), null);
  assert.equal(share(3, -1), null);
  assert.equal(share(3, 1.5), null);
  assert.equal(share(0, 10), 0);
  assert.equal(share(1, 3), 33.3);
});

test('zero runs gives no failure rate', () => {
  const f = fig(ask({ records: records({ runs: 0, failures: 0 }) }), 'Failed runs on record');
  assert.equal(f.percent, null);
  assert.doesNotMatch(renderBriefing(ask({ records: records({ runs: 0, failures: 0 }) })), /Failed runs on record: \d+(\.\d+)?%/);
});

test('with no records the figures are unknown, not zero, and it says so', () => {
  const b = ask({ records: null });
  for (const f of b.measured) {
    assert.equal(f.value, null);
    assert.equal(f.percent, null);
  }
  assert.match(item(b, 'Runs, failures and alerts')?.why ?? '', /unknown, not zero/);
  assert.match(renderBriefing(b), /Runs on record: unknown/);
  assert.equal(b.records_captured_at, null);
});

test('every figure and every unmeasured item carries a source', () => {
  for (const b of [ask(), ask({ records: null })]) {
    for (const f of b.measured) assert.ok(f.source, f.label);
    for (const u of b.unmeasured) assert.ok(u.source, u.item);
    for (const d of b.decisions) assert.ok(d.source && d.owner && d.evidence_needed, d.question);
  }
});

test('the unmeasured section comes before any figure, and the headline points to it', () => {
  const text = renderBriefing(ask());
  assert.ok(text.indexOf('## Not measured') < text.indexOf('## Measured'));
  assert.ok(text.indexOf('## Measured') < text.indexOf('## Decisions'));
  assert.match(ask().headline, /2 untracked timers and 1 phantom crons/);
});

test('it gives no overall verdict and never calls the platform healthy', () => {
  assert.doesNotMatch(renderBriefing(ask()), /\bhealthy\b/i);
  assert.equal('verdict' in ask(), false);
});

test('records add what they cannot see to the unmeasured section', () => {
  const b = ask();
  assert.deepEqual(item(b, 'Agents with no score')?.names, ['Idle']);
  assert.deepEqual(item(b, 'Timers with no agent row')?.names, ['Rowless']);
  assert.deepEqual(item(b, 'Jobs the health check cannot evaluate')?.names, ['Unseen']);
  assert.equal(item(ask({ records: null }), 'Agents with no score'), undefined);
});

test('the measured figures come from the records', () => {
  const b = ask();
  assert.equal(fig(b, 'Runs on record').value, 40);
  assert.equal(fig(b, 'Runs on record').percent, null);
  assert.equal(fig(b, 'Agents scored').of, 4);
  assert.equal(fig(b, 'Jobs alerting now').of, 5);
  assert.equal(fig(b, 'Jobs alerting now').value, 1);
  assert.equal(fig(b, 'Jobs fully evaluated').value, 3);
});

test('drift unknown is listed as unmeasured; reported drift is a measured figure', () => {
  assert.ok(item(ask(), 'Schema drift'));
  assert.equal(ask().measured.some((f) => /missing from development/.test(f.label)), false);
  const b = ask({ drift: drift({ verdict: 'drift_reported', drift: { tables: ['a'], enums: [], columns: ['b', 'c'], warnings: [] } }) });
  assert.equal(item(b, 'Schema drift'), undefined);
  assert.equal(fig(b, 'Objects on production missing from development').value, 3);
});

test('the schema axes and the recovery position are always stated', () => {
  const b = ask();
  assert.deepEqual(item(b, 'Schema comparisons nobody makes')?.names, ['column_shape']);
  assert.equal(item(b, 'Recovery position')?.why, backup.statement);
  assert.ok(item(b, 'Alert outcomes'));
  assert.equal(item(b, 'Timers with no name')?.count, 1);
  assert.match(renderBriefing(b), /Alert outcomes: unknown/);
  assert.ok(item(b, 'Retry counts and latency percentiles'));
});

test('the scope is a proposal, it is not sent, and it needs no login', () => {
  const b = ask();
  assert.equal(b.scope, SCOPE);
  assert.match(b.scope, /not an inherited job description/);
  assert.equal(b.delivery, DELIVERY);
  assert.match(b.delivery, /Not sent/);
  const text = renderBriefing(b);
  assert.doesNotMatch(text, /https?:|\/admin\/|\/api\/admin/);
  assert.ok(text.includes(SCOPE) && text.includes(DELIVERY));
});

test('decisions are named with who owns them and what evidence they need', () => {
  assert.deepEqual(ask().decisions, [...OPEN_DECISIONS]);
  assert.ok(OPEN_DECISIONS.length > 0);
  const text = renderBriefing(ask());
  for (const d of OPEN_DECISIONS) assert.ok(text.includes(d.question) && text.includes(d.evidence_needed));
});

test('the limits and the commit travel with every briefing, and the same input gives the same output', () => {
  assert.deepEqual(ask({ records: null }).limits, [...LIMITS]);
  assert.equal(ask().source_commit, 'abc1234');
  assert.match(renderBriefing(ask()), /Source commit abc1234/);
  assert.match(renderBriefing(ask({ recon: { ...recon(), source_commit: null } })), /Source commit not read/);
  assert.deepEqual(ask(), ask());
});

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'briefing-'));
  for (const [p, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}
const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli/reliabilityReport.ts', ...args], { encoding: 'utf8' });

test('the CLI runs on a checkout with no records, and the real capabilities feed it', () => {
  const r = cli('--source', checkout(), '--produced-at', '2026-11-01T12:00:00Z');
  assert.equal(r.status, 4);
  assert.match(r.stdout, /^# Reliability briefing/);
  assert.match(r.stdout, /Untracked timers: \d+/);
  assert.match(r.stdout, /Runs on record: unknown/);
  const j = cli('--source', checkout(), '--json');
  assert.equal(JSON.parse(j.stdout).records_captured_at, null);
});

test('the CLI reads the example records', () => {
  const r = cli('--source', checkout(), '--snapshot', 'examples/cron-health.example.json');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Agents scored: /);
});

test('the CLI carries real failure counts into the figure, with its record count', () => {
  const dir = checkout();
  const row = { id: 'r1', agent_name: 'Worker', enabled: true, status: 'idle', trigger_type: 'cron', schedule: '0 1 * * *', run_count: 8, error_count: 2, avg_duration_ms: null, last_run_at: null, last_error: null, last_error_at: null };
  const p = join(dir, 'records.json');
  writeFileSync(p, JSON.stringify({ captured_at: '2026-11-01T10:00:00Z', captured_by: 'test', ai_agents: [row], ai_agent_activity_logs: [], timers: [], timer_scope: [] }));
  assert.match(cli('--source', dir, '--snapshot', p).stdout, /Failed runs on record: 25% \(2 of 8 runs\)/);
});

test('the CLI reads a drift log', () => {
  const r = cli('--source', checkout(), '--drift-log', 'examples/schema-drift.example.log', '--produced-at', '2026-11-01T12:00:00Z', '--json');
  assert.ok(JSON.parse(r.stdout).measured.some((f: { label: string; value: number }) => /missing from development/.test(f.label) && f.value === 2));
});

test('the CLI refuses bad input', () => {
  const dir = checkout();
  const bad = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, body); return p; };
  assert.equal(cli().status, 1);
  const when = cli('--source', dir, '--produced-at', 'soon');
  assert.equal(when.status, 1);
  assert.match(when.stderr, /--produced-at needs a date/);
  assert.equal(cli('--source', dir, '--snapshot', join(dir, 'nowhere.json')).status, 1);
  assert.equal(cli('--source', dir, '--snapshot', bad('a.json', 'not json')).status, 1);
  const date = cli('--source', dir, '--snapshot', bad('b.json', '{"captured_at":"soon","ai_agents":[],"ai_agent_activity_logs":[],"timers":[],"timer_scope":[]}'));
  assert.equal(date.status, 1);
  assert.match(date.stderr, /needs captured_at/);
  const lists = cli('--source', dir, '--snapshot', bad('c.json', '{"captured_at":"2026-11-01T00:00:00Z"}'));
  assert.equal(lists.status, 1);
  assert.match(lists.stderr, /needs ai_agents\[\]/);
  assert.equal(cli('--source', dir, '--snapshot', bad('d.json', '{"captured_at":"2026-11-01T00:00:00Z","ai_agents":[{"run_count":"many"}],"ai_agent_activity_logs":[],"timers":[],"timer_scope":[]}')).status, 1);
  assert.equal(cli('--source', dir, '--drift-log', join(dir, 'nowhere.log')).status, 1);
});
