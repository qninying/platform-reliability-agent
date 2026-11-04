import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { RegistrySnapshot, RegistryRow } from '../src/capabilities/registryReadSurface.ts';
import type { ControlAgentRow, TimerRow } from '../src/capabilities/agentEnableDisableControl.ts';
import { previewDiscovery, FORCED_OFF, type SeedInventory } from '../src/capabilities/discoveryPreview.ts';

// Names and wiring mirror the platform's seed and timers; the registry rows are test inputs, not production data.
const reg = (name: string, over: Partial<RegistryRow> = {}): RegistryRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', schedule: null, run_count: 3, error_count: 0, last_run_at: null, ...over });
const seedRow = (name: string, enabled = true): ControlAgentRow => ({ id: `seed:${name}`, agent_name: name, enabled, status: 'idle' });
const timer = (name: string, gate: TimerRow['gates'][0]['gate'], flag: string | null = name): TimerRow => ({ timer: name, schedule: '*/5 * * * *', label: name, ref: `x.ts:${name.length}`, gates: [{ gate, flag }] });
const snap = (rows: RegistryRow[], timers: TimerRow[] = []): RegistrySnapshot => ({ captured_at: '2026-11-04T12:00:00Z', captured_by: 'test', ai_agents: rows, ai_agent_activity_logs: [], timers, timer_scope: ['x.ts'], cron_schedule_configs: [] });
const seed = (rows: ControlAgentRow[], timers: TimerRow[] = []): SeedInventory => ({ ai_agents: rows, timers });
const created = (p: ReturnType<typeof previewDiscovery>, name: string) => p.would_create.find((w) => w.agent_name === name);

test('acceptance: the report names each row that would be created and states whether each would arrive enabled', () => {
  const p = previewDiscovery(snap([reg('Existing')]), seed([seedRow('Existing'), seedRow('NewOn'), seedRow('NewOff', false)]));
  assert.deepEqual(p.would_create.map((w) => w.agent_name), ['NewOff', 'NewOn']);
  assert.equal(created(p, 'NewOn')!.arrives_enabled, true);
  assert.match(created(p, 'NewOn')!.why, /column defaults to true/);
  assert.equal(created(p, 'NewOff')!.arrives_enabled, false);
  assert.match(p.statement, /create 2 row\(s\), 1 arriving enabled/);
});

test('a row the seed forces off or retires arrives disabled, whatever its entry says', () => {
  const names = Object.keys(FORCED_OFF);
  const p = previewDiscovery(snap([]), seed(names.map((n) => seedRow(n))));
  for (const n of names) {
    assert.equal(created(p, n)!.arrives_enabled, false, n);
    assert.match(created(p, n)!.why, /agentRegistrySeed\.ts:/, n);
  }
});

test('a dead runAgent timer is named as one discovery would start; a tracked-cron timer as one it would start tracking', () => {
  const t = [timer('Dead', 'run_agent'), timer('Untracked', 'instrument_cron_job'), timer('Blind', 'none'), timer('Odd', 'unknown')];
  const p = previewDiscovery(snap([]), seed(['Dead', 'Untracked', 'Blind', 'Odd'].map((n) => seedRow(n)), t));
  assert.match(created(p, 'Dead')!.timers[0].change, /does nothing today .* starts running/);
  assert.match(created(p, 'Untracked')!.timers[0].change, /runs today untracked; it keeps running, now tracked/);
  assert.match(created(p, 'Blind')!.timers[0].change, /never reads the row/);
  assert.match(created(p, 'Odd')!.timers[0].change, /not known/);
  assert.match(p.statement, /start 1 timer\(s\) that do nothing today/);
});

test('a row arriving disabled stops an untracked timer that runs today', () => {
  const p = previewDiscovery(snap([]), seed([seedRow('GrowthJourneyExecutor', false)], [timer('GrowthJourneyExecutor', 'instrument_cron_job')]));
  assert.match(created(p, 'GrowthJourneyExecutor')!.timers[0].change, /arrives disabled, so it is skipped from then on/);
});

test('discovery reads the seed, not the timers: a timer with no row and no seed entry is never discovered', () => {
  const p = previewDiscovery(snap([]), seed([seedRow('Seeded')], [timer('Orphan', 'instrument_cron_job'), timer('Seeded', 'instrument_cron_job')]));
  assert.deepEqual(p.never_discovered.map((n) => n.timer), ['Orphan']);
  assert.match(p.statement, /no discovery run will ever register them/);
});

test('governance rows in the inventory are not seed entries, and rows the seed does not know are left alone and named', () => {
  const inv = seed([seedRow('A'), { id: 'governance:Gov', agent_name: 'Gov', enabled: true, status: 'idle' }]);
  const p = previewDiscovery(snap([reg('A'), reg('Manual')]), inv);
  assert.deepEqual(p.would_create, []);
  assert.deepEqual(p.not_in_seed, ['Manual']);
  assert.equal(p.would_rewrite, 1);
  assert.match(p.statement, /create no row/);
});

test('the predicted count is the rows created, and the platform\'s own figure is named as a row-count difference', () => {
  const p = previewDiscovery(snap([]), seed([seedRow('A'), seedRow('A'), seedRow('B')]));
  assert.equal(p.predicted_new_agents, 2, 'one row per agent_name');
  assert.ok(p.cannot_see.some((c) => /row count/.test(c)));
  assert.equal(p.decided_by, 'a named human');
});

test('every answer cites the registry rows it read, and the same input gives the same answer', () => {
  const s = snap([reg('B'), reg('A')]);
  const p = previewDiscovery(s, seed([seedRow('C')]));
  assert.deepEqual(p.citations.map((c) => c.id), ['row-A', 'row-B']);
  assert.deepEqual(previewDiscovery(s, seed([seedRow('C')])), p);
});

test('the command prints the whole preview, however long, and exits 3 when it would create rows', () => {
  const r = spawnSync(process.execPath, ['src/cli/registryAsk.ts', '--snapshot', 'examples/registry-ask.example.json', '--discovery-preview', '--seed', 'examples/timer-inventory.example.json'], { encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.ok(r.stdout.length > 65_536, 'longer than a pipe buffer');
  assert.ok(JSON.parse(r.stdout).discovery_preview.would_create.length > 0);
  const inv = JSON.parse(readFileSync('examples/timer-inventory.example.json', 'utf8'));
  assert.ok(inv.ai_agents.some((a: ControlAgentRow) => a.id.startsWith('seed:')));
  const bad = spawnSync(process.execPath, ['src/cli/registryAsk.ts', '--snapshot', 'examples/registry-ask.example.json', '--discovery-preview'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});
