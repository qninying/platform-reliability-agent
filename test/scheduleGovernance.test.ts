import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { propose, firesPerDay, type GovernanceSnapshot, type Ask } from '../src/capabilities/scheduleGovernance.ts';
import { timerIndex, homeOf, type TimerIndex } from '../src/inventory/timerHomes.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at c96f6a6. Names are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `
const UNINSTRUMENTED_AGENTS = new Set(['Plain']);
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'Adm', hardcodedSchedule: '4,14,24,34,44,54 * * * *', runner: runAdm, label: 'Admissions' },
  { agentName: 'Plain', hardcodedSchedule: '0 * * * *', runner: runPlain, label: 'Plain' },
  { agentName: 'Both', hardcodedSchedule: '0 1 * * *', runner: runBoth, label: 'Both' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  { agentName: 'Brief', hardcodedSchedule: '45 6 * * *', dynamicImport: async () => { await brief(); }, label: 'Briefing' },
];
function startDynamicTask(entry, schedule) {
  const task = cron.schedule(schedule, () => { instrumentCronJob(entry.agentName, entry.dynamicImport); });
}
`,
  [`${S}/aiOrchestrator.ts`]: `
export async function runAdm(): Promise<void> {
  return runAgent('AdmAgent', async () => { await go(); });
}
`,
  [`${S}/schedulerService.ts`]: `
