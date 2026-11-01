import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { overlapGuard, LIMITS, type OverlapSnapshot, type AgentRow, type RunRow, type TimerAnswer } from '../src/capabilities/cronOverlapGuard.ts';
import { claimsIn, libraryGuard, guardInStarter, guardAtLine } from '../src/inventory/claimSites.ts';
import { timerIndex } from '../src/inventory/timerHomes.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `import { runSlow, runDeep } from './jobs';
const UNINSTRUMENTED_AGENTS = new Set(['Slow', 'Quick', 'Deep']);
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'Slow', hardcodedSchedule: '*/1 * * * *', runner: runSlow, label: 'slow' },
  { agentName: 'Quick', hardcodedSchedule: '*/5 * * * *', runner: runQuick, label: 'quick' },
  { agentName: 'Deep', hardcodedSchedule: '0 9 * * *', runner: runDeep, label: 'deep' },
  { agentName: 'Director', hardcodedSchedule: '0 8 * * *', runner: async () => { directorActions(); }, label: 'director' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  {
    agentName: 'Publisher',
    hardcodedSchedule: '* * * * *',
    dynamicImport: async () => {
      const { runDue } = await import('./publishing/worker');
      await runDue();
    },
    label: 'publisher',
  },
];
function startStandardTask(entry, schedule) { const task = cron.schedule(schedule, () => { wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()).catch(() => {}); }, { timezone: 'America/Chicago' }); }
function startDynamicTask(entry, schedule) { const task = cron.schedule(schedule, () => { instrumentCronJob(entry.agentName, entry.dynamicImport).catch(() => {}); }, { timezone: 'America/Chicago' }); }
`,
  [`${S}/aiOrchestrator.ts`]: `export const x = 1;\n`,
  [`${S}/jobs.ts`]: `export async function runSlow() { await go(); }
