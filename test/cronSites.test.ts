import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCronSites, extractSeedRows, stringConstants } from '../src/inventory/cronSites.ts';
import { timersWithNoRow, pauseGaps, type ControlSnapshot } from '../src/capabilities/agentEnableDisableControl.ts';

// Snippets mirror the shapes in the platform's schedulerService.ts and growthJourneyCrons.ts at 7c70f0a.
const SCHEDULER = [
  "const LOCAL_NAME = 'LocalNamed';",
  "  cron.schedule('*/5 * * * *', () => {",
  "    instrumentCronJob('ScheduledActionsProcessor', () => processScheduledActions()).catch(() => {});",
  '  });',
  '  cron.schedule(',
  "    '30 3 * * *',",
  '    () => {',
  "      instrumentCronJob('ChatMessageCleanup', async () => {",
  '      });',
  '    },',
  '  );',
  "  // instrumentCronJob('CommentedOut', ...) in a comment is not a timer",
  "  cron.schedule('0 * * * *', () => { instrumentCronJob(LOCAL_NAME, async () => {}); });",
  '  cron.schedule(DIGEST_SCHEDULE, () => {',
  '    instrumentCronJob(DIGEST_AGENT, async () => {});',
  '  });',
  "  cron.schedule('0 2 * * *', () => {",
  '    for (const src of sources) {',
  '      await instrumentCronJob(`Intel_${src.slug}`, async () => {});',
  '    }',
  '  });',
  "  cron.schedule('0 4 * * *', () => { instrumentCronJob(MISSING_CONST, async () => {}); });",
].join('\n');
const IMPORTED = new Map([['DIGEST_AGENT', 'GrowthJourneyHandoffDigest'], ['DIGEST_SCHEDULE', '0 14 * * 1-5']]);

test('every cron-wrapped timer is found with its schedule and line, including split lines and constants', () => {
  const { timers } = extractCronSites(SCHEDULER, 'services/schedulerService.ts', IMPORTED);
  assert.deepEqual(timers.map((t) => [t.timer, t.schedule, t.ref]), [
    ['ScheduledActionsProcessor', '*/5 * * * *', 'services/schedulerService.ts:3'],
    ['ChatMessageCleanup', '30 3 * * *', 'services/schedulerService.ts:8'],
    ['LocalNamed', '0 * * * *', 'services/schedulerService.ts:13'],
    ['GrowthJourneyHandoffDigest', '0 14 * * 1-5', 'services/schedulerService.ts:15'],
  ]);
  assert.deepEqual(timers[0].gates, [{ gate: 'instrument_cron_job', flag: 'ScheduledActionsProcessor' }]);
});

test('a name built at run time or an unknown constant is reported as unresolved, never guessed', () => {
  const { unresolved } = extractCronSites(SCHEDULER, 'services/schedulerService.ts', IMPORTED);
  assert.deepEqual(unresolved.map((u) => u.ref), ['services/schedulerService.ts:19', 'services/schedulerService.ts:22']);
  assert.match(unresolved[0].reason, /built at run time \(`Intel_\$\{src\.slug\}`\)/);
  assert.match(unresolved[1].reason, /MISSING_CONST, which could not be resolved/);
});

test('a call with no cron.schedule above it is unresolved, and a non-literal schedule is said to be one', () => {
  const far = ["cron.schedule('* * * * *', () => {}),", ...Array(20).fill('// filler'), "instrumentCronJob('Orphaned', async () => {});"].join('\n');
  assert.match(extractCronSites(far, 'f.ts').unresolved[0].reason, /Orphaned: no cron.schedule within 15 lines/);
  const odd = "cron.schedule(buildExpr(), () => { instrumentCronJob('Odd', async () => {}); });";
  assert.equal(extractCronSites(odd, 'f.ts').timers[0].schedule, 'not a literal');
});

test('string constants are read from declarations, exported or not', () => {
  assert.deepEqual([...stringConstants("export const A_B = 'x';\nconst C = 'y';\nconst lower = 'z';")], [['A_B', 'x'], ['C', 'y']]);
});

test('rows come from every seed list and the governance agents, with enabled as seeded', () => {
  const seed = [
    '  {',
    "    agent_name: 'ScheduledActionsProcessor',",
    '    config: {',
    "      agent_name: 'NotARow',",
    '    },',
    '    enabled: false,',
    '  },',
    '  {',
    "    agent_name: 'ChatMessageCleanup',",
    '  },',
  ].join('\n');
  const growth = "  {\n    agent_name: 'GrowthJourneyHandoffDigest',\n  },";
  const governance = "const GOVERNANCE_AGENTS = [\n  { agent_name: 'visitor_tracker', agent_type: 'x' },\n];";
  const rows = extractSeedRows([seed, growth], governance);
  assert.deepEqual(rows.map((r) => [r.agent_name, r.enabled]), [
    ['ScheduledActionsProcessor', false], ['ChatMessageCleanup', true], ['GrowthJourneyHandoffDigest', true], ['visitor_tracker', true],
  ]);
  assert.equal(rows[3].id, 'governance:visitor_tracker');
});

test('timers whose row does not exist are listed as beyond disable and pause; a registered instrumentCronJob timer is no pause gap since PR 3430', () => {
  const { timers } = extractCronSites(SCHEDULER, 'services/schedulerService.ts', IMPORTED);
  const snap: ControlSnapshot = {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test', timers,
    ai_agents: [{ id: 'seed:ChatMessageCleanup', agent_name: 'ChatMessageCleanup', enabled: true, status: 'idle' }],
    cron_schedule_configs: [], requests: [],
  };
  const none = timersWithNoRow(snap);
  assert.deepEqual(none.map((n) => n.timer), ['GrowthJourneyHandoffDigest', 'LocalNamed', 'ScheduledActionsProcessor']);
  assert.match(none[0].effect, /no GrowthJourneyHandoffDigest row; finding none, the wrapper runs it anyway, untracked/);
  assert.deepEqual(none.map((n) => n.runs), ['untracked', 'untracked', 'untracked']);
  assert.deepEqual(pauseGaps(snap), []);
  assert.deepEqual(timersWithNoRow({ ...snap, timers: [...timers].reverse() }), none);
});
