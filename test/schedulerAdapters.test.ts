import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LivenessAnswer } from '../src/capabilities/schedulerLiveness.ts';
import type { GuardAnswer } from '../src/capabilities/defaultOnTimerGuard.ts';
import type { GovernanceAnswer, Proposal } from '../src/capabilities/scheduleGovernance.ts';
import { measure, reconcileAnswer } from '../src/capabilities/registryReconciliation.ts';
import { askRegistry, type RegistrySnapshot } from '../src/capabilities/registryReadSurface.ts';
import type { SeverityTable, ToolOutput } from '../src/output/toolOutput.ts';
import { livenessOutput, defaultOnOutput, governanceOutput, reconOutput, registryAskOutput } from '../src/output/schedulerAdapters.ts';
import { FILES } from './fixtures/registryCheckout.ts';

// Inputs are the repository's examples and fixtures, or answers written in the checks' own shapes: not production data.
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const CAP = { captured_at: '2026-11-04T12:00:00Z', captured_by: 'test' };

function holds<D>(o: ToolOutput<D>, detail: D) {
  if (o.verdict === 'problem' || o.verdict === 'ok') assert.ok(o.evidence.length > 0, `${o.tool}: ${o.verdict} with no evidence`);
  if (o.verdict === 'partly_unknown' || o.verdict === 'unknown') assert.ok(o.blind_spots.length > 0, `${o.tool}: ${o.verdict} names no blind spot`);
  for (const e of o.evidence) assert.ok(e.table && e.id, JSON.stringify(e));
  assert.equal(o.severity, 'unassigned');
  assert.equal(o.detail, detail);
}

const liveness = (detects: boolean | null, scheduled: number | null, probeAt = true): LivenessAnswer => ({
  source_commit: 'abc123',
  gate: { call_sites: [{ file: 'server.ts', line: 3632, guarded_by: 'env.enableFollowUpScheduler', env_var: 'ENABLE_FOLLOW_UP_SCHEDULER' }], flags: [], single_flag: true },
  ai_ops_start: { definitions: [], callers: [], only_caller: 'startScheduler' },
  public_probe: { route: 'GET /health', at: probeAt ? { file: 'routes/health.ts', line: 10 } : null, consults_scheduler: detects, detects_zero_timers: detects },
  full_probe: { route: 'GET /health/full', at: null, consults_scheduler: null, heartbeat: null },
  registered: { from: scheduled === null ? null : 'boot_log', scheduled, disabled: 0, boots_in_log: scheduled === null ? 0 : 1, counts_outside_registries: [] },
  registry_entries: 40, blind_spots: ['a registered timer is not a fired one'], statement: 's', decision: 'd',
});

test('liveness: a probe that cannot see zero timers is a problem citing the probe and the gate; zero registered outranks it', () => {
  const a = liveness(false, null);
  const o = livenessOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.severity_rule, "K.D.'s severity table has no rules yet (not agreed yet, ISS-032)");
  assert.deepEqual(o.evidence.map((e) => e.id), ['routes/health.ts:10', 'server.ts:3632']);
  assert.equal(o.as_of.note, 'platform commit abc123');
  const zero = livenessOutput(liveness(true, 0), CAP, { ...EMPTY, rules: [{ tool: 'platform.CAP.scheduler_registration_liveness_probe', case: 'no_timer_registered', severity: 'Critical', why: 'nothing runs' }] });
  assert.equal(zero.severity, 'Critical');
});

test('liveness: a probe that does see the scheduler is ok; one not found is unknown, never ok', () => {
  assert.equal(livenessOutput(liveness(true, 40), CAP, EMPTY).verdict, 'ok');
  const missing = liveness(null, null, false);
  const o = livenessOutput(missing, CAP, EMPTY);
  holds(o, missing);
  assert.equal(o.verdict, 'unknown');
});

