// platform.registry_runtime_reconciliation, rung R4: runs the full reconciliation and the ratchet against a sandbox
// checkout, once untouched and once per planted change. Each of the five drift classes is planted in both
// directions: a new violation, and a healed entry (one the baseline lists that is no longer observed). The ratchet
// must fail every plant with exactly the entries its record expects, and pass the untouched checkout. A ratchet that checks
// new entries only, the platform's own mutant M8, runs beside it as the contrast: it misses every healed plant.
// Sandbox only: nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit a29dfb245; both files unchanged since 4443087):
// - ratchet(observed, baseline) returns newViolations and healedBaselineEntries, and either fails the suite,
//   "because a baseline that is never pruned is an allowlist"
//   (backend/src/services/__tests__/fixtures/cronRegistryRatchet.ts:147-160).
// - The platform's test file lists "M8 ratchet(): return healedBaselineEntries: []" among the mutations its suite
//   must catch (backend/src/services/__tests__/cronRegistryReconciliation.test.ts:81).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { measure, parseBaseline, reconcileAnswer, CLASS_KEYS, type ClassKey, type Reader } from './registryReconciliation.ts';

export const PINNED_AT = 'a29dfb245';
export const LIMITS: readonly string[] = [
  'The checkout is a small one shaped like the platform\'s, not the platform itself. The reconciliation over the real checkout is the R2 answer; this rung shows the ratchet fails in both directions.',
  'Each plant changes one thing. Two changes that cancel out in one class, a new entry and a healed one with the same text, are not planted.',
  'The platform\'s ratchet runs in its test suite only; nothing in production compares the two lists. Running a ratchet anywhere else is a change a person makes.',
];

export type Direction = 'new' | 'healed';
export interface Failure { class: ClassKey; direction: Direction; entry: string }
export interface Edit { file: string; find: string; replace: string }
export interface Plant { id: string; class: ClassKey; direction: Direction; what: string; edits: Edit[]; expect: Failure[] }
export interface RatchetFixture { fixture_id: string; description: string; baseline_file: string; files: Record<string, string>; plants: Plant[] }

const MEASURED_AT = new Date('2026-11-05T00:00:00Z');

// Reads a sandbox checkout held as { path: text }. A path with no text is missing, never empty.
export const reader = (files: Record<string, string>): Reader => ({
  read(rel) {
    if (typeof files[rel] !== 'string') throw new SandboxError('SourceUnavailable', `${rel} is not in the sandbox checkout`);
    return files[rel];
  },
  list: (dir) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(),
});

// The full reconciliation, then the ratchet over each class in the directions given.
export function ratchetRun(files: Record<string, string>, baselineFile: string, directions: Direction[] = ['new', 'healed']): Failure[] {
  const m = measure(reader(files), MEASURED_AT, 'sandbox');
  m.baseline = parseBaseline(files[baselineFile]);
  const a = reconcileAnswer(m);
  return CLASS_KEYS.flatMap((k) => [
    ...(directions.includes('new') ? a.classes[k].new_since_baseline!.map((entry): Failure => ({ class: k, direction: 'new', entry })) : []),
    ...(directions.includes('healed') ? a.classes[k].healed_since_baseline!.map((entry): Failure => ({ class: k, direction: 'healed', entry })) : []),
  ]);
}

// Returns the planted checkout, or why an edit did not apply: each passage must appear exactly once.
export function plant(files: Record<string, string>, edits: Edit[]): { files: Record<string, string> } | { missed: string } {
  const out = { ...files };
  for (const e of edits) {
    const text = out[e.file];
    const at = text.indexOf(e.find);
    if (at === -1 || text.indexOf(e.find, at + 1) !== -1) return { missed: `${e.file}: the passage to replace ${at === -1 ? 'is not there' : 'appears more than once'}` };
    out[e.file] = text.slice(0, at) + e.replace + text.slice(at + e.find.length);
  }
  return { files: out };
}

