import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehearse, ratchetRun, plant, checkFixture, loadRatchetFixture, type RatchetFixture, type Plant } from '../src/capabilities/ratchetRehearsal.ts';
import { CLASS_KEYS } from '../src/capabilities/registryReconciliation.ts';
import { ratchetRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The checkout is the R2 test checkout, shaped like the platform's; its names are test inputs, not production names.
const FIXTURE = 'examples/registry-ratchet.fixture.json';
const load = (): RatchetFixture => loadRatchetFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const C = { captured_at: '2026-11-05T18:00:00Z', captured_by: 'test' };
const by = (r: ReturnType<typeof rehearse>, id: string) => r.plants.find((p) => p.id === id)!;
const withPlant = (fx: RatchetFixture, id: string, over: Partial<Plant>): RatchetFixture => ({ ...fx, plants: fx.plants.map((p) => (p.id === id ? { ...p, ...over } : p)) });

test('acceptance (R4): a planted new violation fails the ratchet and a planted healed entry also fails it, in every class', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  assert.deepEqual(r.untouched, [], 'the untouched checkout passes, so a failing plant means something');
  for (const k of CLASS_KEYS) {
    for (const d of ['new', 'healed'] as const) {
      const p = r.plants.find((x) => x.class === k && x.direction === d)!;
      assert.ok(p.failures!.some((f) => f.class === k && f.direction === d), `${d} ${k} fails the ratchet`);
    }
  }
  assert.deepEqual(by(r, 'phantom-row-removed').failures, [{ class: 'cronSeedRowsWithNoRegistration', direction: 'healed', entry: 'Phantom' }]);
  assert.deepEqual(by(r, 'new-schedule-disagreement').failures, [{ class: 'scheduleDisagreements', direction: 'new', entry: 'Same|*/7 * * * *|*/5 * * * *' }]);
  assert.match(r.statement, /5 new violations and 5 healed entries, and every plant failed the ratchet with exactly the entries its record expects/);
  assert.match(r.statement, /let all 5 healed plants through\. Sandbox only; nothing ran on the platform\.$/);
  assert.equal(r.limits.length, 3);
});

test('the contrast: a ratchet that checks new entries only lets every healed plant through and still catches every new one', () => {
  const r = rehearse(load());
  assert.deepEqual(r.plants.map((p) => [p.id, p.one_way_failures!.length > 0]), r.plants.map((p) => [p.id, p.direction === 'new']));
  assert.equal(r.checks.one_way_ratchet_misses_healed, true);
  // A "healed" plant that also adds a new violation is caught one way, so the contrast fails.
  const fx = load();
  const mixed = withPlant(fx, 'phantom-row-removed', { edits: [...fx.plants.find((p) => p.id === 'phantom-row-removed')!.edits, ...fx.plants.find((p) => p.id === 'new-phantom-row')!.edits] });
  assert.equal(rehearse(mixed).checks.one_way_ratchet_misses_healed, false);
  // A plant labelled new that only heals is missed one way, so the contrast fails as well.
  assert.equal(rehearse(withPlant(fx, 'phantom-row-removed', { direction: 'new' })).checks.one_way_ratchet_misses_healed, false);
});

test('a plant passes its check only when it fails the ratchet with exactly what it expects', () => {
  const fx = load();
  const same = withPlant(fx, 'new-phantom-row', { edits: [{ file: fx.plants[0].edits[0].file, find: '  ...GROWTH_JOURNEY_AGENT_ENTRIES,', replace: '  ...GROWTH_JOURNEY_AGENT_ENTRIES,' }], expect: [] as never });
  assert.equal(rehearse({ ...same, plants: same.plants.map((p) => (p.id === 'new-phantom-row' ? { ...p, expect: [] } : p)) }).checks['new-phantom-row'], false, 'a plant that changes nothing passes the ratchet, so it is not a plant');
  const wrong = withPlant(fx, 'new-phantom-row', { expect: [{ class: 'cronSeedRowsWithNoRegistration', direction: 'healed', entry: 'NewPhantom' }] });
  assert.equal(rehearse(wrong).checks['new-phantom-row'], false, 'the direction must match');
  const short = withPlant(fx, 'duplicate-entry-removed', { expect: [{ class: 'duplicateRegistryNames', direction: 'healed', entry: 'Dup|SCHEDULE_REGISTRY|0 1 * * *,0 2 * * *' }] });
  const r = rehearse(short);
  assert.deepEqual([r.checks['duplicate-entry-removed'], r.verified], [false, false], 'a failure the record did not expect is not ignored');
  const stale = withPlant(fx, 'new-phantom-row', { edits: [{ file: fx.plants[0].edits[0].file, find: 'not in the file', replace: 'x' }] });
  const s = rehearse(stale);
  assert.deepEqual([by(s, 'new-phantom-row').failures, s.checks['new-phantom-row']], [null, false]);
  assert.match(by(s, 'new-phantom-row').missed!, /is not there/);
});

test('if the untouched checkout already fails, the run is not verified', () => {
  const fx = load();
  const baseline = fx.files[fx.baseline_file].replace("  'Phantom',\n", '');
  const r = rehearse({ ...fx, files: { ...fx.files, [fx.baseline_file]: baseline } });
  assert.deepEqual(r.untouched, [{ class: 'cronSeedRowsWithNoRegistration', direction: 'new', entry: 'Phantom' }]);
  assert.deepEqual([r.checks.untouched_checkout_passes, r.verified], [false, false]);
});

