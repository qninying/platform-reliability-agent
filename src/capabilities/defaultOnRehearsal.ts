// platform.default_on_timer_guard, rung R4: builds the guard and verifies it against a sandbox scheduler. The
// guard starts a timer only when a cron_schedule_configs row says it is enabled, and when the table cannot be read
// it refuses to start at boot and changes nothing at reload. The platform's code runs on the same fixture as the
// control, and fails the unreadable case by starting everything. Sandbox only: nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit 425e31c9b):
// - Without a row a registry timer is on: enabled = dbEntry?.enabled ?? true, at boot for each registry
//   (backend/src/services/aiOpsScheduler.ts:763, :782) and at reload for both (:662).
// - resolveAllCronSchedules catches a failed read and returns an empty map
//   (backend/src/services/governanceResolutionService.ts:218), and caches it for 30 seconds (:99, :222). Boot has
//   its own catch too (aiOpsScheduler.ts:752). Either way every timer resolves to hardcoded and enabled.
// - The reload path's comment says a failed read changes nothing (aiOpsScheduler.ts:624-626), but it gets the
//   same empty map (:627), so it re-enables jobs an operator switched off.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = '425e31c9b';
export const LIMITS: readonly string[] = [
  'The table read fails as a whole. A read that times out, or returns some rows and then fails, is not run.',
  'Refusing to start stops every registry timer, including ones that would have run. Whether the scheduler retries the read, and for how long, is not built here.',
  'Names are the fixture\'s, not production\'s. K.D. has not ruled on which ungoverned production names should run, and until then the guard cannot be switched on without stopping real work.',
  'Applying the guard to the platform is a reviewed deploy by a person.',
];

export interface RegistryEntry { name: string; schedule: string }
export interface RowRecord { agent_name: string; enabled: boolean }
export interface DefaultOnFixture { fixture_id: string; description: string; registry: RegistryEntry[]; rows: RowRecord[] }

export type Policy = 'guard' | 'platform';
export type Outcome = 'started' | 'started_none' | 'refused' | 'kept';
export interface Pass { outcome: Outcome; running: string[]; reason: string | null }

// The table either returns its rows or throws, as a database read does.
const reader = (rows: RowRecord[], readable: boolean) => (): RowRecord[] => {
  if (!readable) throw new SandboxError('SourceUnavailable', 'cron_schedule_configs could not be read');
  return rows.map((r) => ({ ...r }));
};

// The platform swallows a failed read and goes on with no rows; the guard lets the failure through.
function resolve(read: () => RowRecord[], policy: Policy): Map<string, RowRecord> {
  if (policy === 'guard') return new Map(read().map((r) => [r.agent_name, r]));
  try {
    return new Map(read().map((r) => [r.agent_name, r]));
  } catch {
    return new Map();
  }
}

const names = (fx: DefaultOnFixture): string[] => [...new Set(fx.registry.map((e) => e.name))].sort();
const wanted = (fx: DefaultOnFixture, rows: Map<string, RowRecord>, policy: Policy): string[] =>
  names(fx).filter((n) => (policy === 'guard' ? rows.get(n)?.enabled === true : rows.get(n)?.enabled ?? true));

export function boot(fx: DefaultOnFixture, read: () => RowRecord[], policy: Policy): Pass {
  let rows: Map<string, RowRecord>;
  try {
    rows = resolve(read, policy);
  } catch (err) {
    return { outcome: 'refused', running: [], reason: `${(err as SandboxError).errorClass}: ${(err as Error).message}; the scheduler starts nothing` };
  }
  const running = wanted(fx, rows, policy);
  return running.length
    ? { outcome: 'started', running, reason: null }
    : { outcome: 'started_none', running, reason: rows.size ? 'no row enables a registry timer' : 'the table was read and holds no rows' };
}

export function reload(fx: DefaultOnFixture, before: string[], read: () => RowRecord[], policy: Policy): Pass {
  let rows: Map<string, RowRecord>;
  try {
    rows = resolve(read, policy);
  } catch (err) {
    return { outcome: 'kept', running: [...before], reason: `${(err as SandboxError).errorClass}: ${(err as Error).message}; nothing changed` };
  }
  const running = wanted(fx, rows, policy);
  return { outcome: running.length ? 'started' : 'started_none', running, reason: null };
}