const guard = (ungoverned: string[], sites = 3, from: 'seed' | 'records' = 'seed'): GuardAnswer => ({
  source_commit: 'abc123', rows_from: from, rows_captured_at: from === 'records' ? '2026-11-01T00:00:00Z' : null,
  registry: { entries: 10, names: 10 },
  ungoverned: ungoverned.map((name, i) => ({ name, registries: ['SCHEDULE_REGISTRY'], at: [`aiOpsScheduler.ts:${100 + i}`], hardcoded_schedules: ['0 * * * *'], enabled_by_default: true })),
  governed: { names: 10 - ungoverned.length, disabled: [] }, rows_without_registry_entry: [],
  default_sites: Array.from({ length: sites }, (_, i) => ({ file: 'aiOpsScheduler.ts', line: 700 + i, path: 'boot' as const, covers: 'SCHEDULE_REGISTRY' as const })),
  sites_as_expected: sites === 3, model_default: null,
  read_failure: { resolver: { file: 'r.ts', line: 1, fails_open: true, why: 'w' }, boot: { file: 'b.ts', line: 1, fails_open: true, why: 'w' }, reload: { file: 'l.ts', line: 1, fails_open: true, why: 'w' } },
  blind_spots: ['read failure is read from source, not exercised.'], statement: 's', decision: 'd',
});

test('default-on timers: names with no governing row are a problem citing their registry entries and the default sites', () => {
  const a = guard(['Loose']);
  const o = defaultOnOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.deepEqual(o.evidence.map((e) => e.id), ['aiOpsScheduler.ts:100', 'aiOpsScheduler.ts:700', 'aiOpsScheduler.ts:701', 'aiOpsScheduler.ts:702']);
});

test('default-on timers: every name governed is ok; no default site found is unknown; exported rows date the answer', () => {
  assert.equal(defaultOnOutput(guard([]), CAP, EMPTY).verdict, 'ok');
  const none = guard([], 0);
  const o = defaultOnOutput(none, CAP, EMPTY);
  holds(o, none);
  assert.equal(o.verdict, 'unknown');
  assert.equal(defaultOnOutput(guard([], 3, 'records'), CAP, EMPTY).as_of.captured_at, '2026-11-01T00:00:00Z');
});

const proposal = (target: string, origin: Proposal['origin'], runs: string[], calls: string[] = []): Proposal => ({
  target, change: { enabled: false }, origin, why: 'w', home: 'standard_registry' as Proposal['home'], where: [], governance_keys: [target], current: [], remedy: 'r', decision: 'd',
  evidence: { window_days: 7, runs: runs.length, failed: runs.length, runs_per_day: null, mean_duration_ms: null, ai_cost: { total_usd: null, per_run_usd: null, costed_calls: 0, uncosted_calls: 0 }, signal: null, fires_per_day: { current: null, proposed: null }, projected_ai_cost_per_day_usd: null, row_ids: [...runs, ...calls], blind_spots: ['cost is a lower bound'] },
});
const gov = (ps: Proposal[]): GovernanceAnswer => ({ captured_at: CAP.captured_at, source_commit: 'abc123', proposals: ps, statement: ps.length ? 'p' : 'Nothing to propose' });

test('schedule governance: a job failing every run is a problem citing its run rows and their AI calls in their own tables', () => {
  const a = gov([proposal('Asked', 'asked', ['x1']), proposal('Broken', 'sweep', ['r1', 'r2', 'r3'], ['e1'])]);
  const o = governanceOutput(a, CAP, EMPTY);
  holds(o, a);
  assert.equal(o.verdict, 'problem');
  assert.equal(o.tool, 'platform.CAP.schedule_governance_live_reload');
  assert.deepEqual(o.evidence.map((e) => [e.table, e.id]), [['ai_agent_activity_logs', 'r1'], ['ai_agent_activity_logs', 'r2'], ['ai_agent_activity_logs', 'r3'], ['ai_events', 'e1']]);
  assert.ok(o.blind_spots.includes('Broken: cost is a lower bound'));
});