test('planting replaces one exact passage that appears once, and never changes the checkout it was given', () => {
  const files = { a: 'x y x', b: 'z' };
  assert.deepEqual(plant(files, [{ file: 'a', find: 'x', replace: 'q' }]), { missed: 'a: the passage to replace appears more than once' });
  assert.deepEqual(plant(files, [{ file: 'b', find: 'z', replace: 'w' }, { file: 'a', find: 'y', replace: 'Y' }]), { files: { a: 'x Y x', b: 'w' } });
  assert.deepEqual(files, { a: 'x y x', b: 'z' });
  const fx = load();
  const planted = plant(fx.files, fx.plants.find((p) => p.id === 'new-phantom-row')!.edits) as { files: Record<string, string> };
  assert.deepEqual(ratchetRun(planted.files, fx.baseline_file, ['healed']), [], 'a healed-only ratchet ignores a new entry');
  // Every file in the checkout is read: a name fired from server.ts, the first file listed, is drift too.
  const server = { ...fx.files, 'backend/src/server.ts': `${fx.files['backend/src/server.ts']}cron.schedule('0 1 * * *', () => { instrumentCronJob('ServerTimer', run); });\n` };
  assert.deepEqual(ratchetRun(server, fx.baseline_file), [{ class: 'scheduledNamesWithNoSeedRow', direction: 'new', entry: 'ServerTimer' }]);
  assert.throws(() => ratchetRun({ ...fx.files, 'backend/src/services/aiOrchestrator.ts': undefined as never }, fx.baseline_file), /not in the sandbox checkout/);
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified run is ok citing every plant; a failed run cites the plants that went wrong and what the untouched checkout failed on', () => {
  const o = ratchetRehearsalOutput(rehearse(load()), C, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 10);
  assert.deepEqual(o.evidence[1], { table: 'sandbox_plants', id: 'phantom-row-removed', fields: ['healed cronSeedRowsWithNoRegistration', 'healed cronSeedRowsWithNoRegistration: Phantom'] });
  assert.match(o.as_of.note!, /sandbox fixture registry-ratchet-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 3);
  const fx = load();
  const f = ratchetRehearsalOutput(rehearse({ ...fx, files: { ...fx.files, [fx.baseline_file]: fx.files[fx.baseline_file].replace("  'Phantom',\n", '') } }), C, EMPTY);
  assert.equal(f.verdict, 'problem');
  // Every plant now also carries the checkout's own failure, so none matches what it expects and all are cited.
  assert.equal(f.evidence.length, 11);
  assert.equal(f.evidence.find((x) => x.id === 'phantom-row-removed')!.fields[1], 'passed the ratchet');
  assert.deepEqual(f.evidence.at(-1), { table: 'sandbox_checkout', id: 'Phantom', fields: ['new cronSeedRowsWithNoRegistration'] });
  const missed = ratchetRehearsalOutput(rehearse(withPlant(fx, 'new-phantom-row', { edits: [{ file: fx.plants[0].edits[0].file, find: 'absent', replace: 'x' }] })), C, EMPTY);
  assert.deepEqual(missed.evidence.map((x) => x.id), ['new-phantom-row'], 'only the plant that went wrong is cited');
  assert.match(missed.evidence[0].fields[1], /is not there/);
});

test('a fixture is refused without its parts, with a malformed or baseline-editing plant, or without both directions for every class; the command exits 0, 3 and 1', () => {
  const base = load();
  const p0 = base.plants[0];
  const bad: RatchetFixture[] = [
    { ...base, fixture_id: 1 as never }, { ...base, files: undefined as never }, { ...base, files: { ...base.files, x: 1 as never } },
    { ...base, baseline_file: 'nope.ts' }, { ...base, plants: undefined as never },
    withPlant(base, p0.id, { class: 'notAClass' as never }), withPlant(base, p0.id, { direction: 'sideways' as never }), withPlant(base, p0.id, { what: undefined as never }),
    withPlant(base, p0.id, { edits: [] }), withPlant(base, p0.id, { edits: [{ ...p0.edits[0], file: 'nope.ts' }] }), withPlant(base, p0.id, { edits: [{ ...p0.edits[0], find: '' }] }),
    withPlant(base, p0.id, { edits: [{ ...p0.edits[0], replace: undefined as never }] }),
    withPlant(base, p0.id, { expect: [] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], direction: 'x' as never }] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], entry: 1 as never }] }), withPlant(base, p0.id, { expect: [{ ...p0.expect[0], class: 'notAClass' as never }] }),
    withPlant(base, p0.id, { id: 1 as never }),
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture(withPlant(base, p0.id, { edits: [{ file: base.baseline_file, find: "'Phantom'", replace: "'X'" }] }), 'inline'), /edits the baseline/);
  assert.throws(() => checkFixture({ ...base, plants: [...base.plants, p0] }, 'inline'), /listed once/);
  assert.throws(() => checkFixture({ ...base, plants: base.plants.filter((p) => p.id !== 'denying-row-corrected') }, 'inline'), /no healed plant for registeredRowsDenyingSchedule/);
  assert.throws(() => checkFixture({ ...base, plants: base.plants.filter((p) => p.id !== 'new-duplicate-name') }, 'inline'), /no new plant for duplicateRegistryNames/);
  const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli/ratchetRehearsal.ts', ...a], { encoding: 'utf8' });
  const ok = cli('--fixture', FIXTURE);
  assert.equal(ok.status, 0, ok.stderr);
  const notFx = join(mkdtempSync(join(tmpdir(), 'ellis-ratchet-')), 'f.json');
  writeFileSync(notFx, JSON.stringify(withPlant(base, p0.id, { expect: [{ ...p0.expect[0], entry: 'Other' }] })));
  assert.equal(cli('--fixture', notFx).status, 3);
  assert.equal(cli().status, 1);
  const missing = cli('--fixture', 'examples/nope.json');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
