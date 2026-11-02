// platform.default_on_timer_guard, first release behaviour (R2):
// names every scheduler registry name with no governing cron_schedule_configs row and says each is on by
// default, citing the code locations where that default is applied. It also reads what a failed row read does
// at boot and at reload. Switching the default, and ruling which names should run, stays K.D.'s decision and a
// reviewed deploy at every autonomy level. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - Without a row a registry timer is on: enabled = dbEntry?.enabled ?? true, at boot for each registry
//   (services/aiOpsScheduler.ts:750, :769) and at reload for both (:649).
// - The boot path catches a failed read and goes on with an empty map (:734-741), so every timer starts.
// - The reload path has no catch of its own and its comment says a failed read changes nothing (:611-614),
//   but resolveAllCronSchedules catches the failure itself and returns an empty map
//   (services/governanceResolutionService.ts:198-216). Read from source; not exercised.
// - The model defaults enabled to true (models/CronScheduleConfig.ts:46-50), and the only code that creates rows
//   is the seed (seeds/seedGovernanceConfig.ts:114), each enabled. The governance PATCH never creates one.

import { scan, lineOf, balanced } from '../inventory/sourceScan.ts';
import { registryEntries, arrayAfter, topObjects, ownString, type RegistryName } from '../inventory/registrySource.ts';
import type { Reader } from './registryReconciliation.ts';

export const FILES = {
  scheduler: 'backend/src/services/aiOpsScheduler.ts',
  resolver: 'backend/src/services/governanceResolutionService.ts',
  model: 'backend/src/models/CronScheduleConfig.ts',
  seed: 'backend/src/seeds/seedGovernanceConfig.ts',
} as const;
const BOOT = 'startAIOpsScheduler';
const RELOAD = 'reloadAIOpsSchedules';
const RESOLVE = 'resolveAllCronSchedules';

export interface RowRecord { agent_name: string; enabled: boolean }
export interface Rows { from: 'records' | 'seed'; captured_at: string | null; rows: RowRecord[] }
export interface DefaultSite { file: string; line: number; path: 'boot' | 'reload' | 'other'; covers: RegistryName | 'both registries' | 'unknown' }
export interface ReadPath { file: string; line: number | null; fails_open: boolean | null; why: string }
export interface Ungoverned { name: string; registries: RegistryName[]; at: string[]; hardcoded_schedules: string[]; enabled_by_default: true }
export interface GuardAnswer {
  source_commit: string | null;
  rows_from: Rows['from'];
  rows_captured_at: string | null;
  registry: { entries: number; names: number };
  ungoverned: Ungoverned[];
  governed: { names: number; disabled: string[] };
  rows_without_registry_entry: string[];
  default_sites: DefaultSite[];
  sites_as_expected: boolean;
  model_default: { file: string; line: number } | null;
  read_failure: { resolver: ReadPath; boot: ReadPath; reload: ReadPath };
  blind_spots: string[];
  statement: string;
  decision: string;
}

const DECISION = 'K.D. rules on each name: run it or not. Switching the default is a reviewed deploy a person performs. Ellis reports only.';

// The body of `function name(`, with its offset in code. Null when the function is not there.
function body(code: string, name: string): { text: string; at: number } | null {
  const at = code.search(new RegExp(`function ${name}\\(`));
  if (at < 0) return null;
  const open = code.indexOf('{', code.indexOf(')', at));
  const text = open < 0 ? null : balanced(code, open);
  return text ? { text, at: open } : null;
}

