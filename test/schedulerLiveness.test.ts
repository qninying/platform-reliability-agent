import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveness, probes, fromBootLog, outsideRegistries, FILES } from '../src/capabilities/schedulerLiveness.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const ENV = `
export const env = {
  port: Number(process.env.PORT || 3001),
  enableFollowUpScheduler: process.env.ENABLE_FOLLOWUP_SCHEDULER === 'true',
  enableOther: process.env.ENABLE_OTHER === 'true',
};
`;
const SERVER = `
import { startScheduler } from './services/schedulerService';
// startScheduler(); is mentioned in a comment and is not a call
function boot() {
  if (env.enableFollowUpScheduler) {
    startScheduler();
  }
}
`;
const SERVICE = `
export function startScheduler(): void {
  cron.schedule('*/5 * * * *', async () => { await setSetting('scheduler_heartbeat', new Date().toISOString()); });
  const { startAIOpsScheduler } = require('./aiOpsScheduler');
  startAIOpsScheduler().catch((err: any) => {
    console.error('[Scheduler] AI Ops scheduler startup error:', err.message);
  });
}
`;
const SCHEDULER = `
export const SCHEDULE_REGISTRY: ScheduleEntry[] = [
  { agentName: 'One', hardcodedSchedule: '*/5 * * * *', runner: runOne, label: 'One' },
  { agentName: 'Two', hardcodedSchedule: '0 * * * *', runner: runTwo, label: 'Two' },
];
const DYNAMIC_SCHEDULE_REGISTRY: DynamicScheduleEntry[] = [
  { agentName: 'Brief', hardcodedSchedule: '45 6 * * *', dynamicImport: async () => { await brief(); }, label: 'Briefing' },
];
export async function startAIOpsScheduler(): Promise<void> {
  let scheduledCount = 0;
  for (const entry of SCHEDULE_REGISTRY) { startStandardTask(entry, entry.hardcodedSchedule); scheduledCount++; }
  cron.schedule('* * * * *', async () => { await evaluateAndRespond(); }, { timezone: 'America/Chicago' });
  scheduledCount++;
  console.log(\`[AI Ops] Scheduler started: \${scheduledCount} agents scheduled, \${skippedCount} disabled\`);
}
`;
const FORK = `
export async function startAIOpsScheduler(): Promise<void> {
  console.log('fork');
}
`;
const SCRIPT = `
console.log('  aiOpsScheduler.startAIOpsScheduler(): available');
console.log('  schedulerService.startScheduler(): available');
`;
const HEALTH = `
const router = Router();
router.get('/health', async (_req: Request, res: Response) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});
router.get('/health/full', async (_req: Request, res: Response) => {
  const { runFullSystemHealthCheck } = require('../services/systemHealthService');
  const report = await runFullSystemHealthCheck();
  res.status(report.overall_status === 'critical' ? 503 : 200).json(report);
});
`;
const HEALTH_SERVICE = `
async function checkSchedulerLiveness(checks: HealthCheck[]): Promise<void> {
  const heartbeat = await getSetting('scheduler_heartbeat');
  if (!heartbeat) {
    checks.push({ name: 'scheduler_liveness', severity: 'warning', detail: 'No scheduler heartbeat found.' });
    return;
  }
  const ageMinutes = (Date.now() - new Date(heartbeat).getTime()) / 60000;
  if (ageMinutes > 25) {
    checks.push({ name: 'scheduler_liveness', severity: 'critical', detail: 'old' });
  } else if (ageMinutes > 12) {
    checks.push({ name: 'scheduler_liveness', severity: 'warning', detail: 'late' });
  }
}
`;
const BASE: Record<string, string> = {
  [FILES.env]: ENV, 'backend/src/server.ts': SERVER, 'backend/src/services/schedulerService.ts': SERVICE,
  [FILES.scheduler]: SCHEDULER, 'backend/src/services/aiOpsScheduler-Ali-AI.ts': FORK, 'backend/src/scripts/goLive.ts': SCRIPT,
  [FILES.health]: HEALTH, [FILES.healthService]: HEALTH_SERVICE,
  'backend/src/services/__tests__/scheduler.test.ts': 'startAIOpsScheduler(); startScheduler();',
  'backend/src/services/__tests__/fixtures/world.ts': 'startAIOpsScheduler(); startScheduler();',
};
const lineOf = (text: string, needle: string) => text.slice(0, text.indexOf(needle)).split('\n').length;

function rdr(over: Record<string, string> = {}): Reader {
  const files = { ...BASE, ...over };
  return {
    read(rel) { if (!(rel in files)) throw new Error(`no ${rel}`); return files[rel]; },
    list(dir) { return Object.keys(files).filter((f) => f.startsWith(dir)).sort(); },
  };
}
function checkout(over: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ellis-live-'));
  for (const [rel, text] of Object.entries({ ...BASE, ...over })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const CLI = join(import.meta.dirname, '../src/cli/schedulerLiveness.ts');
const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('acceptance: the report names ENABLE_FOLLOWUP_SCHEDULER as the single flag and startScheduler as the only caller of the AI Ops scheduler, both as measured facts', () => {
  const a = liveness(rdr(), 'abc1234', null);
  assert.equal(a.gate.single_flag, true);
  assert.deepEqual(a.gate.flags, [{ key: 'enableFollowUpScheduler', env_var: 'ENABLE_FOLLOWUP_SCHEDULER', defined_at: { file: FILES.env, line: lineOf(ENV, 'enableFollowUpScheduler') } }]);
  assert.deepEqual(a.gate.call_sites, [{ file: 'backend/src/server.ts', line: lineOf(SERVER, '    startScheduler();'), guarded_by: 'env.enableFollowUpScheduler', env_var: 'ENABLE_FOLLOWUP_SCHEDULER' }]);
  assert.equal(a.ai_ops_start.only_caller, 'startScheduler');
  assert.deepEqual(a.ai_ops_start.callers, [{ file: 'backend/src/services/schedulerService.ts', line: lineOf(SERVICE, 'startAIOpsScheduler().catch'), in_function: 'startScheduler' }]);
  assert.match(a.statement, /^ENABLE_FOLLOWUP_SCHEDULER is the single flag: every startScheduler\(\) call \(backend\/src\/server\.ts:\d+\) runs only when it is 'true'\. startScheduler\(\) is the only caller of startAIOpsScheduler\(\) \(backend\/src\/services\/schedulerService\.ts:\d+\)\./);
  assert.match(a.decision, /K\.D\. approves/);
});

test('the public probe is reported as unable to detect zero timers, and one that consults the scheduler is not', () => {
  const a = liveness(rdr(), null, null);
  assert.deepEqual(a.public_probe, { route: 'GET /health', at: { file: FILES.health, line: lineOf(HEALTH, "router.get('/health',") }, consults_scheduler: false, detects_zero_timers: false });
  assert.match(a.statement, /GET \/health never consults the scheduler, so it returns 200 when no timer registered\./);
  const aware = HEALTH.replace("await sequelize.query('SELECT 1');", "await sequelize.query('SELECT 1'); if (registeredTimers() === 0) throw new Error('none');");
  assert.equal(probes(aware, HEALTH_SERVICE).public_probe.detects_zero_timers, true);
  assert.equal(probes('const router = Router();', HEALTH_SERVICE).public_probe.detects_zero_timers, null);
});

test('the heartbeat check is read with its own thresholds: missing is a warning, 12 minutes a warning, 25 critical', () => {
  const p = probes(HEALTH, HEALTH_SERVICE).full_probe;
  assert.deepEqual(p.heartbeat, { at: { file: FILES.healthService, line: lineOf(HEALTH_SERVICE, 'async function') }, missing: 'warning', warning_after_minutes: 12, critical_after_minutes: 25 });
  assert.equal(p.consults_scheduler, true);
  assert.equal(probes(HEALTH, 'export {};').full_probe.heartbeat, null);
  const earlier = HEALTH_SERVICE.replace("  const heartbeat = await getSetting('scheduler_heartbeat');", "  checks.push({ name: 'start', severity: 'ok' });\n  const heartbeat = await getSetting('scheduler_heartbeat');");
  assert.equal(probes(HEALTH, earlier).full_probe.heartbeat!.missing, 'warning', 'missing is read from the no-heartbeat branch');
});

test('a second flag, an unguarded call or a second caller is reported, not folded into the single answer', () => {
  const two = liveness(rdr({ 'backend/src/worker.ts': 'if (env.enableOther) {\n  startScheduler();\n}\n' }), null, null);
  assert.equal(two.gate.single_flag, false);
  assert.deepEqual(two.gate.flags.map((f) => f.env_var).sort(), ['ENABLE_FOLLOWUP_SCHEDULER', 'ENABLE_OTHER']);
  assert.match(two.statement, /^No single flag gates startScheduler\(\): 2 call site\(s\)/);
  const bare = liveness(rdr({ 'backend/src/worker.ts': 'if (env.enableOther) {\n  warm();\n}\nstartScheduler();\n' }), null, null);
  assert.equal(bare.gate.single_flag, false);
  assert.equal(bare.gate.call_sites.find((c) => c.file === 'backend/src/worker.ts')!.guarded_by, null);
  const second = liveness(rdr({ 'backend/src/other.ts': "function warm() {\n  return 1;\n}\nconst { startAIOpsScheduler } = require('./services/aiOpsScheduler');\nstartAIOpsScheduler();\n" }), null, null);
  assert.equal(second.ai_ops_start.only_caller, null);
  assert.equal(second.ai_ops_start.callers.length, 2);
  assert.equal(second.ai_ops_start.callers.find((c) => c.file === 'backend/src/other.ts')!.in_function, null, 'a call after a function closes is not inside it');
  assert.match(second.statement, /startAIOpsScheduler\(\) has 2 caller\(s\)\./);
  const notEnv = liveness(rdr({ 'backend/src/server.ts': "if (process.env.RUN === '1') {\n  startScheduler();\n}\n" }), null, null);
  assert.equal(notEnv.gate.single_flag, false, 'a guard that is not an env flag is not the single flag');
  const none = liveness(rdr({ 'backend/src/server.ts': 'export {};' }), null, null);
  assert.equal(none.gate.single_flag, false);
});

test('a call in a comment, a string or a test file is not a call, and the forked copy is defined but never called', () => {
  const a = liveness(rdr(), null, null);
  assert.equal(a.gate.call_sites.length, 1);
  assert.equal(a.ai_ops_start.callers.length, 1);
  assert.deepEqual(a.ai_ops_start.definitions.map((d) => [d.file, d.called]), [['backend/src/services/aiOpsScheduler-Ali-AI.ts', false], [FILES.scheduler, true]]);
});

test('the boot log gives the last boot\'s count; no log, or no boot line, says the count is unknown', () => {
  const log = 'x\n[AI Ops] Scheduler started: 98 agents scheduled, 3 disabled\ny\n[AI Ops] Scheduler started: 101 agents scheduled, 0 disabled\n';
  const a = liveness(rdr(), null, log);
  assert.equal(a.registered.from, 'boot_log');
  assert.equal(a.registered.scheduled, 101);
  assert.equal(a.registered.disabled, 0);
  assert.equal(a.registered.boots_in_log, 2);
  assert.match(a.statement, /The last boot in the log registered 101 AI Ops timers and skipped 0 as disabled, 101 in all\./);
  // 101 is more than the 4 this code registers: the log comes from other code, so no shortfall is judged.
  assert.equal(a.against_expected.state, 'more_than_expected');
  assert.ok(a.blind_spots.some((b) => /more than the 4 this code registers, so the log comes from other code/.test(b)));
  const none = liveness(rdr(), null, null);
  assert.equal(none.registered.scheduled, null);
  assert.ok(none.blind_spots.some((b) => /no boot log was given/.test(b) && !/not found in this source/.test(b)));
  assert.ok(liveness(rdr({ [FILES.scheduler]: SCHEDULER.replace('Scheduler started:', 'Started:') }), null, null).blind_spots.some((b) => /not found in this source/.test(b)));
  const empty = fromBootLog('nothing here', SCHEDULER);
  assert.equal(empty.scheduled, null);
  assert.ok(liveness(rdr(), null, 'nothing here').blind_spots.some((b) => /holds no "\[AI Ops\] Scheduler started" line/.test(b)));
});

test('a cron registered inside startAIOpsScheduler is counted at boot but sits in neither registry', () => {
  assert.deepEqual(outsideRegistries(SCHEDULER), [{ file: FILES.scheduler, line: lineOf(SCHEDULER, "cron.schedule('* * * * *'") }]);
  const a = liveness(rdr(), null, null);
  assert.ok(a.blind_spots.some((b) => /includes 1 cron registered inside startAIOpsScheduler outside both registries/.test(b)));
  assert.equal(a.registry_entries, 3);
  assert.deepEqual(outsideRegistries('export {};'), []);
});

test('registration is never reported as execution', () => {
  const a = liveness(rdr(), null, null);
  assert.ok(a.blind_spots.some((b) => /a registered timer is not a fired one/.test(b)));
});

test('K.D.\'s rule (2026-11-08): the expected count comes from the code, and the last boot is judged against it', () => {
  // Two standard entries, one dynamic entry and the auto-response cron: four timers.
  const none = liveness(rdr(), 'abc', null);
  assert.deepEqual(none.expected, { from: 'source', total: 4, registry_entries: 3, outside_registries: 1, rule: 'The expected count is what the deployed code registers, and any shortfall raises the alarm (K.D., 2026-11-08).' });
  assert.deepEqual(none.against_expected, { state: 'not_known', booted_total: null, shortfall: null });
  assert.ok(none.blind_spots.some((b) => /read from this checkout \(abc\); it is the deployed code's only if this is the deployed commit/.test(b)));
  assert.match(none.statement, /This code registers 4 AI Ops timers \(3 registry entries and 1 outside them\)\./);
  const short = liveness(rdr(), 'abc', '[AI Ops] Scheduler started: 3 agents scheduled, 0 disabled\n');
  assert.deepEqual(short.against_expected, { state: 'shortfall', booted_total: 3, shortfall: 1 });
  assert.match(short.statement, /3 in all: 1 short of the 4 the code registers\./);
  // A disabled entry was reached and skipped on purpose: it counts toward the total, so this boot is not short.
  const match = liveness(rdr(), 'abc', '[AI Ops] Scheduler started: 3 agents scheduled, 1 disabled\n');
  assert.deepEqual(match.against_expected, { state: 'matches', booted_total: 4, shortfall: 0 });
  assert.match(match.statement, /4 in all, as the code expects\./);
});

test('idempotent: the same source and log give the same answer twice', () => {
  assert.deepEqual(liveness(rdr(), 'abc', 'x'), liveness(rdr(), 'abc', 'x'));
});

test('cli: exit 3 when /health cannot detect zero, 0 when it can, 5 when the gate is not single, 1 on bad input', () => {
  const r3 = run(['--source', checkout()]);
  assert.equal(r3.status, 3, r3.stderr);
  assert.equal(JSON.parse(r3.stdout).gate.single_flag, true);
  const aware = HEALTH.replace("await sequelize.query('SELECT 1');", "await sequelize.query('SELECT 1'); if (registeredTimers() === 0) throw new Error('none');");
  assert.equal(run(['--source', checkout({ [FILES.health]: aware })]).status, 0);
  assert.equal(run(['--source', checkout({ 'backend/src/worker.ts': 'startScheduler();\n' })]).status, 5);
  assert.equal(run(['--source', checkout({ 'backend/src/other.ts': 'function w() { startAIOpsScheduler(); }\n' })]).status, 5);
  const root = checkout();
  const log = join(root, 'boot.log');
  writeFileSync(log, '[AI Ops] Scheduler started: 7 agents scheduled, 1 disabled\n');
  assert.equal(JSON.parse(run(['--source', root, '--boot-log', log]).stdout).registered.scheduled, 7);
  // A probe that can see zero timers still exits 3 when the last boot fell short of the code's count.
  const awareRoot = checkout({ [FILES.health]: aware });
  const shortLog = join(awareRoot, 'short.log');
  writeFileSync(shortLog, '[AI Ops] Scheduler started: 2 agents scheduled, 1 disabled\n');
  assert.equal(run(['--source', awareRoot, '--boot-log', shortLog]).status, 3);
  const fullLog = join(awareRoot, 'full.log');
  writeFileSync(fullLog, '[AI Ops] Scheduler started: 3 agents scheduled, 1 disabled\n');
  assert.equal(run(['--source', awareRoot, '--boot-log', fullLog]).status, 0);
  assert.equal(run(['--source', root, '--boot-log', join(root, 'missing.log')]).status, 1);
  assert.equal(run([]).status, 1);
});