const canon = (fs: Failure[]) => fs.map((f) => `${f.class}|${f.direction}|${f.entry}`).sort();
const equal = (a: Failure[], b: Failure[]) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export interface PlantResult { id: string; class: ClassKey; direction: Direction; what: string; missed: string | null; failures: Failure[] | null; one_way_failures: Failure[] | null; expect: Failure[] }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  untouched: Failure[];
  plants: PlantResult[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: RatchetFixture): Rehearsal {
  const untouched = ratchetRun(fx.files, fx.baseline_file);
  const plants = fx.plants.map((p): PlantResult => {
    const base = { id: p.id, class: p.class, direction: p.direction, what: p.what, expect: p.expect };
    const planted = plant(fx.files, p.edits);
    if ('missed' in planted) return { ...base, missed: planted.missed, failures: null, one_way_failures: null };
    return { ...base, missed: null, failures: ratchetRun(planted.files, fx.baseline_file), one_way_failures: ratchetRun(planted.files, fx.baseline_file, ['new']) };
  });
  const checks: Record<string, boolean> = {
    // If the untouched checkout fails, a failing plant proves nothing.
    untouched_checkout_passes: untouched.length === 0,
    ...Object.fromEntries(plants.map((p) => [p.id, p.failures !== null && p.failures.length > 0 && equal(p.failures, p.expect)])),
    // The contrast: checking new entries only lets every healed plant through, and still catches every new one.
    one_way_ratchet_misses_healed: plants.filter((p) => p.one_way_failures).every((p) => (p.direction === 'healed') === (p.one_way_failures!.length === 0)),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const n = (d: Direction) => plants.filter((p) => p.direction === d).length;
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, untouched, plants, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}: the full reconciliation and ratchet passed the untouched checkout. Each of the five drift classes was planted in both directions, ${n('new')} new violations and ${n('healed')} healed entries, and every plant failed the ratchet with exactly the entries its record expects. A ratchet that checks new entries only, the platform's own mutant M8, let all ${n('healed')} healed plants through. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

export function loadRatchetFixture(path: string): RatchetFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: RatchetFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const DIRECTIONS: Direction[] = ['new', 'healed'];
export function checkFixture(fx: RatchetFixture, path: string): RatchetFixture {
  const bad = (what: string) => new SandboxError('ContractViolation', `fixture ${path}: ${what}`);
  const files = fx?.files;
  if (typeof fx?.fixture_id !== 'string' || !files || typeof files !== 'object' || !Object.values(files).every((v) => typeof v === 'string')) throw bad('needs fixture_id and files { path: text }');
  if (typeof fx.baseline_file !== 'string' || !(fx.baseline_file in files)) throw bad('needs baseline_file, one of its files');
  if (!Array.isArray(fx.plants)) throw bad('needs plants[]');
  const failureOk = (f: Failure) => CLASS_KEYS.includes(f?.class) && DIRECTIONS.includes(f.direction) && typeof f.entry === 'string';
  for (const p of fx.plants) {
    const ok = typeof p?.id === 'string' && typeof p.what === 'string' && CLASS_KEYS.includes(p.class) && DIRECTIONS.includes(p.direction)
      && Array.isArray(p.edits) && p.edits.length > 0 && p.edits.every((e) => e?.file in files && typeof e.find === 'string' && e.find !== '' && typeof e.replace === 'string')
      && Array.isArray(p.expect) && p.expect.length > 0 && p.expect.every(failureOk);
    if (!ok) throw bad(`plant ${p?.id ?? '?'} needs id, what, class, direction, edits[] (file in the checkout, find, replace) and expect[] (class, direction, entry)`);
    // A baseline edit would move the yardstick, not plant drift.
    if (p.edits.some((e) => e.file === fx.baseline_file)) throw bad(`plant ${p.id} edits the baseline; a plant changes the checkout`);
  }
  if (new Set(fx.plants.map((p) => p.id)).size !== fx.plants.length) throw bad('each plant id is listed once');
  for (const k of CLASS_KEYS) for (const d of DIRECTIONS) {
    if (!fx.plants.some((p) => p.class === k && p.direction === d)) throw bad(`no ${d} plant for ${k}; every class is planted in both directions`);
  }
  return fx;
}
