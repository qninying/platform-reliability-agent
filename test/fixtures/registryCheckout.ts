// A small platform checkout shaped like the real one at 4443087. Names and counts are test inputs.
export const S = 'backend/src/services';
export const FILES: Record<string, string> = {
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