// Every `enabled = x?.enabled ?? true` in the scheduler, placed in its function and the loop around it.
export function defaultSites(schedulerText: string): DefaultSite[] {
  const code = scan(schedulerText).code;
  const out: DefaultSite[] = [];
  for (const m of code.matchAll(/\benabled\s*=\s*[A-Za-z_$][\w$]*\?\.enabled\s*\?\?\s*true\b/g)) {
    const before = code.slice(0, m.index);
    const fn = [...before.matchAll(/function (\w+)\(/g)].at(-1)?.[1];
    const loop = [...before.matchAll(/for \(const (?:\w+|\[[^\]]*\]|\{[^}]*\}) of (?:\[\.\.\.)?(\w+)/g)].at(-1)?.[1];
    const path = fn === BOOT ? 'boot' : fn === RELOAD ? 'reload' : 'other';
    const covers = loop === 'SCHEDULE_REGISTRY' || loop === 'DYNAMIC_SCHEDULE_REGISTRY' ? loop : loop === 'byAgent' ? 'both registries' : 'unknown';
    out.push({ file: FILES.scheduler, line: lineOf(schedulerText, m.index), path, covers });
  }
  return out;
}

// The shape the R2 story describes: one site per registry at boot, one covering both at reload.
export function sitesAsExpected(sites: DefaultSite[]): boolean {
  const has = (p: DefaultSite['path'], c: DefaultSite['covers']) => sites.filter((s) => s.path === p && s.covers === c).length === 1;
  return sites.length === 3 && has('boot', 'SCHEDULE_REGISTRY') && has('boot', 'DYNAMIC_SCHEDULE_REGISTRY') && has('reload', 'both registries');
}

// The catch block after the try that holds `at`, or null when `at` is in no try.
function catchAround(code: string, at: number, within: { text: string; at: number }): { line: number; rethrows: boolean } | null {
  const local = at - within.at;
  for (const t of [...within.text.slice(0, local).matchAll(/\btry\s*\{/g)].reverse()) {
    const open = within.at + t.index + t[0].length - 1;
    const block = balanced(code, open);
    if (!block || open + block.length < at) continue;
    const c = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(code.slice(open + block.length));
    if (!c) return null;
    const cOpen = open + block.length + c[0].length - 1;
    const handler = balanced(code, cOpen) ?? '';
    return { line: lineOf(code, open + block.length + c[0].indexOf('catch')), rethrows: /\bthrow\b/.test(handler) };
  }
  return null;
}

export function readFailure(schedulerText: string, resolverText: string): GuardAnswer['read_failure'] {
  const rc = scan(resolverText).code;
  const rb = body(rc, RESOLVE);
  const rCall = rb ? rb.text.indexOf('findAll(') : -1;
  const rCatch = rb && rCall >= 0 ? catchAround(rc, rb.at + rCall, rb) : null;
  const swallows = rb ? !!rCatch && !rCatch.rethrows : null;
  const resolver: ReadPath = {
    file: FILES.resolver, line: rCatch?.line ?? (rb ? lineOf(rc, rb.at) : null), fails_open: swallows,
    why: swallows === null ? `${RESOLVE} not found; the platform source has changed shape`
      : swallows ? `${RESOLVE} catches a failed read itself and returns an empty map, so no caller sees the failure`
      : `${RESOLVE} lets a failed read reach its caller`,
  };
  const sc = scan(schedulerText).code;
  const path = (fn: string, label: string): ReadPath => {
    const b = body(sc, fn);
    const call = b ? b.text.indexOf(`${RESOLVE}(`) : -1;
    if (!b || call < 0) return { file: FILES.scheduler, line: null, fails_open: null, why: `${fn} does not call ${RESOLVE}; the platform source has changed shape` };
    const own = catchAround(sc, b.at + call, b);
    const line = lineOf(schedulerText, b.at + call);
    if (swallows) return { file: FILES.scheduler, line, fails_open: true, why: `the ${label} gets an empty map on a failed read, because ${RESOLVE} swallows it, and every timer resolves to hardcoded and enabled${own ? '' : '; its own code has no catch, so it cannot tell a failed read from no rows'}` };
    if (own && !own.rethrows) return { file: FILES.scheduler, line: own.line, fails_open: true, why: `the ${label} catches a failed read and goes on with an empty map, so every timer resolves to hardcoded and enabled` };
    if (swallows === null) return { file: FILES.scheduler, line, fails_open: null, why: `cannot say: ${RESOLVE} could not be read` };
    return { file: FILES.scheduler, line, fails_open: false, why: `a failed read stops the ${label}; nothing starts on an empty map` };
  };
  return { resolver, boot: path(BOOT, 'boot path'), reload: path(RELOAD, 'reload path') };
}

export function modelDefault(modelText: string): GuardAnswer['model_default'] {
  const code = scan(modelText).code;
  const m = /\benabled\s*:\s*\{[^}]*defaultValue\s*:\s*true\b/.exec(code);
  return m ? { file: FILES.model, line: lineOf(modelText, m.index) } : null;
}

// The rows the platform's seed creates, each enabled when the seed says so.
export function seededRows(seedText: string): RowRecord[] {
  const code = scan(seedText).code;
  const enabled = /findOrCreate\([\s\S]*?\benabled\s*:\s*true\b/.test(code);
  return topObjects(arrayAfter(seedText, 'const CRON_SCHEDULES')).flatMap(({ text: o }) => {
    const name = ownString(o, 'agent_name');
    return name ? [{ agent_name: name, enabled }] : [];
  });
}

export function guard(r: Reader, commit: string | null, given: Rows | null): GuardAnswer {
  const schedulerText = r.read(FILES.scheduler);
  const entries = registryEntries(schedulerText);
  const rows = given ?? { from: 'seed' as const, captured_at: null, rows: seededRows(r.read(FILES.seed)) };
  const byName = new Map(rows.rows.map((x) => [x.agent_name, x]));
  const names = [...new Set(entries.map((e) => e.agentName))].sort();
  const ungoverned = names.filter((n) => !byName.has(n)).map((name): Ungoverned => {
    const mine = entries.filter((e) => e.agentName === name);
    return {
      name, registries: [...new Set(mine.map((e) => e.registry))], at: mine.map((e) => `${FILES.scheduler}:${e.line}`),
      hardcoded_schedules: mine.map((e) => e.schedule), enabled_by_default: true,
    };
  });
  const governedNames = names.filter((n) => byName.has(n));
  const sites = defaultSites(schedulerText);
  const expected = sitesAsExpected(sites);
  const rf = readFailure(schedulerText, r.read(FILES.resolver));
  const blind: string[] = [];
  if (rows.from === 'seed') blind.push(`rows are the ones the platform's seed creates (${FILES.seed}), not production rows: production may hold rows made by hand, or lack seeded ones if the seed never ran. The list becomes a production measurement only when run on an export of cron_schedule_configs.`);
  if (!expected) blind.push(`the default sites do not have the expected shape (one per registry at boot, one at reload); found ${sites.length}. Read each one before relying on this answer.`);
  blind.push('timers registered inline (schedulerService.ts and elsewhere) never read cron_schedule_configs, so they are on by code and outside this list.');
  blind.push('read failure is read from source, not exercised.');
  const where = sites.map((s) => `${s.file}:${s.line}`).join(', ');
  const statement = `${ungoverned.length} of ${names.length} registry names have no governing cron_schedule_configs row (measured against ${rows.from === 'records' ? `exported rows captured ${rows.captured_at}` : 'the rows the seed creates'}); each is on by default at ${where || 'no site found'}.`;
  return {
    source_commit: commit, rows_from: rows.from, rows_captured_at: rows.captured_at,
    registry: { entries: entries.length, names: names.length },
    ungoverned,
    governed: { names: governedNames.length, disabled: governedNames.filter((n) => byName.get(n)!.enabled === false) },
    rows_without_registry_entry: [...byName.keys()].filter((n) => !names.includes(n)).sort(),
    default_sites: sites, sites_as_expected: expected, model_default: modelDefault(r.read(FILES.model)),
    read_failure: rf, blind_spots: blind, statement, decision: DECISION,
  };
}