export interface NameRow { name: string; row: 'enabled' | 'disabled' | 'none'; guard: boolean; platform: boolean }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  names: NameRow[];
  ungoverned: string[];
  rows_without_registry_entry: string[];
  passes: Record<'boot' | 'boot_unreadable' | 'boot_empty' | 'reload_unreadable', { guard: Pass; platform: Pass }>;
  checks: {
    no_row_does_not_start: boolean;
    only_enabled_rows_start: boolean;
    unreadable_refuses_to_start: boolean;
    positive_control_starts_everything: boolean;
    empty_is_not_unreadable: boolean;
    reload_unreadable_changes_nothing: boolean;
  };
  verified: boolean;
  statement: string;
  limits: string[];
}

// The guard is the subject and the platform's code the control. Swapping them shows each check can fail.
export function rehearse(fx: DefaultOnFixture, roles: { subject: Policy; control: Policy } = { subject: 'guard', control: 'platform' }): Rehearsal {
  const all = names(fx);
  const byName = new Map(fx.rows.map((r) => [r.agent_name, r]));
  const ungoverned = all.filter((n) => !byName.has(n));
  const enabled = all.filter((n) => byName.get(n)?.enabled === true);
  const ok = reader(fx.rows, true), broken = reader(fx.rows, false), empty = reader([], true);
  const both = (f: (p: Policy) => Pass) => ({ guard: f(roles.subject), platform: f(roles.control) });
  const booted = both((p) => boot(fx, ok, p));
  const passes = {
    boot: booted,
    boot_unreadable: both((p) => boot(fx, broken, p)),
    boot_empty: both((p) => boot(fx, empty, p)),
    reload_unreadable: { guard: reload(fx, booted.guard.running, broken, roles.subject), platform: reload(fx, booted.platform.running, broken, roles.control) },
  };
  const g = (k: keyof typeof passes) => passes[k].guard;
  const same = (a: string[], b: string[]) => a.join('\n') === b.join('\n');
  // A refusal starts nothing and a kept reload keeps what ran, by construction, so the outcome is the check.
  const checks = {
    // The fixture must hold a name with no row, or the case is not exercised.
    no_row_does_not_start: ungoverned.length > 0 && ungoverned.every((n) => !g('boot').running.includes(n)),
    only_enabled_rows_start: same(g('boot').running, enabled),
    unreadable_refuses_to_start: g('boot_unreadable').outcome === 'refused',
    // The acceptance names this the positive control: the platform's boot path, on the same unreadable table,
    // starts every registry timer. If it does not, the injected failure never reached the read.
    positive_control_starts_everything: same(passes.boot_unreadable.platform.running, all),
    empty_is_not_unreadable: g('boot_empty').outcome === 'started_none',
    // Something must be running at boot, or keeping it shows nothing.
    reload_unreadable_changes_nothing: g('boot').running.length > 0 && g('reload_unreadable').outcome === 'kept',
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const reenabled = passes.reload_unreadable.platform.running.filter((n) => byName.get(n)?.enabled === false);
  const rowsElsewhere = [...byName.keys()].filter((n) => !all.includes(n)).sort();
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT,
    names: all.map((n) => ({ name: n, row: byName.has(n) ? (byName.get(n)!.enabled ? 'enabled' : 'disabled') : 'none', guard: g('boot').running.includes(n), platform: booted.platform.running.includes(n) })),
    ungoverned, rows_without_registry_entry: rowsElsewhere, passes, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: of ${all.length} registry names the guard started the ${enabled.length} with an enabled row, and none of the ${ungoverned.length} with no row. With the table unreadable it refused to start at boot, and changed nothing at reload; an empty table started nothing without being taken for a failure. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` The platform's code on the same fixture started ${booted.platform.running.length} of ${all.length} with the table readable and ${passes.boot_unreadable.platform.running.length} with it unreadable${reenabled.length ? `, and its reload re-enabled ${reenabled.join(', ')}, which a row had switched off` : ''}.`,
    limits: [...LIMITS],
  };
}

export function loadDefaultOnFixture(path: string): DefaultOnFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: DefaultOnFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

export function checkFixture(fx: DefaultOnFixture, path: string): DefaultOnFixture {
  if (typeof fx.fixture_id !== 'string' || !Array.isArray(fx.registry) || fx.registry.length === 0 || !Array.isArray(fx.rows)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, a non-empty registry[] and rows[]`);
  }
  if (!fx.registry.every((e) => typeof e?.name === 'string' && typeof e.schedule === 'string')) throw new SandboxError('ContractViolation', `fixture ${path}: each registry entry needs a name and a schedule`);
  if (!fx.rows.every((r) => typeof r?.agent_name === 'string' && typeof r.enabled === 'boolean')) throw new SandboxError('ContractViolation', `fixture ${path}: each row needs agent_name and a boolean enabled`);
  return fx;
}
