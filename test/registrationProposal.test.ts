import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, reconcileAnswer, type Measurement } from '../src/capabilities/registryReconciliation.ts';
import { proposeRegistrations } from '../src/capabilities/registrationProposal.ts';
import { ContractViolation } from '../src/output/toolOutput.ts';
import { FILES } from './fixtures/registryCheckout.ts';

// The fixture is a small checkout shaped like the platform; the recorded run is the real measurement at 4443087.
const memReader = (files: Record<string, string>) => ({
  read(p: string) { if (!(p in files)) throw new Error(`${p} not in fixture`); return files[p]; },
  list(dir: string) { return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const NOW = new Date('2026-10-27T23:00:00Z');
const measured = (): Measurement => measure(memReader(FILES), NOW, 'abc123def');
const run = (m = measured()) => proposeRegistrations(m, reconcileAnswer(m));
const by = (p: ReturnType<typeof run>, name: string) => p.proposals.find((x) => x.name === name)!;

test('acceptance: every entry carries a real call-site citation and the measurement date, and the count is the one just measured', () => {
  const m = measured();
  const a = reconcileAnswer(m);
  const p = proposeRegistrations(m, a);
  assert.equal(p.count, a.classes.scheduledNamesWithNoSeedRow.count);
  assert.deepEqual(p.proposals.map((x) => x.name), a.classes.scheduledNamesWithNoSeedRow.entries);
  for (const x of p.proposals) {
    assert.ok(x.call_sites.length > 0, x.name);
    for (const c of x.call_sites) assert.match(c, /^backend\/src\/.+\.ts:\d+$/, x.name);
    assert.equal(x.measured_at, '2026-10-27T23:00:00.000Z');
    assert.equal(x.source_commit, 'abc123def');
  }
  assert.match(p.statement, /measured 2026-10-27T23:00:00\.000Z at platform commit abc123def/);
});

test('acceptance (drift): every published count has its names behind it, and WorkforceIntelligence is in the no-seed-row class on the real run', () => {
  const real = JSON.parse(readFileSync('examples/registry-reconciliation.run-4443087.json', 'utf8'));
  for (const [k, c] of Object.entries(real.classes) as Array<[string, { count: number; entries: string[] }]>) assert.equal(c.count, c.entries.length, k);
  assert.ok(real.classes.scheduledNamesWithNoSeedRow.entries.includes('WorkforceIntelligence'));
});

test('a name measured as untracked with no call site recorded is refused, not published as a bare count', () => {
  const m = measured();
  const a = reconcileAnswer(m);
  m.nameSites = m.nameSites.filter((s) => s.name !== 'Uninst');
  assert.throws(() => proposeRegistrations(m, a), ContractViolation);
});

test('each proposal states the enabled value: an untracked timer that runs today keeps running', () => {
  const x = by(run(), 'Uninst');
  assert.equal(x.runs_today, 'yes_untracked');
  assert.deepEqual(x.proposed_row, { agent_name: 'Uninst', trigger_type: 'cron', schedule: '0 3 * * *', enabled: true });
  assert.match(x.enabled_because, /disabled would stop it/);
  assert.equal(x.govern_or_retire, 'a person decides');
});

test('a timer gated by another row that exists needs no new row, and the proposal says which row gates it', () => {
  const x = by(run(), 'Drift');
  assert.equal(x.runs_today, 'yes_on_another_row');
  assert.equal(x.governed_by, 'DriftAgent');
  assert.equal(x.proposed_row, null);
});

test('a runner that reads a row that does not exist does nothing today, and the row proposed is that row, arriving disabled', () => {
  const m = measured();
  m.recordedUnder = m.recordedUnder.map((r) => (r.agentName === 'Drift' ? { ...r, row: 'NoSuchRow', how: 'runAgent' as const } : r));
  const x = by(proposeRegistrations(m, reconcileAnswer(m)), 'Drift');
  assert.equal(x.runs_today, 'no_row_to_run_on');
  assert.equal(x.proposed_row!.agent_name, 'NoSuchRow');
  assert.equal(x.proposed_row!.enabled, false, 'arriving enabled would start a job that does nothing today');
  assert.match(x.enabled_because, /would start it/);
});

test('a runner Ellis cannot read is "cannot say", never assumed to run', () => {
  assert.equal(by(run(), 'Mystery').runs_today, 'cannot_say');
  assert.equal(by(run(), 'Director').runs_today, 'cannot_say');
});

test('an unreadable schedule is left for a person, and a row outside the seed is named', () => {
  const p = run();
  assert.equal(by(p, 'Intel_alpha').proposed_row!.schedule, null);
  assert.match(by(p, 'Intel_alpha').notes[0], /not a literal cron expression/);
  assert.equal(by(p, 'AfterRegex').proposed_row!.schedule, null, 'a name outside any cron.schedule call borrows no neighbour\'s schedule');
  // A domain row already carries the name, so no second row is proposed (it would collide with the first).
  const d = by(p, 'DomainScheduled');
  assert.deepEqual([d.runs_today, d.proposed_row], ['yes_on_its_own_row', null]);
  assert.match(d.enabled_because, /a domain row under its own name exists outside the seed/);
  assert.ok(d.notes.some((n) => /domain row already carries this name/.test(n)));
});

test('a name registered on two schedules gets no schedule proposed, and says why', () => {
  const m = measured();
  m.nameSites = [...m.nameSites, { name: 'Uninst', ref: 'backend/src/services/other.ts:3', schedule: '0 9 * * *' }];
  const x = by(proposeRegistrations(m, reconcileAnswer(m)), 'Uninst');
  assert.equal(x.proposed_row!.schedule, null);
  assert.ok(x.notes.some((n) => /registered on 2 schedules/.test(n)));
});

test('a name more than 15 lines below the nearest cron.schedule borrows no schedule', () => {
  const far = `cron.schedule('0 5 * * *', () => { go(); });\n${'\n'.repeat(20)}instrumentCronJob('FarAway', fn);\n`;
  const near = `cron.schedule('0 6 * * *', () => {\n${'\n'.repeat(10)}  instrumentCronJob('NearBy', fn);\n});\n`;
  const m = measure(memReader({ ...FILES, 'backend/src/services/farAway.ts': far, 'backend/src/services/nearBy.ts': near }), NOW, null);
  assert.equal(m.nameSites.find((s) => s.name === 'FarAway')!.schedule, null);
  assert.equal(m.nameSites.find((s) => s.name === 'NearBy')!.schedule, '0 6 * * *');
});

test('the same measurement always gives the same proposals', () => {
  const m = measured();
  assert.deepEqual(proposeRegistrations(m, reconcileAnswer(m)), proposeRegistrations(m, reconcileAnswer(m)));
});