test('schedule governance: asked proposals with rows are ok; nothing to propose cites nothing, so it is unknown', () => {
  assert.equal(governanceOutput(gov([proposal('Asked', 'asked', ['x1'])]), CAP, EMPTY).verdict, 'ok');
  const empty = gov([]);
  const o = governanceOutput(empty, CAP, EMPTY);
  holds(o, empty);
  assert.equal(o.verdict, 'unknown');
});

const memReader = (files: Record<string, string>) => ({
  read(p: string) { if (!(p in files)) throw new Error(`${p} not in fixture`); return files[p]; },
  list(dir: string) { return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const NOW = new Date('2026-10-27T23:00:00Z');

test('reconciliation: new drift against the baseline is a problem naming each new entry; a match is ok; no baseline is partly unknown', () => {
  const m = measure(memReader(FILES), NOW, 'abc123def');
  const a = reconcileAnswer(m);
  const o = reconOutput(a, EMPTY);
  holds(o, a);
  assert.equal(o.as_of.note, 'platform commit abc123def');
  if (a.verdict === 'no_baseline') assert.equal(o.verdict, 'partly_unknown');
  // Accept every measured entry, then drop one: that one is new drift.
  const all = Object.fromEntries(Object.entries(a.classes).map(([k, c]) => [k, c.entries]));
  const matched = reconcileAnswer({ ...m, baseline: all as typeof m.baseline });
  assert.equal(reconOutput(matched, EMPTY).verdict, 'ok');
  const dropped = a.classes.scheduledNamesWithNoSeedRow.entries[0];
  const drift = reconcileAnswer({ ...m, baseline: { ...all, scheduledNamesWithNoSeedRow: all.scheduledNamesWithNoSeedRow.slice(1) } as typeof m.baseline });
  const d = reconOutput(drift, EMPTY);
  holds(d, drift);
  assert.equal(d.verdict, 'problem');
  assert.deepEqual(d.evidence.map((e) => e.id), [`abc123def#scheduledNamesWithNoSeedRow/${dropped}`]);
});

test('registry ask: a registered name is ok citing its row; a name that fires with no row is a problem; an absent name is unknown', () => {
  const s: RegistrySnapshot = JSON.parse(readFileSync('examples/registry-ask.example.json', 'utf8'));
  const name = s.ai_agents[0].agent_name;
  const reg = askRegistry(s, name);
  const o = registryAskOutput(reg, s, EMPTY);
  holds(o, reg);
  assert.equal(o.verdict, 'ok');
  assert.ok(o.evidence.some((e) => e.table === 'ai_agents'));
  const absent = askRegistry(s, 'NoSuchName');
  const u = registryAskOutput(absent, s, EMPTY);
  holds(u, absent);
  assert.equal(u.verdict, 'unknown');
  const t = { timer: 'Loose', schedule: '0 * * * *', label: 'Loose', ref: 'x.ts:1', gates: [{ gate: 'instrument_cron_job' as const, flag: 'Loose' }] };
  const fires = askRegistry({ ...s, timers: [...s.timers, t] }, 'Loose');
  const f = registryAskOutput(fires, s, EMPTY);
  holds(f, fires);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((e) => [e.table, e.id]), [['timer_inventory', 'Loose']]);
  const elsewhere = askRegistry({ ...s, timers: [...s.timers, { ...t, gates: [{ ...t.gates[0], flag: name }] }] }, 'Loose');
  assert.equal(registryAskOutput(elsewhere, s, EMPTY).verdict, 'unknown', 'a timer that records under another row is not untracked');
  const dup = askRegistry({ ...s, ai_agents: [s.ai_agents[0], { ...s.ai_agents[0], id: 'other' }] }, name);
  const p = registryAskOutput(dup, s, EMPTY);
  holds(p, dup);
  assert.equal(p.verdict, 'problem');
  assert.equal(p.as_of.note, null);
});
