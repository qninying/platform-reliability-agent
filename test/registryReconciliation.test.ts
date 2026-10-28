import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { measure, parseBaseline, reconcileAnswer, reconcile, CLASS_KEYS, type Reader, type Measurement } from '../src/capabilities/registryReconciliation.ts';
import { scan, inString } from '../src/inventory/sourceScan.ts';
import { cronNameSites, scheduleSites, seedRows, ownString, type CodeRow, type RegistryEntry } from '../src/inventory/registrySource.ts';

// A small platform checkout shaped like the real one at 4443087. Names and counts are test inputs.
const S = 'backend/src/services';
const FILES: Record<string, string> = {
  [`${S}/aiOpsScheduler.ts`]: `
const UNINSTRUMENTED_AGENTS = new Set([
  'Uninst', // goes through instrumentCronJob
]);
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'Same', hardcodedSchedule: '*/5 * * * *', runner: runSame, label: 'Same' },
  { agentName: 'Drift', hardcodedSchedule: '*/10 * * * *', runner: runDrift, label: 'Drift' },
  { agentName: 'Disagree', hardcodedSchedule: '0 * * * *', runner: runDisagree, label: 'Disagree' },
  { agentName: 'Tracked', hardcodedSchedule: '0 6 * * *', runner: () => trackAgentRun('Tracked', async () => { await go(); }), label: 'Tracked' },
  { agentName: 'Director', hardcodedSchedule: '0 9 * * 1', runner: async () => { const m = await import('./workforce/directorActions'); return m.runX(); }, label: 'Director' },
  { agentName: 'Dup', hardcodedSchedule: '0 1 * * *', runner: runDup, label: 'Dup one' },
  { agentName: 'Dup', hardcodedSchedule: '0 2 * * *', runner: runDup, label: 'Dup two' },
  { agentName: 'Uninst', hardcodedSchedule: '0 3 * * *', runner: runUninst, label: 'Uninst' },
  { agentName: 'Mystery', hardcodedSchedule: '0 4 * * *', runner: runMystery, label: 'Mystery' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  { agentName: 'Briefing', hardcodedSchedule: '45 6 * * *', dynamicImport: async () => { await brief(); }, label: 'Briefing' },
];
function startStandardTask(entry, schedule) {
  const task = cron.schedule(schedule, () => { wrapWithDeadLetter(entry.agentName, entry.label, () => entry.runner()); });
}
function startDynamicTask(entry, schedule) {
  const task = cron.schedule(schedule, () => { instrumentCronJob(entry.agentName, entry.dynamicImport); });
}
cron.schedule('* * * * *', async () => { await evaluateAndRespond(); });
`,
  [`${S}/aiOrchestrator.ts`]: `
async function runAgent(agentName, executor) { const agent = await AiAgent.findOne({ where: { agent_name: agentName } }); }
export async function runSame(): Promise<X> {
  return runAgent('Same', exec);
}
export async function runDrift(): Promise<X> {
  return runAgent('DriftAgent', exec);
}
export async function runDisagree(): Promise<X> {
  return runAgent('Disagree', exec);
}
export async function runDup(): Promise<X> {
  return runAgent('Dup', exec);
}
export async function runMystery(): Promise<X> {
  return somethingElse();
}
`,
  [`${S}/agentRegistrySeed.ts`]: `
const AGENT_REGISTRY: AgentSeedEntry[] = [
  {
    agent_name: 'Same',
    trigger_type: 'cron',
    schedule: '*/5 * * * *',
  },
  {
    agent_name: 'DriftAgent',
    trigger_type: 'cron',
    schedule: '*/10 * * * *',
  },
  {
    agent_name: 'Phantom',
    trigger_type: 'cron',
    schedule: '0 0 * * *',
  },
  {
    agent_name: 'Disagree',
    trigger_type: 'cron',
    schedule: '30 * * * *',
  },
  {
    agent_name: 'Denier',
    trigger_type: 'event_driven',
    schedule: '',
    config: { agent_name: 'NestedNotARow', trigger_type: 'cron' },
  },
  {
    agent_name: 'Dup',
    trigger_type: 'cron',
    schedule: '0 1 * * *',
  },
  ...GROWTH_JOURNEY_AGENT_ENTRIES,
  ...DOMAIN_AGENT_ENTRIES,
];
`,
  [`${S}/agentRegistry/growthJourneyAgents.ts`]: `
export const GROWTH_JOURNEY_AGENT_ENTRIES: AgentSeedEntry[] = [
  {
    agent_name: 'GrowthDigest',
    trigger_type: 'cron',
    schedule: '20 4 * * *',
  },
];
`,
  [`${S}/agentRegistry/domainAgents.ts`]: `
export const DOMAIN_AGENT_ENTRIES: AgentSeedEntry[] = [
  {
    ...releaseZero(),
    agent_name: 'DomainScheduled',
  },
];
`,
  [`${S}/governanceService.ts`]: `
const GOVERNANCE_AGENTS = [
  { agent_name: 'visitor_tracker', agent_type: 'signal_detector' },
];
`,
  [`${S}/schedulerService.ts`]: `
const HANDOFF = 'GrowthDigest';
cron.schedule('0 7 * * *', () => {
  instrumentCronJob('Denier', async () => { await deny(); });
});
cron.schedule('20 4 * * *', () => { instrumentCronJob(HANDOFF, run); });
cron.schedule('0 8 * * *', () => { instrumentCronJob('DomainScheduled', run); });
// instrumentCronJob('InComment', fn);
const doc = "instrumentCronJob('InString', fn)";
const fix = text.replace(/'/g, "''"); instrumentCronJob('AfterRegex', fn);
for (const src of listIntelSources()) cron.schedule(src.cron, () => { instrumentCronJob(\`Intel_\${src.slug}\`, () => src.run()); });
cron.schedule('10,25,40,55 * * * *', () => { checkCronHealth(); });
`,
  [`${S}/intel/sources/index.ts`]: `import './alpha';\nimport './helper';\n`,
  [`${S}/intel/sources/alpha.ts`]: `const SLUG = 'alpha';\nregisterIntelSource({ slug: SLUG });\n`,
  [`${S}/intel/sources/helper.ts`]: `export const x = 1;\n`,
  [`backend/src/server.ts`]: `cron.schedule('*/2 * * * *', () => { import('./ops').then((m) => m.sync()); });\n`,
  [`${S}/__tests__/fixtures/cronRegistryBaseline.ts`]: `
export const KNOWN_CRON_SEED_ROWS_WITH_NO_REGISTRATION: ReadonlyArray<string> = [
  'DriftAgent', // drift
  'Phantom',
];
export const KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW: ReadonlyArray<string> = [
  'AfterRegex', 'Briefing', 'Director', 'DomainScheduled', 'Drift', 'Intel_alpha', 'Mystery', 'Tracked', 'Uninst',
];
export const KNOWN_SCHEDULE_DISAGREEMENTS: ReadonlyArray<string> = [
  'Disagree|0 * * * *|30 * * * *',
  'Dup|0 2 * * *|0 1 * * *',
];
export const KNOWN_REGISTERED_ROWS_DENYING_SCHEDULE: ReadonlyArray<string> = [
  'Denier|event_driven||instrumentCronJob',
];
export const KNOWN_DUPLICATE_REGISTRY_NAMES: ReadonlyArray<string> = [
  'Dup|SCHEDULE_REGISTRY|0 1 * * *,0 2 * * *',
];
`,
  [`${S}/__tests__/other.test.ts`]: `instrumentCronJob('OnlyInATest', fn);\n`,
  [`${S}/oldCopy-Ali-AI.ts`]: `instrumentCronJob('OnlyInAnAliCopy', fn);\n`,
  [`${S}/beside.test.ts`]: `instrumentCronJob('OnlyInATestBesideCode', fn);\n`,
};