const SYNC_NAME = 'ConstSync';
export function startScheduler() {
  cron.schedule('*/30 * * * *', () => {
    instrumentCronJob('Inline1', async () => { await one(); });
  });
  cron.schedule(
    '0 2 * * *',
    () => { instrumentCronJob(SYNC_NAME, async () => { await two(); }); },
  );
  cron.schedule('0 1 * * *', () => { instrumentCronJob('Both', async () => { await both(); }); });
  cron.schedule('45 3 * * *', () => {
    for (const src of list()) {
      instrumentCronJob(\`Intel_\${src.slug}\`, async () => { await run(src); });
    }
  });
  cron.schedule('0 5 * * *', () => { instrumentCronJob(pickName(), async () => { await x(); }); });
  // instrumentCronJob('Commented', ...) is not a timer
}
`,
  [`${S}/intel/sources/index.ts`]: `import './alpha';\n`,
  [`${S}/intel/sources/alpha.ts`]: `const SLUG = 'alpha';\nregisterIntelSource({ slug: SLUG });\n`,
  [`${S}/other.ts`]: `export async function tick() { await trackAgentRun('Named', async () => {}); }\n`,
};
const reader = (files: Record<string, string>): Reader => ({
  read: (rel) => { if (!(rel in files)) throw new Error(`missing ${rel}`); return files[rel]; },
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir)).sort(),
});
const index = (): TimerIndex => timerIndex(reader(FILES), 'abc123def');

const NOW = '2026-10-30T12:00:00Z';
const snap = (): GovernanceSnapshot => ({
  captured_at: NOW,
  captured_by: 'test',
  ai_agents: [
    { id: 'a-brief', agent_name: 'Brief', enabled: true },
    { id: 'a-in', agent_name: 'Inline1', enabled: true },
    { id: 'a-plain', agent_name: 'Plain', enabled: true },
  ],
  ai_agent_activity_logs: [
    { id: 'r1', agent_id: 'a-brief', action: 'Brief', result: 'success', trace_id: 't1', duration_ms: 1000, created_at: '2026-10-28T11:45:00Z' },
    { id: 'r2', agent_id: 'a-brief', action: 'Brief', result: 'success', trace_id: 't2', duration_ms: 3000, created_at: '2026-10-29T11:45:00Z' },
    { id: 'r-old', agent_id: 'a-brief', action: 'Brief', result: 'success', trace_id: 't0', duration_ms: 9000, created_at: '2026-10-01T11:45:00Z' },
    { id: 'own', agent_id: 'a-brief', action: 'brief_sent', result: 'success', trace_id: 't1', duration_ms: null, created_at: '2026-10-28T11:45:01Z' },
    ...[0, 1, 2].map((i) => ({ id: `f${i}`, agent_id: 'a-in', action: 'Inline1', result: 'failed', trace_id: `tf${i}`, duration_ms: 50, created_at: `2026-10-30T0${i}:00:00Z` })),
  ],
  ai_events: [
    { id: 'e1', trace_id: 't1', cost_usd: 0.02, created_at: '2026-10-28T11:45:02Z' },
    { id: 'e2', trace_id: 't2', cost_usd: null, created_at: '2026-10-29T11:45:02Z' },
    { id: 'e-old', trace_id: 't0', cost_usd: 5, created_at: '2026-10-01T11:45:02Z' },
  ],
  cron_schedule_configs: [{ agent_name: 'Brief', active_schedule: '45 6 * * *', default_schedule: '45 6 * * *', enabled: true }],
});

test('acceptance: every proposal says whether the target is in the reloadable aiOps registry or inline in schedulerService.ts, and an unknown home is labelled unknown', () => {
  const asks: Ask[] = ['Brief', 'Adm', 'AdmAgent', 'Plain', 'Inline1', 'ConstSync', 'Intel_alpha', 'Both', 'Named', 'Nope'].map((t) => ({ target: t, change: { schedule: '0 * * * *' } }));
  const a = propose(index(), snap(), asks);
  const home = Object.fromEntries(a.proposals.filter((p) => p.origin === 'asked').map((p) => [p.target, p.home]));
  assert.deepEqual(home, {
    Brief: 'aiops_registry', Adm: 'aiops_registry', AdmAgent: 'aiops_registry', Plain: 'aiops_registry',
    Inline1: 'inline', ConstSync: 'inline', Intel_alpha: 'inline', Both: 'registry_and_inline', Named: 'unknown', Nope: 'unknown',
  });
  for (const p of a.proposals) {
    if (p.home === 'aiops_registry') assert.match(p.remedy, /^Reloadable:/, p.target);
    if (p.home === 'inline') { assert.match(p.remedy, /^Restart only: registered inline at backend\/src\/services\/schedulerService\.ts:\d+/, p.target); assert.deepEqual(p.governance_keys, []); }
    if (p.home === 'registry_and_inline') assert.match(p.remedy, /^Partly reloadable\..*the inline timer keeps firing/, p.target);
    if (p.home === 'unknown') {
      assert.match(p.remedy, /^Unknown home: no remedy is proposed/, p.target);
      assert.match(p.evidence.blind_spots[0], /^home unknown: /, p.target);
      assert.deepEqual(p.where, []);
    }
    assert.match(p.decision, /A person decides and applies this/);
  }
  assert.equal(a.statement.includes('2 with an unknown home'), true);
});

test('the governance key is named when it differs from the row a person knows the job by', () => {
  const p = propose(index(), snap(), [{ target: 'AdmAgent', change: { schedule: '*/30 * * * *' } }]).proposals[0];
  assert.deepEqual(p.governance_keys, ['Adm']);
  assert.match(p.remedy, /PATCH \/api\/admin\/governance-center\/schedules\/Adm\b/);
  assert.deepEqual(p.where, ['backend/src/services/aiOpsScheduler.ts:4 (SCHEDULE_REGISTRY)']);
  assert.deepEqual(p.current, [{ key: 'Adm', schedule: '4,14,24,34,44,54 * * * *', enabled: true, from: 'hardcoded' }]);
  assert.deepEqual(p.evidence.fires_per_day, { current: 144, proposed: 48 });
  // Asked by its governance key, the evidence is still read under the row its runs record under.
  const s = snap();
  s.ai_agents.push({ id: 'a-adm', agent_name: 'AdmAgent', enabled: true });
  const byKey = propose(index(), s, [{ target: 'Adm', change: { schedule: '*/30 * * * *' } }]).proposals[0].evidence;
  assert.equal(byKey.runs, 0, 'the AdmAgent row is found, so runs are counted, not unknown');
  assert.ok(byKey.blind_spots.some((b) => /no run of Adm or AdmAgent recorded in the window/.test(b)));
});

test('a registry timer with no governance row is flagged: the PATCH returns 404 and the timer is on by default', () => {
  const ix = index();
  const noRow = propose(ix, snap(), [{ target: 'Plain', change: { schedule: '0 */2 * * *' } }]).proposals[0];
  assert.match(noRow.remedy, /No governance row exists for Plain, so the PATCH returns 404/);
  const withRow = propose(ix, snap(), [{ target: 'Brief', change: { schedule: '45 7 * * *' } }]).proposals[0];
  assert.doesNotMatch(withRow.remedy, /404/);
  assert.equal(withRow.current[0].from, 'governance row');
  const s = snap();
  s.cron_schedule_configs[0] = { ...s.cron_schedule_configs[0], active_schedule: '0 9 * * *', enabled: false };
  assert.deepEqual(propose(ix, s, [{ target: 'Brief', change: { schedule: '45 7 * * *' } }]).proposals[0].current, [{ key: 'Brief', schedule: '0 9 * * *', enabled: false, from: 'governance row' }]);
});

test('an inline disable names the ai_agents row as the stop before a deploy only when that row exists', () => {
  const ix = index();
  assert.match(propose(ix, snap(), [{ target: 'Inline1', change: { enabled: false } }]).proposals[0].remedy, /disabling its ai_agents row skips its runs/);
  const none = propose(ix, snap(), [{ target: 'ConstSync', change: { enabled: false } }]).proposals[0];
  assert.match(none.remedy, /no ai_agents row, so there is no row to disable either/);
  assert.equal(none.evidence.fires_per_day.proposed, 0);
});

test('evidence: runs, cost and signal come from the window only, an uncosted call is not counted as zero, and every figure cites its rows', () => {
  const e = propose(index(), snap(), [{ target: 'Brief', change: { schedule: '45 6 * * 1-5' } }]).proposals[0].evidence;
  assert.equal(e.runs, 2);
  assert.equal(e.failed, 0);
  assert.equal(e.mean_duration_ms, 2000);
  assert.deepEqual(e.ai_cost, { total_usd: 0.02, per_run_usd: 0.01, costed_calls: 1, uncosted_calls: 1 });
  assert.deepEqual(e.signal, { runs: 2, rate: 1, lower_bound: true });
  assert.deepEqual(e.row_ids, ['r1', 'r2', 'e1', 'e2']);
  assert.ok(e.blind_spots.some((b) => /1 AI call\(s\) recorded no cost/.test(b)));
  assert.equal(e.fires_per_day.current, 1);
  assert.equal(e.fires_per_day.proposed, 0.71);
  assert.equal(e.projected_ai_cost_per_day_usd, 0.0071);
  const s = snap();
  s.ai_agent_activity_logs = s.ai_agent_activity_logs.filter((r) => r.id !== 'own');
  s.ai_events = [];
  assert.deepEqual(propose(index(), s, [{ target: 'Brief', change: { schedule: '0 7 * * *' } }]).proposals[0].evidence.signal, { runs: 0, rate: 0, lower_bound: true });
  const untracked = propose(index(), snap(), [{ target: 'ConstSync', change: { schedule: '0 3 * * *' } }]).proposals[0].evidence;
  assert.equal(untracked.runs, null);
  assert.ok(untracked.blind_spots.some((b) => /no ai_agents row named ConstSync/.test(b)));
  const unknown = propose(index(), snap(), [{ target: 'Nope', change: { schedule: '0 3 * * *' } }]).proposals[0].evidence;
  assert.equal(unknown.fires_per_day.current, null, 'no timer, so no current cadence: not zero');
});

test('the sweep proposes pausing a job only when every run in the window failed, at least three of them', () => {
  const a = propose(index(), snap(), []);
  assert.deepEqual(a.proposals.map((p) => [p.target, p.origin, p.change, p.home]), [['Inline1', 'sweep', { enabled: false }, 'inline']]);
  assert.match(a.proposals[0].why, /every one of its 3 runs in the last 7 days failed/);
  const two = snap();
  two.ai_agent_activity_logs = two.ai_agent_activity_logs.filter((r) => r.id !== 'f2');
  assert.equal(propose(index(), two, []).proposals.length, 0);
  assert.match(propose(index(), two, []).statement, /^Nothing to propose/);
  const mixed = snap();
  mixed.ai_agent_activity_logs.push({ id: 'ok', agent_id: 'a-in', action: 'Inline1', result: 'success', trace_id: 'tok', duration_ms: 40, created_at: '2026-10-30T05:00:00Z' });
  assert.equal(propose(index(), mixed, []).proposals.length, 0);
  const off = snap();
  off.ai_agents[1].enabled = false;
  assert.equal(propose(index(), off, []).proposals.length, 0);
  assert.equal(propose(index(), snap(), [{ target: 'Inline1', change: { schedule: '0 * * * *' } }]).proposals.length, 1, 'an asked target is not proposed twice');
});

test('an unknown home says why: a name used outside any timer, or timers whose names are built at run time', () => {
  const ix = index();
  assert.equal(ix.unlisted.length, 1);
  const named = homeOf(ix, 'Named');
  assert.match(named.unknown_because!, /Named is named at backend\/src\/services\/other\.ts:1 \(trackAgentRun\), but Ellis could not tie that call to a timer/);
  assert.match(named.unknown_because!, /1 timer\(s\) build their name at run time and could be it \(backend\/src\/services\/schedulerService\.ts:\d+\)/);
  assert.equal(homeOf(ix, 'Commented').home, 'unknown', 'a name in a comment is not a timer');
  assert.equal(homeOf(ix, 'Brief').registry[0].registry, 'DYNAMIC_SCHEDULE_REGISTRY');
});

test('the same inputs give the same answer twice, and reading them changes nothing', () => {
  const s = snap();
  const before = JSON.stringify(s);
  const asks: Ask[] = [{ target: 'Brief', change: { schedule: '0 7 * * *' } }];
  assert.deepEqual(propose(index(), s, asks), propose(index(), s, asks));
  assert.deepEqual(propose(index(), { ...s, ai_agent_activity_logs: [...s.ai_agent_activity_logs].reverse() }, asks), propose(index(), s, asks));
  assert.equal(JSON.stringify(s), before);
  assert.equal(firesPerDay('not cron', new Date(NOW)), null);
});

test('CLI: exit 0 known homes, 3 an unknown home, 4 nothing to propose, 1 for bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ellis-sched-'));
  for (const [rel, text] of Object.entries(FILES)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  const file = join(dir, 'snap.json');
  writeFileSync(file, JSON.stringify(snap()));
  const run = (args: string[]) => spawnSync(process.execPath, ['src/cli/scheduleGovernance.ts', '--source', dir, ...args], { encoding: 'utf8' });
  const ok = run(['--snapshot', file, '--propose', 'Brief=0 7 * * *']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).proposals[0].home, 'aiops_registry');
  assert.equal(run(['--snapshot', file, '--disable', 'Nope']).status, 3);
  const quiet = snap();
  quiet.ai_agent_activity_logs = [];
  writeFileSync(file, JSON.stringify(quiet));
  assert.equal(run(['--snapshot', file]).status, 4);
  assert.equal(run(['--snapshot', file, '--propose', 'Brief=every day']).status, 1);
  const bad = JSON.parse(readFileSync(file, 'utf8'));
  delete bad.cron_schedule_configs;
  writeFileSync(file, JSON.stringify(bad));
  const missing = run(['--snapshot', file]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /a missing table is not an empty one/);
  const notCheckout = spawnSync(process.execPath, ['src/cli/scheduleGovernance.ts', '--source', tmpdir(), '--snapshot', file], { encoding: 'utf8' });
  assert.equal(notCheckout.status, 1);
});
