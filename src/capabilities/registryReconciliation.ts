// platform.registry_runtime_reconciliation, first release behaviour (R2):
// answers "which timers are untracked, which registry rows are phantom, and which schedules disagree" by
// measuring both lists from the platform's source at run time. Every count is one Ellis measured, with the
// measurement time and the commit it was measured at; the platform's frozen baseline is used only to say what
// is new and what has healed, and none of its sizes is reported as a count. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 4443087):
// - The platform's reconciler is five definitions over three inputs, reconcile(seedRows, registryRows,
//   registeredNames) (__tests__/fixtures/cronRegistryRatchet.ts:90-150). It runs in jest only: "Nothing in
//   production compares the two" (:8). Ellis applies the same definitions, formatted the same way, so each
//   entry can be compared with the baseline one for one.
// - The ratchet fails on an entry missing from the baseline and on a baseline entry no longer observed
//   (:153-160), so on a commit whose suite passes the baseline equals what the reconciler measures.
// - Its inputs leave out three things: the domain and governance rows (cronRegistryWorld.ts reads only
//   AGENT_REGISTRY's literal entries and the growth-journey entries), the row a registry runner actually records
//   under (it assumes the registry name), and cron.schedule calls that name no run at all.

import {
  seedRows, governanceRows, registryEntries, cronNameSites, resolveConstant, intelSlugs, scheduleSites,
  recordsUnder, uninstrumentedAgents, arrayAfter,
  type CodeRow, type RegistryEntry, type ScheduleSite, type Recording,
} from '../inventory/registrySource.ts';
import { scan } from '../inventory/sourceScan.ts';

export const CLASSES = {
  cronSeedRowsWithNoRegistration: { baseline: 'KNOWN_CRON_SEED_ROWS_WITH_NO_REGISTRATION', means: 'seed rows advertising cron with no timer registered under their own name (the platform calls these phantom)' },
  scheduledNamesWithNoSeedRow: { baseline: 'KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW', means: 'names a timer fires that have no seed row (the platform calls these untracked)' },
  scheduleDisagreements: { baseline: 'KNOWN_SCHEDULE_DISAGREEMENTS', means: 'registry schedule and seed schedule differ (name|registry|seed)' },
  registeredRowsDenyingSchedule: { baseline: 'KNOWN_REGISTERED_ROWS_DENYING_SCHEDULE', means: 'fired names whose seed row says not cron or no schedule (name|trigger|seed schedule|firing schedules)' },
  duplicateRegistryNames: { baseline: 'KNOWN_DUPLICATE_REGISTRY_NAMES', means: 'one name on several registry entries, pooling their counters (name|registries|schedules)' },
} as const;
export type ClassKey = keyof typeof CLASSES;
export const CLASS_KEYS = Object.keys(CLASSES) as ClassKey[];

export interface Measurement {
  measured_at: string;
  source_commit: string | null;
  files_read: number;
  // The seed set the platform's reconciler reads: AGENT_REGISTRY's literal entries and the growth-journey entries.
  platformSeedRows: CodeRow[];
  // Every row created in code: the seed (with releaseZero applied), growth-journey, domain and governance rows.
  codeRows: CodeRow[];
  registry: RegistryEntry[];
  registeredNames: string[];
  dynamicNameForms: string[];
  recordedUnder: Array<{ agentName: string; row: string | null; how: Recording; line: number }>;
  scheduleSites: ScheduleSite[];
  baseline: Record<ClassKey, string[]> | null;
}

export interface Reader { read(rel: string): string; list(dir: string): string[] }

const SRC = 'backend/src';
const S = `${SRC}/services`;
const SOURCE_FILE = /\.(ts|js)$/;
const skipped = (rel: string) => /(^|\/)(__tests__|node_modules)\//.test(rel) || /\.test\./.test(rel) || /-Ali-AI\.ts$/.test(rel);