export async function runDeep() { await helper(); }
async function helper() { await Row.update({ state: 'claimed' }, { where: { id, state: previous } }); }
`,
  [`${S}/publishing/worker.ts`]: `export async function runDue() {
  // Row.update({ state: 'claimed' }, { where: { state: old } }) in a comment is not a claim
  const [n] = await Row.update({ state: 'claimed', claimed_by: me }, { where: { id, state: previous } });
}
`,
  [`${S}/schedulerService.ts`]: `export function startScheduler() {
  cron.schedule('*/30 * * * *', () => {
    instrumentCronJob('Inline1', one).catch(() => {});
  });
  cron.schedule('0 3 1 * *', () => {
    instrumentCronJob('Monthly', one).catch(() => {});
  });
  cron.schedule('*/10 * * * *', async () => { await plain(); });
  cron.schedule(SOME_SCHEDULE, () => { plain(); });
}
`,
};
const reader = (files = FILES): Reader => ({
  read: (rel) => { if (!(rel in files)) throw new Error(`no ${rel}`); return files[rel]; },
  list: () => Object.keys(files).sort(),
});
const AT = '2026-10-31T12:00:00.000Z';
const agent = (name: string, avg: number | null = null, enabled = true): AgentRow => ({ id: `a-${name}`, agent_name: name, enabled, avg_duration_ms: avg });
const run = (id: string, name: string, ms: number | null, at = '2026-10-31T10:00:00.000Z', action = name): RunRow => ({ id, agent_id: `a-${name}`, action, result: 'success', duration_ms: ms, created_at: at });
const snap = (o: Partial<OverlapSnapshot> = {}): OverlapSnapshot => ({ captured_at: AT, captured_by: 'test', ai_agents: [], ai_agent_activity_logs: [], cron_schedule_configs: [], ...o });
const ask = (s: OverlapSnapshot, files = FILES, window_days = 30) => overlapGuard(reader(files), timerIndex(reader(files), 'abc'), s, { window_days });
const find = (a: ReturnType<typeof ask>, timer: string): TimerAnswer => {
  const t = [...a.can_overlap, ...a.unassessable, ...a.not_seen_to_overlap].find((x) => x.timer === timer);
  assert.ok(t, `${timer} is listed`);
  return t;
};

test('a timer whose worst run exceeds its interval is named with both figures', () => {
  const a = ask(snap({ ai_agents: [agent('Slow', 30000)], ai_agent_activity_logs: [run('r1', 'Slow', 90000), run('r2', 'Slow', 1000, '2026-10-30T10:00:00.000Z')] }));
  const t = a.can_overlap.find((x) => x.timer === 'Slow');
  assert.ok(t);
  assert.equal(t.interval_ms, 60000);
  assert.deepEqual(t.duration, { average_ms: 30000, worst_ms: 90000, worst_row_id: 'r1', runs_in_window: 2 });
  assert.equal(t.basis, 'worst_run');
  assert.equal(a.verdict, 'can_overlap');
  assert.deepEqual(t.where, [`${S}/aiOpsScheduler.ts:4`]);
});

test('a timer with no row or no duration is unassessable, never safe', () => {
  const a = ask(snap({ ai_agents: [agent('Quick')] }));
  assert.equal(find(a, 'Slow').unassessable_because, 'no_agents_row');
  assert.equal(find(a, 'Quick').unassessable_because, 'no_duration_recorded');
  assert.equal(find(a, 'Quick').verdict, 'unassessable');
  assert.equal(find(a, 'Quick').duration.worst_ms, null);
  assert.equal(find(a, 'Quick').interval_ms, 300000);
  assert.equal(find(a, 'Director').unassessable_because, 'no_row_named');
  assert.equal(a.not_seen_to_overlap.length, 0);
});

test('an empty record is never all clear', () => {
  const a = ask(snap());
  assert.equal(a.verdict, 'none_assessable_overlap');
  assert.equal(a.counts.unassessable, a.counts.timers);
});

test('an average under the interval clears nothing, and one over it still flags', () => {
  const under = ask(snap({ ai_agents: [agent('Slow', 500)] }));
  assert.equal(find(under, 'Slow').unassessable_because, 'average_only');
  assert.equal(find(under, 'Slow').duration.average_ms, 500);
  const over = ask(snap({ ai_agents: [agent('Slow', 70000)] }));
  assert.equal(find(over, 'Slow').verdict, 'can_overlap');
  assert.equal(find(over, 'Slow').basis, 'average');
  const worstFine = ask(snap({ ai_agents: [agent('Slow', 70000)], ai_agent_activity_logs: [run('r1', 'Slow', 100)] }));
  assert.equal(find(worstFine, 'Slow').basis, 'average');
});

test('an average exactly at the interval does not flag', () => {
  assert.equal(find(ask(snap({ ai_agents: [agent('Slow', 60000)] })), 'Slow').unassessable_because, 'average_only');
});

test('a run exactly as long as the interval does not exceed it; one millisecond more does', () => {
  const at = ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 60000)] }));
  assert.equal(find(at, 'Slow').verdict, 'not_seen_to_overlap');
  assert.equal(find(at, 'Slow').basis, 'within_interval');
  const over = ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 60001)] }));
  assert.equal(find(over, 'Slow').verdict, 'can_overlap');
});

test('two recorded runs that overlapped flag the timer even inside the interval', () => {
  const a = ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 50000, '2026-10-31T10:00:50.000Z'), run('r2', 'Slow', 50000, '2026-10-31T10:01:20.000Z'), run('r3', 'Slow', 5000, '2026-10-31T10:02:30.000Z')] }));
  const t = find(a, 'Slow');
  assert.equal(t.basis, 'observed_overlap');
  assert.deepEqual(t.observed_overlaps, { count: 1, row_ids: ['r1', 'r2'] });
});

test('a long run covering several later runs counts each, and runs that only touch do not overlap', () => {
  const a = ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 300000, '2026-10-31T10:05:00.000Z'), run('r2', 'Slow', 1000, '2026-10-31T10:01:01.000Z'), run('r3', 'Slow', 1000, '2026-10-31T10:03:01.000Z')] }));
  assert.equal(find(a, 'Slow').observed_overlaps.count, 2);
  const b = ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 10000, '2026-10-31T10:00:10.000Z'), run('r2', 'Slow', 10000, '2026-10-31T10:00:20.000Z')] }));
  assert.equal(find(b, 'Slow').observed_overlaps.count, 0);
});

test('only this job\'s rows in the window count, and a null duration is no duration', () => {
  const rows = [run('old', 'Slow', 900000, '2026-09-01T10:00:00.000Z'), run('other', 'Slow', 900000, '2026-10-31T09:00:00.000Z', 'SomethingElse'), run('future', 'Slow', 900000, '2026-11-01T10:00:00.000Z'), run('nil', 'Slow', null), run('ok', 'Slow', 100)];
  const t = find(ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: rows })), 'Slow');
  assert.equal(t.duration.worst_ms, 100);
  assert.equal(t.duration.runs_in_window, 2);
  assert.equal(t.verdict, 'not_seen_to_overlap');
});

test('the window is read from the option', () => {
  const rows = [run('r1', 'Slow', 900000, '2026-10-20T10:00:00.000Z')];
  assert.equal(find(ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: rows }), FILES, 30), 'Slow').verdict, 'can_overlap');
  assert.equal(find(ask(snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: rows }), FILES, 7), 'Slow').unassessable_because, 'no_duration_recorded');
});

test('a governance row\'s active schedule and enabled flag win over the code', () => {
  const s = snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 90000)], cron_schedule_configs: [{ agent_name: 'Slow', active_schedule: '0 * * * *', enabled: false }] });
  const t = find(ask(s), 'Slow');
  assert.equal(t.schedule, '0 * * * *');
  assert.equal(t.interval_ms, 3600000);
  assert.equal(t.enabled, false);
  assert.equal(t.verdict, 'not_seen_to_overlap');
});

test('a disabled row is shown as disabled and still assessed', () => {
  const t = find(ask(snap({ ai_agents: [agent('Slow', null, false)], ai_agent_activity_logs: [run('r1', 'Slow', 90000)] })), 'Slow');
  assert.equal(t.enabled, false);
  assert.equal(t.verdict, 'can_overlap');
});

test('inline timers, a monthly gap, and timers with no name or literal schedule', () => {
  const a = ask(snap({ ai_agents: [agent('Monthly')], ai_agent_activity_logs: [run('r1', 'Monthly', 1000)] }));
  assert.equal(find(a, 'Inline1').interval_ms, 1800000);
  assert.deepEqual(find(a, 'Inline1').where, [`${S}/schedulerService.ts:3`]);
  assert.ok((find(a, 'Monthly').interval_ms as number) >= 28 * 86400000);
  assert.equal(find(a, 'Monthly').verdict, 'not_seen_to_overlap');
  assert.equal(find(a, `${S}/schedulerService.ts:8`).unassessable_because, 'no_run_name');
  assert.equal(find(a, `${S}/schedulerService.ts:8`).interval_ms, 600000);
  assert.equal(find(a, `${S}/schedulerService.ts:9`).unassessable_because, 'schedule_not_read');
  assert.equal(find(a, `${S}/schedulerService.ts:9`).schedule, null);
  assert.equal(a.counts.timers, 9);
});

test('a monthly timer with no fire in the next eight days still has an interval', () => {
  const a = ask(snap({ captured_at: '2026-10-05T12:00:00.000Z' }));
  assert.ok((find(a, 'Monthly').interval_ms as number) >= 28 * 86400000);
});

test('a claim is tied through the function a timer imports, and a deeper one is reported as not tied', () => {
  const a = ask(snap());
  const pub = find(a, 'Publisher');
  assert.equal(pub.guard.own_claim, 'claim_found');
  assert.deepEqual(pub.guard.claim_sites, [{ file: `${S}/publishing/worker.ts`, line: 3, kind: 'conditional_update' }]);
  assert.equal(find(a, 'Slow').guard.own_claim, 'none_found');
  assert.equal(find(a, 'Deep').guard.own_claim, 'none_found');
  assert.equal(a.counts.holding_own_claim, 1);
  assert.deepEqual(a.claims.not_tied, [{ file: `${S}/jobs.ts`, line: 3, kind: 'conditional_update' }]);
  assert.equal(a.claims.sites, 2);
  assert.equal(a.claims.tied_to_a_timer, 1);
});

test('imports resolve up a folder and to an index file, and a name that is not a function ties nothing', () => {
  const files = {
    ...FILES,
    [`${S}/scheduling/crons.ts`]: `import { runUp, NOT_FN } from '../jobs2';
