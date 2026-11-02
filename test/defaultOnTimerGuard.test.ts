import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { guard, defaultSites, sitesAsExpected, readFailure, modelDefault, seededRows, FILES, type Rows } from '../src/capabilities/defaultOnTimerGuard.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const SCHEDULER = `
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'Seeded', hardcodedSchedule: '*/5 * * * *', runner: runSeeded, label: 'Seeded' },
  { agentName: 'Bare', hardcodedSchedule: '0 * * * *', runner: runBare, label: 'Bare' },
  { agentName: 'Twice', hardcodedSchedule: '0 1 * * *', runner: runTwiceA, label: 'Twice A' },
  { agentName: 'Twice', hardcodedSchedule: '0 2 * * *', runner: runTwiceB, label: 'Twice B' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  { agentName: 'Brief', hardcodedSchedule: '45 6 * * *', dynamicImport: async () => { await brief(); }, label: 'Briefing' },
];
export async function reloadAIOpsSchedules() {
  // If the DB read fails, change NOTHING. const enabled = dbEntry?.enabled ?? true;
  const dbSchedules = await resolveAllCronSchedules();
  const byAgent = new Map();
  for (const [agentName, entries] of byAgent) {
    const dbEntry = dbSchedules.get(agentName);
    const enabled = dbEntry?.enabled ?? true;
  }
}
export async function startAIOpsScheduler() {
  let dbSchedules = new Map();
  try {
    dbSchedules = await resolveAllCronSchedules();
  } catch (err: any) {
    console.warn('using hardcoded defaults', err.message);
  }
  for (const entry of SCHEDULE_REGISTRY) {
    const dbEntry = dbSchedules.get(entry.agentName);
    const enabled = dbEntry?.enabled ?? true;
  }
  for (const entry of DYNAMIC_SCHEDULE_REGISTRY) {
    const dbEntry = dbSchedules.get(entry.agentName);
    const enabled = dbEntry?.enabled ?? true;
  }
}
`;
const SWALLOWS = `
export async function resolveAllCronSchedules(): Promise<Map<string, ResolvedCronSchedule>> {
  const map = new Map();
  try {
    const rows = await CronScheduleConfig.findAll();
    for (const row of rows) map.set(row.agent_name, row);
  } catch (err) {
    console.warn('[GovernanceResolution] Failed to load cron schedules:', (err as Error).message);
  }
  return map;
}
`;
const RETHROWS = SWALLOWS.replace("console.warn('[GovernanceResolution] Failed to load cron schedules:', (err as Error).message);", 'throw err;');
const MODEL = `
CronScheduleConfig.init({
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
});
`;
const SEED = `
const CRON_SCHEDULES: { agent_name: string; default_schedule: string }[] = [
  { agent_name: 'Seeded', default_schedule: '*/5 * * * *' },
  // { agent_name: 'Commented', default_schedule: '0 * * * *' },
  { agent_name: 'Orphan', default_schedule: '*/2 * * * *' },
];
async function seed() {
  for (const sched of CRON_SCHEDULES) {
    await CronScheduleConfig.findOrCreate({ where: { agent_name: sched.agent_name }, defaults: { enabled: true } as any });
  }
}
`;
const BASE: Record<string, string> = { [FILES.scheduler]: SCHEDULER, [FILES.resolver]: SWALLOWS, [FILES.model]: MODEL, [FILES.seed]: SEED };
const lineOf = (text: string, needle: string, from = 0) => text.slice(0, text.indexOf(needle, from)).split('\n').length;

function rdr(over: Record<string, string> = {}): Reader {
  const files = { ...BASE, ...over };
  return {
    read(rel) { if (!(rel in files)) throw new Error(`no ${rel}`); return files[rel]; },
    list() { return Object.keys(files).sort(); },
  };
}

function checkout(over: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ellis-dot-'));
  for (const [rel, text] of Object.entries({ ...BASE, ...over })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const CLI = join(import.meta.dirname, '../src/cli/defaultOnTimers.ts');
const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('acceptance: the enumeration is a measured list of names, not a count, and it states the three code locations where the default is applied', () => {
  const a = guard(rdr(), 'abc1234', null);
  assert.deepEqual(a.ungoverned.map((u) => u.name), ['Bare', 'Brief', 'Twice']);
  assert.ok(a.ungoverned.every((u) => u.enabled_by_default === true));
  const reload = SCHEDULER.indexOf('const enabled', SCHEDULER.indexOf('for (const [agentName'));
  const boot = SCHEDULER.indexOf('for (const entry of SCHEDULE_REGISTRY)');
  const dyn = SCHEDULER.indexOf('for (const entry of DYNAMIC_SCHEDULE_REGISTRY)');
  assert.deepEqual(a.default_sites.map((s) => [s.line, s.path, s.covers]), [
    [lineOf(SCHEDULER, 'const enabled', reload), 'reload', 'both registries'],
    [lineOf(SCHEDULER, 'const enabled', boot), 'boot', 'SCHEDULE_REGISTRY'],
    [lineOf(SCHEDULER, 'const enabled', dyn), 'boot', 'DYNAMIC_SCHEDULE_REGISTRY'],
  ]);
  assert.equal(a.sites_as_expected, true);
  for (const s of a.default_sites) assert.ok(a.statement.includes(`${FILES.scheduler}:${s.line}`), 'the statement names every site');
  assert.match(a.statement, /^3 of 4 registry names have no governing/);
  assert.match(a.decision, /K\.D\. rules on each name/);
});

test('a name registered twice is one name with both registry lines', () => {
  const t = guard(rdr(), null, null).ungoverned.find((u) => u.name === 'Twice')!;
  assert.deepEqual(t.at, [`${FILES.scheduler}:${lineOf(SCHEDULER, "'Twice A'")}`, `${FILES.scheduler}:${lineOf(SCHEDULER, "'Twice B'")}`]);
  assert.deepEqual(t.hardcoded_schedules, ['0 1 * * *', '0 2 * * *']);
  assert.deepEqual(t.registries, ['SCHEDULE_REGISTRY']);
});

test('without records it measures against the seeded rows and says they are not production rows', () => {
  const a = guard(rdr(), null, null);
  assert.equal(a.rows_from, 'seed');
  assert.equal(a.rows_captured_at, null);
  assert.deepEqual(a.rows_without_registry_entry, ['Orphan']);
  assert.ok(a.blind_spots.some((b) => /not production rows/.test(b)));
  assert.match(a.statement, /measured against the rows the seed creates/);
});

test('exported rows replace the seed: a governed name drops out, a disabled one is named, and an empty table governs nothing', () => {
  const rows: Rows = { from: 'records', captured_at: '2026-11-02T00:00:00Z', rows: [{ agent_name: 'Bare', enabled: false }, { agent_name: 'Brief', enabled: true }] };
  const a = guard(rdr(), null, rows);
  assert.deepEqual(a.ungoverned.map((u) => u.name), ['Seeded', 'Twice']);
  assert.deepEqual(a.governed, { names: 2, disabled: ['Bare'] });
  assert.ok(!a.blind_spots.some((b) => /not production rows/.test(b)));
  assert.match(a.statement, /exported rows captured 2026-11-02T00:00:00Z/);
  const none = guard(rdr(), null, { from: 'records', captured_at: '2026-11-02T00:00:00Z', rows: [] });
  assert.equal(none.ungoverned.length, 4);
  assert.equal(none.governed.names, 0);
});

test('a default in a comment is not a site, and a missing or extra site is flagged as unexpected', () => {
  assert.equal(defaultSites(SCHEDULER).length, 3);
  const dropped = SCHEDULER.replace(/(for \(const entry of DYNAMIC_SCHEDULE_REGISTRY\) \{[\s\S]*?)const enabled = dbEntry\?\.enabled \?\? true;/, '$1const enabled = dbEntry?.enabled ?? false;');
  const a = guard(rdr({ [FILES.scheduler]: dropped }), null, null);
  assert.equal(a.default_sites.length, 2);
  assert.equal(a.sites_as_expected, false);
  assert.ok(a.blind_spots.some((b) => /expected shape/.test(b)));
  const extra = SCHEDULER + 'function other() { for (const x of things) { const enabled = row?.enabled ?? true; } }\n';
  const sites = defaultSites(extra);
  assert.deepEqual(sites.at(-1), { file: FILES.scheduler, line: sites.at(-1)!.line, path: 'other', covers: 'unknown' });
  assert.equal(sitesAsExpected(sites), false);
  const s3 = defaultSites(SCHEDULER);
  assert.equal(sitesAsExpected([s3[1], s3[2], { ...s3[0], path: 'other', covers: 'unknown' }]), false, 'three sites with no reload site is not the expected shape');
});

test('read failure: a resolver that swallows the error makes boot and reload fail open', () => {
  const rf = readFailure(SCHEDULER, SWALLOWS);
  assert.equal(rf.resolver.fails_open, true);
  assert.equal(rf.resolver.line, lineOf(SWALLOWS, 'catch'));
  assert.equal(rf.boot.fails_open, true);
  assert.equal(rf.reload.fails_open, true);
  assert.match(rf.reload.why, /cannot tell a failed read from no rows/);
  assert.equal(rf.reload.line, lineOf(SCHEDULER, 'resolveAllCronSchedules()'));
});

test('read failure: when the resolver rethrows, reload stops but boot still fails open through its own catch', () => {
  const rf = readFailure(SCHEDULER, RETHROWS);
  assert.equal(rf.resolver.fails_open, false);
  assert.equal(rf.reload.fails_open, false);
  assert.equal(rf.boot.fails_open, true);
  assert.equal(rf.boot.line, lineOf(SCHEDULER, 'catch (err: any)'));
  const guarded = SCHEDULER.replace("console.warn('using hardcoded defaults', err.message);", 'throw err;');
  assert.equal(readFailure(guarded, RETHROWS).boot.fails_open, false);
});

test('read failure: a resolver or caller that is missing gives null, never a guess', () => {
  const rf = readFailure(SCHEDULER, 'export const nothing = 1;');
  assert.equal(rf.resolver.fails_open, null);
  assert.equal(rf.reload.fails_open, null);
  assert.equal(rf.boot.fails_open, true, 'boot fails open through its own catch whatever the resolver does');
  const noCall = readFailure(SCHEDULER.replace('try {\n    dbSchedules = await resolveAllCronSchedules();', 'try {\n    dbSchedules = await other();'), SWALLOWS);
  assert.equal(noCall.boot.fails_open, null);
  assert.equal(noCall.reload.fails_open, true);
});

test('the model default and the seed are read from source; a renamed seed list is an error, not an empty list', () => {
  assert.deepEqual(modelDefault(MODEL), { file: FILES.model, line: lineOf(MODEL, 'enabled:') });
  assert.equal(modelDefault(MODEL.replace('defaultValue: true', 'defaultValue: false')), null);
  assert.deepEqual(seededRows(SEED), [{ agent_name: 'Seeded', enabled: true }, { agent_name: 'Orphan', enabled: true }]);
  assert.deepEqual(seededRows(SEED.replace('enabled: true', 'enabled: false')).map((r) => r.enabled), [false, false]);
  assert.throws(() => guard(rdr({ [FILES.seed]: SEED.replace('CRON_SCHEDULES', 'SCHEDULES') }), null, null), /CRON_SCHEDULES not found/);
});

test('idempotent: the same source and rows give the same answer twice', () => {
  assert.deepEqual(guard(rdr(), 'abc', null), guard(rdr(), 'abc', null));
});

test('cli: exit 3 with names ungoverned, 0 when every name has a row, 5 on an unexpected shape, 1 on bad input', () => {
  const root = checkout();
  const r3 = run(['--source', root]);
  assert.equal(r3.status, 3, r3.stderr);
  assert.deepEqual(JSON.parse(r3.stdout).ungoverned.map((u: { name: string }) => u.name), ['Bare', 'Brief', 'Twice']);
  const all = join(root, 'rows.json');
  writeFileSync(all, JSON.stringify({ captured_at: '2026-11-02T00:00:00Z', cron_schedule_configs: ['Seeded', 'Bare', 'Twice', 'Brief'].map((agent_name) => ({ agent_name, enabled: true })) }));
  assert.equal(run(['--source', root, '--rows', all]).status, 0);
  const odd = checkout({ [FILES.scheduler]: SCHEDULER + 'function other() { const enabled = row?.enabled ?? true; }\n' });
  assert.equal(run(['--source', odd]).status, 5);
  const bad = (body: unknown) => { const p = join(root, 'bad.json'); writeFileSync(p, JSON.stringify(body)); return run(['--source', root, '--rows', p]); };
  assert.equal(bad({ captured_at: '2026-11-02T00:00:00Z' }).status, 1);
  assert.match(bad({ captured_at: '2026-11-02T00:00:00Z' }).stderr, /a missing table is not an empty one/);
  assert.equal(bad({ captured_at: 'not a date', cron_schedule_configs: [] }).status, 1);
  assert.equal(bad({ captured_at: '2026-11-02T00:00:00Z', cron_schedule_configs: [{ agent_name: 'Bare', enabled: 'yes' }] }).status, 1);
  assert.equal(run([]).status, 1);
});