// Reads everything the reconciliation needs from a platform checkout. Throws on a list or marker that has moved.
export function measure(r: Reader, now: Date, commit: string | null): Measurement {
  const scheduler = r.read(`${S}/aiOpsScheduler.ts`);
  const seed = r.read(`${S}/agentRegistrySeed.ts`);
  const growth = r.read(`${S}/agentRegistry/growthJourneyAgents.ts`);
  const domain = r.read(`${S}/agentRegistry/domainAgents.ts`);
  const governance = r.read(`${S}/governanceService.ts`);
  const files = r.list(SRC).filter((f) => SOURCE_FILE.test(f) && !skipped(f));
  const sources = files.map((f) => ({ file: f, text: r.read(f) }));

  const sites = sources.flatMap(({ file, text }) => {
    const s = scan(text);
    return { names: cronNameSites(file, text, s), schedules: scheduleSites(file, text, s) };
  });
  const names = sites.flatMap((x) => x.names);
  const slugs = names.some((n) => n.kind === 'prefix' && n.value === 'Intel_')
    ? intelSlugs(r.read(`${S}/intel/sources/index.ts`), (base) => r.read(`${S}/intel/sources/${base}.ts`)) : [];
  const registry = registryEntries(scheduler);
  const registered = new Set<string>(registry.map((e) => e.agentName));
  for (const n of names) {
    if (n.kind === 'exact') registered.add(n.value);
    else if (n.kind === 'constant') { const v = resolveConstant(n.value, sources); if (v) registered.add(v); }
    else if (n.kind === 'prefix' && n.value === 'Intel_') slugs.forEach((sl) => registered.add(`Intel_${sl}`));
  }
  const orchestrator = r.read(`${S}/aiOrchestrator.ts`);
  const uninstrumented = uninstrumentedAgents(scheduler);
  const literalSeed = seedRows(seed, 'const AGENT_REGISTRY', 'seed', false);
  const growthRows = seedRows(growth, 'export const GROWTH_JOURNEY_AGENT_ENTRIES', 'growth');
  return {
    measured_at: now.toISOString(), source_commit: commit, files_read: files.length,
    platformSeedRows: [...literalSeed, ...growthRows],
    codeRows: [...seedRows(seed, 'const AGENT_REGISTRY', 'seed'), ...growthRows, ...seedRows(domain, 'export const DOMAIN_AGENT_ENTRIES', 'domain'), ...governanceRows(governance)],
    registry,
    registeredNames: [...registered].sort(),
    dynamicNameForms: [...new Set(names.filter((n) => n.kind === 'dynamic' || (n.kind === 'prefix' && n.value !== 'Intel_')).map((n) => n.value))].sort(),
    recordedUnder: registry.filter((e) => e.registry === 'SCHEDULE_REGISTRY').map((e) => ({ agentName: e.agentName, ...recordsUnder(e, orchestrator, uninstrumented), line: e.line })),
    scheduleSites: sites.flatMap((x) => x.schedules),
    baseline: null,
  };
}