import { runIdx } from './pkg';
export function start() {
  cron.schedule('0 * * * *', () => { instrumentCronJob('Up', () => runUp()).catch(() => {}); });
  cron.schedule('0 1 * * *', () => { instrumentCronJob('Idx', () => runIdx()).catch(() => {}); });
  cron.schedule('0 2 * * *', () => { instrumentCronJob('Con', () => go(NOT_FN)).catch(() => {}); });
}
`,
    [`${S}/jobs2.ts`]: `export const NOT_FN = 1;
export async function runUp() { await Row.update({ state: 'claimed' }, { where: { id, state: old } }); }
`,
    [`${S}/scheduling/pkg/index.ts`]: `export async function runIdx() { await q('SELECT 1 FOR UPDATE SKIP LOCKED'); }\n`,
  };
  const a = ask(snap(), files);
  assert.equal(find(a, 'Up').guard.claim_sites[0].kind, 'conditional_update');
  assert.equal(find(a, 'Idx').guard.claim_sites[0].kind, 'skip_locked');
  assert.equal(find(a, 'Con').guard.own_claim, 'none_found');
});

test('a claim does not clear a timer: it stays can_overlap with the claim shown', () => {
  const a = ask(snap({ ai_agents: [agent('Publisher')], ai_agent_activity_logs: [run('r1', 'Publisher', 90000)] }));
  assert.equal(find(a, 'Publisher').verdict, 'can_overlap');
  assert.equal(find(a, 'Publisher').guard.own_claim, 'claim_found');
});

test('claim markers: the three kinds, and not a plain update or a comment', () => {
  assert.deepEqual(claimsIn('f', "const q = `SELECT 1 FOR UPDATE SKIP LOCKED`;\n").map((c) => c.kind), ['skip_locked']);
  assert.deepEqual(claimsIn('f', "await q('SELECT pg_try_advisory_lock(1)');\n").map((c) => c.kind), ['advisory_lock']);
  assert.deepEqual(claimsIn('f', "await J.update({ status: 'running' }, { where: { id, status: 'queued' } });\n").map((c) => c.kind), ['conditional_update']);
  assert.deepEqual(claimsIn('f', "await J.update({ state: 'claimed' }, { where: { id } });\n"), []);
  assert.deepEqual(claimsIn('f', "await J.update({ status: 'in_progress' }, { where: { id, status: 'new' } });\n"), []);
  assert.deepEqual(claimsIn('f', "// FOR UPDATE SKIP LOCKED\n"), []);
});

test('noOverlap holds only when the callback hands the run back', () => {
  assert.deepEqual(libraryGuard("('* * * * *', () => { instrumentCronJob('A', f).catch(() => {}); }, { timezone: 'X' })"), { no_overlap: false, callback_holds_run: false });
  assert.deepEqual(libraryGuard("('* * * * *', () => { instrumentCronJob('A', f); }, { noOverlap: true })"), { no_overlap: true, callback_holds_run: false });
  assert.deepEqual(libraryGuard("('* * * * *', async () => { await instrumentCronJob('A', f); }, { noOverlap: true })"), { no_overlap: true, callback_holds_run: true });
  assert.deepEqual(libraryGuard("('* * * * *', () => instrumentCronJob('A', f))"), { no_overlap: false, callback_holds_run: true });
  assert.deepEqual(libraryGuard("('* * * * *', () => { return runAgent('A'); }, { noOverlap: false })"), { no_overlap: false, callback_holds_run: true });
  assert.deepEqual(libraryGuard("('* * * * *', () => { instrumentCronJob('A', () => go()).catch(() => {}); })"), { no_overlap: false, callback_holds_run: false });
  assert.deepEqual(guardInStarter(FILES[`${S}/aiOpsScheduler.ts`], 'startStandardTask'), { no_overlap: false, callback_holds_run: false });
  assert.equal(guardInStarter('x', 'startStandardTask'), null);
  assert.deepEqual(guardAtLine(FILES[`${S}/schedulerService.ts`], 8), { no_overlap: false, callback_holds_run: false });
  assert.equal(guardAtLine('nothing here', 1), null);
});

test('the answer repeats exactly and leaves its input alone', () => {
  const s = snap({ ai_agents: [agent('Slow', 70000)], ai_agent_activity_logs: [run('r1', 'Slow', 90000)] });
  const before = JSON.stringify(s);
  assert.deepEqual(ask(s), ask(s));
  assert.equal(JSON.stringify(s), before);
});

test('the skip policy stays K.D.\'s and the limits ship with the answer', () => {
  const a = ask(snap());
  assert.equal(a.policy_open.decided, false);
  assert.equal(a.policy_open.decided_by, 'K.D.');
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.match(a.statement, /^9 timers: 0 can overlap, 9 cannot be assessed, 0 not seen to overlap in 30 days\. Own claim found for 1\.$/);
});

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'overlap-'));
  for (const [f, text] of Object.entries(FILES)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); }
  return root;
}
const cli = (args: string[]) => spawnSync('node', ['src/cli/overlapGuard.ts', ...args], { encoding: 'utf8' });
const file = (root: string, v: unknown) => { const p = join(root, 'snap.json'); writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); return p; };

test('the CLI exits 3 when a timer can overlap, 4 when only unassessable, 1 on bad input', () => {
  const root = checkout();
  assert.equal(cli(['--source', root, '--snapshot', file(root, snap({ ai_agents: [agent('Slow')], ai_agent_activity_logs: [run('r1', 'Slow', 90000)] }))]).status, 3);
  const quiet = cli(['--source', root, '--snapshot', file(root, snap())]);
  assert.equal(quiet.status, 4);
  assert.equal(JSON.parse(quiet.stdout).source_commit, null);
  const { ai_agents: _dropped, ...partial } = snap();
  const bad = cli(['--source', root, '--snapshot', file(root, partial)]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /needs ai_agents\[\]/);
  assert.equal(cli(['--source', root, '--snapshot', file(root, 'not json')]).status, 1);
  assert.equal(cli(['--source', root]).status, 1);
  assert.equal(cli(['--source', root, '--snapshot', file(root, snap()), '--window-days', '0']).status, 1);
  assert.equal(cli(['--source', join(root, 'nope'), '--snapshot', 'x']).status, 1);
  assert.equal(cli(['--source', root, '--snapshot', file(root, { captured_at: 'never' })]).status, 1);
});

test('the example snapshot has the tables the CLI requires and only invented names', () => {
  const ex = JSON.parse(readFileSync('examples/overlap-guard.example.json', 'utf8')) as OverlapSnapshot;
  assert.ok(ex.ai_agents.every((a) => a.agent_name.startsWith('Example')));
  assert.equal(ex.ai_agent_activity_logs.length, 2);
  assert.equal(ex.cron_schedule_configs.length, 0);
});