const memReader = (files: Record<string, string>): Reader => ({
  read(rel) { if (!(rel in files)) throw new Error(`missing ${rel}`); return files[rel]; },
  list(dir) { return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const NOW = new Date('2026-10-27T23:00:00Z');
const measured = (files = FILES, withBaseline = true): Measurement => {
  const m = measure(memReader(files), NOW, 'abc123def');
  if (withBaseline) m.baseline = parseBaseline(files[`${S}/__tests__/fixtures/cronRegistryBaseline.ts`]);
  return m;
};

test('acceptance: every count is the measured number of entries, stamped with when and at which commit it was measured', () => {
  const a = reconcileAnswer(measured());
  assert.equal(a.measured_at, '2026-10-27T23:00:00.000Z');
  assert.equal(a.source_commit, 'abc123def');
  for (const k of CLASS_KEYS) assert.equal(a.classes[k].count, a.classes[k].entries.length, k);
  assert.match(a.statement, /^Measured 2026-10-27T23:00:00\.000Z at platform commit abc123def: /);
});

test('acceptance: no count is restated from the baseline document; changing or removing the baseline changes no count', () => {
  const base = reconcileAnswer(measured());
  const counts = (a: typeof base) => CLASS_KEYS.map((k) => a.classes[k].count);
  const padded = { ...FILES, [`${S}/__tests__/fixtures/cronRegistryBaseline.ts`]: FILES[`${S}/__tests__/fixtures/cronRegistryBaseline.ts`].replace("'Phantom',", "'Phantom', 'Extra1', 'Extra2', 'Extra3',") };
  const withPadded = reconcileAnswer(measured(padded));
  assert.deepEqual(counts(withPadded), counts(base));
  assert.deepEqual(withPadded.classes.cronSeedRowsWithNoRegistration.healed_since_baseline, ['Extra1', 'Extra2', 'Extra3']);
  const without = reconcileAnswer(measured(FILES, false));
  assert.deepEqual(counts(without), counts(base));
  assert.equal(without.verdict, 'no_baseline');
  assert.equal(without.classes.cronSeedRowsWithNoRegistration.new_since_baseline, null);
});

test('the five classes follow the platform definitions and formats', () => {
  const a = reconcileAnswer(measured());
  assert.deepEqual(a.classes.cronSeedRowsWithNoRegistration.entries, ['DriftAgent', 'Phantom']);
  assert.deepEqual(a.classes.scheduledNamesWithNoSeedRow.entries, ['AfterRegex', 'Briefing', 'Director', 'DomainScheduled', 'Drift', 'Intel_alpha', 'Mystery', 'Tracked', 'Uninst']);
  assert.deepEqual(a.classes.scheduleDisagreements.entries, ['Disagree|0 * * * *|30 * * * *', 'Dup|0 2 * * *|0 1 * * *']);
  assert.deepEqual(a.classes.registeredRowsDenyingSchedule.entries, ['Denier|event_driven||instrumentCronJob']);
  assert.deepEqual(a.classes.duplicateRegistryNames.entries, ['Dup|SCHEDULE_REGISTRY|0 1 * * *,0 2 * * *']);
  assert.equal(a.verdict, 'matches_baseline');
});

test('names in comments, strings, test files and -Ali-AI copies are not registrations; a quote inside a regex does not hide the next call', () => {
  const m = measured();
  for (const n of ['InComment', 'InString', 'OnlyInATest', 'OnlyInATestBesideCode', 'OnlyInAnAliCopy', 'NestedNotARow']) assert.equal(m.registeredNames.includes(n) || m.codeRows.some((r) => r.agentName === n), false, n);
  assert.ok(m.registeredNames.includes('AfterRegex'));
  assert.ok(m.registeredNames.includes('GrowthDigest'), 'a name passed as a constant is resolved');
  assert.ok(m.registeredNames.includes('Intel_alpha'), 'intel names are expanded through the sources the barrel registers');
});

test('the baseline comparison reports new drift and healed entries in both directions', () => {
  const drifted = { ...FILES, [`${S}/agentRegistrySeed.ts`]: FILES[`${S}/agentRegistrySeed.ts`].replace("agent_name: 'Phantom',", "agent_name: 'Phantom',\n    trigger_type: 'cron',\n  },\n  {\n    agent_name: 'NewPhantom',") };
  const a = reconcileAnswer(measured(drifted));
  assert.deepEqual(a.classes.cronSeedRowsWithNoRegistration.new_since_baseline, ['NewPhantom']);
  assert.equal(a.verdict, 'new_drift');
  const healed = { ...FILES, [`${S}/agentRegistrySeed.ts`]: FILES[`${S}/agentRegistrySeed.ts`].replace("schedule: '30 * * * *'", "schedule: '0 * * * *'") };
  const h = reconcileAnswer(measured(healed));
  assert.deepEqual(h.classes.scheduleDisagreements.healed_since_baseline, ['Disagree|0 * * * *|30 * * * *']);
  assert.equal(h.verdict, 'healed_entries');
});

test('beyond the platform reconciler: a phantom row that receives runs, an untracked name that records on a row, a domain row, no-run entries and nameless timers', () => {
  const b = reconcileAnswer(measured()).beyond_the_platform_reconciler;
  assert.deepEqual(b.phantom_rows_that_receive_runs.map((x) => `${x.row}<-${x.registry_name}`), ['DriftAgent<-Drift']);
  assert.deepEqual(b.untracked_names_that_record_on_a_row.map((x) => `${x.registry_name}->${x.row}`), ['Drift->DriftAgent']);
  assert.deepEqual(b.runs_recorded_under_another_row.map((x) => x.registry_name), ['Drift']);
  assert.deepEqual(b.untracked_names_that_have_a_row, [{ name: 'DomainScheduled', row_source: 'domain' }]);
  assert.deepEqual(b.registry_entries_recording_no_run.map((x) => x.registry_name), ['Director']);
  assert.deepEqual(b.registry_runners_not_read.map((x) => x.registry_name), ['Mystery']);
  assert.deepEqual(b.timers_with_no_name.map((x) => x.ref), ['backend/src/server.ts:1', `${S}/aiOpsScheduler.ts:25`, `${S}/schedulerService.ts:12`]);
});

test('domain rows are seeded with releaseZero as event_driven; the platform view reads only the literal trigger', () => {
  const m = measured();
  assert.deepEqual(m.codeRows.find((r) => r.agentName === 'DomainScheduled'), { agentName: 'DomainScheduled', triggerType: 'event_driven', schedule: '', source: 'domain' });
  assert.equal(m.platformSeedRows.some((r) => r.agentName === 'DomainScheduled' || r.agentName === 'visitor_tracker'), false);
  assert.equal(m.codeRows.some((r) => r.agentName === 'visitor_tracker' && r.source === 'governance'), true);
  assert.deepEqual(seedRows(`const L: T[] = [\n  { ...releaseZero(), agent_name: 'X' },\n];`, 'const L', 'domain', false)[0].triggerType, '');
});

test('a list or baseline that has moved is an error, never an empty list', () => {
  assert.throws(() => measure(memReader({ ...FILES, [`${S}/aiOpsScheduler.ts`]: 'export const SOMETHING_ELSE = [];' }), NOW, null), /SCHEDULE_REGISTRY not found/);
  assert.throws(() => parseBaseline('export const KNOWN_CRON_SEED_ROWS_WITH_NO_REGISTRATION = [];'), /KNOWN_SCHEDULED_NAMES_WITH_NO_SEED_ROW not found/);
});

test('the scanner blanks comments without moving lines, and tracks template and regex literals', () => {
  const s = scan("a(); // x\n/* y\n z */ b(`t ${c('q')} u`);\nconst r = /'/g; d('e');\n");
  assert.equal(s.code.split('\n').length, 5);
  assert.doesNotMatch(s.code, /x|y|z/);
  assert.equal(s.balanced, true);
  assert.equal(inString(s, s.code.indexOf("'q'")), true);
  assert.equal(inString(s, s.code.indexOf("c(")), false, 'code inside ${} is code');
  assert.equal(inString(s, s.code.indexOf("d(")), false, 'a quote in a regex does not open a string');
  assert.deepEqual(cronNameSites('f.ts', "instrumentCronJob<Out>('Typed', fn); instrumentCronJob?.('Optional', fn);").map((x) => x.value), ['Typed', 'Optional']);
  assert.deepEqual(scheduleSites('f.ts', "cron.schedule(EXPR, () => { trackAgentRun('T', go); });"), [{ file: 'f.ts', line: 1, schedule: '(EXPR)', named: true }]);
});

test('the same checkout gives the same answer twice', () => {
  assert.deepEqual(reconcileAnswer(measured()), reconcileAnswer(measured()));
  assert.deepEqual(reconcile([], [], []), { cronSeedRowsWithNoRegistration: [], scheduledNamesWithNoSeedRow: [], scheduleDisagreements: [], registeredRowsDenyingSchedule: [], duplicateRegistryNames: [] });
});

test('CLI: reads the commit from .git, exits 0 on a match, 4 on new drift, 3 on healed only, 1 for a folder that is not a checkout', () => {
  const write = (files: Record<string, string>, head: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'ellis-recon-'));
    for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
    mkdirSync(join(dir, '.git/refs/heads'), { recursive: true });
    writeFileSync(join(dir, '.git/HEAD'), head);
    writeFileSync(join(dir, '.git/refs/heads/main'), '1234567890abcdef1234567890abcdef12345678\n');
    return dir;
  };
  const run = (dir: string) => spawnSync(process.execPath, ['src/cli/registryReconcile.ts', '--source', dir], { encoding: 'utf8' });
  const ok = run(write(FILES, 'ref: refs/heads/main\n'));
  assert.equal(ok.status, 0);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.source_commit, '123456789');
  assert.ok(!Number.isNaN(Date.parse(out.measured_at)));
  assert.equal(run(write({ ...FILES, [`${S}/agentRegistrySeed.ts`]: FILES[`${S}/agentRegistrySeed.ts`].replace("agent_name: 'Phantom',", "agent_name: 'Phantom',\n    trigger_type: 'cron',\n  },\n  {\n    agent_name: 'NewPhantom',") }, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd\n')).status, 4);
  assert.equal(run(write({ ...FILES, [`${S}/agentRegistrySeed.ts`]: FILES[`${S}/agentRegistrySeed.ts`].replace("schedule: '30 * * * *'", "schedule: '0 * * * *'") }, 'ref: refs/heads/main\n')).status, 3);
  const bad = run(mkdtempSync(join(tmpdir(), 'ellis-empty-')));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a platform checkout/);
});

test('definitions at the edges: a dynamic entry can disagree, a cron row with an empty schedule denies one, and a nested key is not the entry\'s own', () => {
  const row = (agentName: string, triggerType: string, schedule: string): CodeRow => ({ agentName, triggerType, schedule, source: 'seed' });
  const entry = (agentName: string, schedule: string, registry: RegistryEntry['registry'] = 'SCHEDULE_REGISTRY'): RegistryEntry => ({ agentName, schedule, registry, runner: 'r', line: 1 });
  const r = reconcile([row('Brief', 'cron', '0 6 * * *'), row('Blank', 'cron', '  ')], [entry('Brief', '45 6 * * *', 'DYNAMIC_SCHEDULE_REGISTRY')], ['Brief', 'Blank']);
  assert.deepEqual(r.scheduleDisagreements, ['Brief|45 6 * * *|0 6 * * *']);
  assert.deepEqual(r.registeredRowsDenyingSchedule, ['Blank|cron|  |instrumentCronJob']);
  assert.equal(ownString("{ config: { agent_name: 'Nested' }, agent_name: 'Own' }", 'agent_name'), 'Own');
});