// The five frozen lists from cronRegistryBaseline.ts. A missing list is an error, never an empty one.
export function parseBaseline(text: string): Record<ClassKey, string[]> {
  const out = {} as Record<ClassKey, string[]>;
  for (const k of CLASS_KEYS) {
    const arr = arrayAfter(text, `export const ${CLASSES[k].baseline}`);
    out[k] = [...arr.matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
  }
  return out;
}

// The platform's five definitions (cronRegistryRatchet.ts:90-150), over any seed set.
export function reconcile(seed: CodeRow[], registry: RegistryEntry[], registeredNames: string[]): Record<ClassKey, string[]> {
  const registered = new Set(registeredNames);
  const byName = new Map(seed.map((r) => [r.agentName, r]));
  const firing = (name: string) => {
    const rows = registry.filter((e) => e.agentName === name);
    return rows.length ? rows.map((e) => e.schedule).sort().join(',') : 'instrumentCronJob';
  };
  const counts = new Map<string, number>();
  for (const e of registry) counts.set(e.agentName, (counts.get(e.agentName) ?? 0) + 1);
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  return {
    cronSeedRowsWithNoRegistration: uniq(seed.filter((r) => r.triggerType === 'cron' && !registered.has(r.agentName)).map((r) => r.agentName)),
    scheduledNamesWithNoSeedRow: uniq([...registered].filter((n) => !byName.has(n))),
    scheduleDisagreements: uniq(registry.flatMap((e) => {
      const s = byName.get(e.agentName);
      return s && s.schedule && e.schedule && s.schedule !== e.schedule ? [`${e.agentName}|${e.schedule}|${s.schedule}`] : [];
    })),
    registeredRowsDenyingSchedule: uniq([...registered].flatMap((n) => {
      const s = byName.get(n);
      return s && (s.triggerType !== 'cron' || s.schedule.trim() === '') ? [`${n}|${s.triggerType}|${s.schedule}|${firing(n)}`] : [];
    })),
    duplicateRegistryNames: uniq([...counts].filter(([, c]) => c > 1).map(([n]) => {
      const rows = registry.filter((e) => e.agentName === n);
      return `${n}|${[...new Set(rows.map((e) => e.registry))].sort().join('+')}|${rows.map((e) => e.schedule).sort().join(',')}`;
    })),
  };
}

export interface ClassResult { means: string; count: number; entries: string[]; new_since_baseline: string[] | null; healed_since_baseline: string[] | null }
export interface ReconAnswer {
  measured_at: string;
  source_commit: string | null;
  files_read: number;
  verdict: 'matches_baseline' | 'new_drift' | 'healed_entries' | 'no_baseline';
  classes: Record<ClassKey, ClassResult>;
  beyond_the_platform_reconciler: {
    // Rows the reconciler calls phantom that a registry entry under another name does write its runs to.
    phantom_rows_that_receive_runs: Array<{ row: string; registry_name: string; ref: string }>;
    // Names the reconciler calls untracked whose runs are recorded on an existing row under another name.
    untracked_names_that_record_on_a_row: Array<{ registry_name: string; row: string; ref: string }>;
    untracked_names_that_have_a_row: Array<{ name: string; row_source: string }>;
    runs_recorded_under_another_row: Array<{ registry_name: string; row: string; ref: string }>;
    registry_entries_recording_no_run: Array<{ registry_name: string; ref: string }>;
    registry_runners_not_read: Array<{ registry_name: string; ref: string }>;
    timers_with_no_name: Array<{ ref: string; schedule: string }>;
  };
  names_built_at_run_time: string[];
  cannot_say: string[];
  statement: string;
}

export function reconcileAnswer(m: Measurement): ReconAnswer {
  const observed = reconcile(m.platformSeedRows, m.registry, m.registeredNames);
  const classes = {} as Record<ClassKey, ClassResult>;
  let fresh = 0, healed = 0;
  for (const k of CLASS_KEYS) {
    const b = m.baseline?.[k] ?? null;
    const n = b ? observed[k].filter((e) => !b.includes(e)) : null;
    const h = b ? b.filter((e) => !observed[k].includes(e)).sort() : null;
    fresh += n?.length ?? 0; healed += h?.length ?? 0;
    classes[k] = { means: CLASSES[k].means, count: observed[k].length, entries: observed[k], new_since_baseline: n, healed_since_baseline: h };
  }
  const extraRows = new Map(m.codeRows.filter((r) => r.source === 'domain' || r.source === 'governance').map((r) => [r.agentName, r.source]));
  const ref = (line: number) => `backend/src/services/aiOpsScheduler.ts:${line}`;
  const other = m.recordedUnder.filter((x) => x.row && x.row !== x.agentName);
  const rowNames = new Set(m.codeRows.map((r) => r.agentName));
  const beyond = {
    phantom_rows_that_receive_runs: other.filter((x) => observed.cronSeedRowsWithNoRegistration.includes(x.row!)).map((x) => ({ row: x.row!, registry_name: x.agentName, ref: ref(x.line) })).sort((a, b) => (a.row < b.row ? -1 : 1)),
    untracked_names_that_record_on_a_row: other.filter((x) => observed.scheduledNamesWithNoSeedRow.includes(x.agentName) && rowNames.has(x.row!)).map((x) => ({ registry_name: x.agentName, row: x.row!, ref: ref(x.line) })).sort((a, b) => (a.registry_name < b.registry_name ? -1 : 1)),
    untracked_names_that_have_a_row: observed.scheduledNamesWithNoSeedRow.filter((n) => extraRows.has(n)).map((n) => ({ name: n, row_source: extraRows.get(n)! })),
    runs_recorded_under_another_row: other.map((x) => ({ registry_name: x.agentName, row: x.row!, ref: ref(x.line) })),
    registry_entries_recording_no_run: m.recordedUnder.filter((x) => x.how === 'director_gate').map((x) => ({ registry_name: x.agentName, ref: ref(x.line) })),
    registry_runners_not_read: m.recordedUnder.filter((x) => x.how === 'unknown').map((x) => ({ registry_name: x.agentName, ref: ref(x.line) })),
    timers_with_no_name: m.scheduleSites.filter((s) => !s.named).map((s) => ({ ref: `${s.file}:${s.line}`, schedule: s.schedule })),
  };
  const verdict = !m.baseline ? 'no_baseline' : fresh ? 'new_drift' : healed ? 'healed_entries' : 'matches_baseline';
  const c = (k: ClassKey) => classes[k].count;
  const statement = `Measured ${m.measured_at}${m.source_commit ? ` at platform commit ${m.source_commit}` : ''}: `
    + `the platform's five definitions give ${c('cronSeedRowsWithNoRegistration')} seed rows advertising cron with no timer registered under their own name, `
    + `${c('scheduledNamesWithNoSeedRow')} fired names with no seed row, ${c('scheduleDisagreements')} schedule disagreements, ${c('registeredRowsDenyingSchedule')} fired name(s) whose row denies a schedule, `
    + `and ${c('duplicateRegistryNames')} name(s) pooling several registry entries. `
    + (m.baseline ? `Against the platform's accepted list: ${fresh} new, ${healed} healed. A match means nothing new, not that the drift is gone. ` : 'No baseline was read, so nothing is said about what is new. ')
    + `Beyond the platform's reconciler: ${beyond.phantom_rows_that_receive_runs.length} of the phantom rows do receive runs from a timer under another name, and ${beyond.untracked_names_that_record_on_a_row.length} of the untracked names record their runs on such a row, because runAgent looks up and writes to the row its runner names (aiOrchestrator.ts:184); `
    + `${beyond.registry_entries_recording_no_run.length} registry entries record no run at all, and ${beyond.timers_with_no_name.length} timers fire with no name, no row and no run record.`;
  return {
    measured_at: m.measured_at, source_commit: m.source_commit, files_read: m.files_read, verdict, classes,
    beyond_the_platform_reconciler: beyond,
    names_built_at_run_time: m.dynamicNameForms,
    cannot_say: [
      'what fires in production: a cron_schedule_configs row replaces the registry schedule or switches an entry off at start-up and on reload (aiOpsScheduler.ts:748-750, :767-769, :652), and only a live export of that table shows it',
      'rows created at run time by agentFactory, and rows a production database holds from earlier seeds',
      'whether an environment-gated timer is running (for example the community-rooms timers in server.ts run only when that flag is on)',
      'what a timer with no name records: Ellis read its callback, not every function the callback calls',
    ],
    statement,
  };
}
