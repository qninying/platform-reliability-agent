import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentHealth, confirmLiveFormula, platformScore, platformErrorRate, type ScoreSnapshot, type ScoreRow } from '../src/capabilities/agentHealthScoring.ts';
import type { TimerRow } from '../src/capabilities/agentEnableDisableControl.ts';

// Names and wiring mirror the platform at 4443087; counters are test inputs, not production data.
const row = (name: string, over: Partial<ScoreRow> = {}): ScoreRow => ({ id: `row-${name}`, agent_name: name, enabled: true, status: 'idle', run_count: 10, error_count: 0, category: 'operations', ...over });
const timer = (t: string, schedule: string, ref: string, gate: TimerRow['gates'][0]['gate'], flag: string | null = t): TimerRow => ({ timer: t, schedule, label: t, ref, gates: [{ gate, flag }] });
const snap = (rows: ScoreRow[], timers: TimerRow[] = []): ScoreSnapshot => ({ captured_at: '2026-10-27T18:00:00Z', captured_by: 'test', ai_agents: rows, timers, timer_scope: ['aiOpsScheduler.ts', 'schedulerService.ts'] });
const all = (a: ReturnType<typeof agentHealth>) => [...a.scored, ...a.unscored, ...a.score_cannot_fall];
const by = (a: ReturnType<typeof agentHealth>) => new Map(all(a).map((x) => [x.name, x]));

// The lines of aiOpsService.ts at 4443087 that the answer reproduces.
const LIVE = `    const errorRate = a.run_count > 0 ? a.error_count / a.run_count : 0;
    const healthScore = Math.max(
      0,
      Math.round(100 - (a.error_count / Math.max(a.run_count, 1)) * 200 - (a.status === 'error' ? 30 : 0)),
    );`;

test('acceptance: every score derived from run_count 0 is labelled unscored rather than 100', () => {
  const s = snap([
    row('NeverFired', { run_count: 0 }),
    row('DisabledNeverRan', { run_count: 0, enabled: false }),
    row('ErrorStatusNoRuns', { run_count: 0, status: 'error' }),
    row('ThrowsEveryTime', { run_count: 0, error_count: 4, status: 'error' }),
    row('StrategicCycle', { run_count: 0 }),
    row('Healthy', { run_count: 50 }),
  ], [timer('StrategicCycle', '0 6 * * 1', 'aiOpsScheduler.ts:300', 'director_gate')]);
  const a = agentHealth(s);
  const zero = all(a).filter((x) => x.run_count === 0);
  assert.equal(zero.length, 5);
  for (const x of zero) {
    assert.equal(x.state, 'unscored', x.name);
    assert.equal(x.score, null, x.name);
    assert.match(x.label, /^unscored/, x.name);
    assert.doesNotMatch(x.label, /100/, x.name);
  }
  // The platform would have shown 100 for the ones with no errors and no error status.
  assert.equal(by(a).get('NeverFired')!.platform_shows.health_score, 100);
  assert.match(by(a).get('NeverFired')!.notes.join(' '), /shows 100, in green, as if the agent were flawless/);
  assert.match(by(a).get('StrategicCycle')!.notes.join(' '), /director gate that records no run/);
  assert.equal(a.fleet.platform_100_on_zero_runs, 3);
  assert.equal(by(a).get('Healthy')!.score, 100);
});

test('acceptance, on the real fleet: all 259 rows created in code at 4443087 have run_count 0, and none is scored 100', () => {
  const real = JSON.parse(readFileSync(new URL('../examples/cron-health.example.json', import.meta.url), 'utf8')) as ScoreSnapshot;
  const a = agentHealth(real);
  assert.equal(a.fleet.rows, 259);
  assert.equal(a.fleet.unscored, 259);
  assert.equal(a.fleet.scored, 0);
  assert.equal(a.fleet.platform_100_on_zero_runs, 259);
  assert.ok(all(a).every((x) => x.state === 'unscored' && x.score === null));
  assert.equal(a.triage.length, 0);
  assert.equal(a.fleet.timers_with_no_row, 41);
});

test('a zero-run agent with failures on record is unscored but put first in triage, not buried', () => {
  const a = agentHealth(snap([row('Steady', { run_count: 100, error_count: 10 }), row('ThrowsEveryTime', { run_count: 0, error_count: 7, status: 'error' })]));
  const t = by(a).get('ThrowsEveryTime')!;
  assert.equal(t.state, 'unscored');
  assert.equal(t.attention, true);
  assert.match(t.label, /0 runs counted, but 7 failure\(s\) recorded/);
  // The platform shows a score of 0 next to an error rate of 0 for this row.
  assert.deepEqual(t.platform_shows, { health_score: 0, error_rate: 0 });
  assert.equal(a.triage[0].name, 'ThrowsEveryTime');
  assert.equal(a.fleet.unscored_with_failures, 1);
});

test('reproduces the registry tab\'s score and error rate exactly', () => {
  const cases: Array<[Partial<ScoreRow>, number, number]> = [
    [{ run_count: 10, error_count: 1 }, 80, 0.1],
    [{ run_count: 10, error_count: 5 }, 0, 0.5],
    [{ run_count: 10, error_count: 2, status: 'error' }, 30, 0.2],
    [{ run_count: 0, error_count: 0 }, 100, 0],
    [{ run_count: 0, error_count: 3, status: 'error' }, 0, 0],
    [{ run_count: 4, error_count: 6 }, 0, 1.5],
    [{ run_count: 3, error_count: 1 }, 33, 0.33],
  ];
  for (const [over, score, rate] of cases) {
    const r = row('x', over);
    assert.equal(platformScore(r), score, JSON.stringify(over));
    assert.equal(platformErrorRate(r), rate, JSON.stringify(over));
  }
});

test('a trackAgentRun agent with no errors cannot fall, so its 100 is not reported as a score', () => {
  const a = agentHealth(snap([row('MetaAgentLoop', { run_count: 40 }), row('AutonomousEngine', { run_count: 40, error_count: 2 })], [
    timer('MetaAgentLoop', '0 */6 * * *', 'aiOpsScheduler.ts:420', 'track_agent_run'),
    timer('AutonomousEngine', '*/30 * * * *', 'aiOpsScheduler.ts:410', 'track_agent_run'),
  ]));
  const m = by(a).get('MetaAgentLoop')!;
  assert.equal(m.state, 'score_cannot_fall');
  assert.equal(m.score, null);
  assert.equal(m.platform_shows.health_score, 100);
  assert.match(m.notes.join(' '), /agentRunTracker\.ts:58-70/);
  // Errors written by something else do move it, so that one is scored.
  assert.equal(by(a).get('AutonomousEngine')!.state, 'scored');
  assert.equal(a.triage.some((t) => t.name === 'MetaAgentLoop'), false);
  const fresh = by(agentHealth(snap([row('CoryEvolutionCycle', { run_count: 0 })], [timer('CoryEvolutionCycle', '0 3 * * *', 'aiOpsScheduler.ts:430', 'track_agent_run')]))).get('CoryEvolutionCycle')!;
  assert.equal(fresh.state, 'unscored');
  assert.match(fresh.notes.join(' '), /once it runs it still cannot fall/);
});

test('triage is worst first, and agents floored at 0 are ranked by error rate', () => {
  const a = agentHealth(snap([
    row('Fine', { run_count: 100, error_count: 1 }),
    row('HalfFailing', { run_count: 100, error_count: 50 }),
    row('AllFailing', { run_count: 10, error_count: 10 }),
    row('Wobbly', { run_count: 10, error_count: 2 }),
    row('NeverFired', { run_count: 0 }),
  ]));
  assert.deepEqual(a.triage.map((t) => t.name), ['AllFailing', 'HalfFailing', 'Wobbly', 'Fine']);
  assert.match(by(a).get('HalfFailing')!.notes.join(' '), /floors at 0/);
});

test('notes say where the number misleads: errors above runs, a wrapper with no error status, a pooled row, no timer', () => {
  const a = agentHealth(snap([
    row('Thrower', { run_count: 4, error_count: 6, status: 'error' }),
    row('ReesePresenceHeartbeat', { run_count: 20, error_count: 3 }),
    row('Dara', { run_count: 30, error_count: 0 }),
    row('Orphan', { run_count: 5 }),
    row('Paired', { run_count: 9 }),
  ], [
    timer('Thrower', '*/5 * * * *', 'aiOpsScheduler.ts:200', 'run_agent'),
    timer('ReesePresenceHeartbeat', '*/15 * * * *', 'schedulerService.ts:1750', 'instrument_cron_job'),
    timer('Dara', '10 6 * * *', 'aiOpsScheduler.ts:367', 'instrument_cron_job'),
    timer('DaraWeekly', '0 7 * * 1', 'aiOpsScheduler.ts:368', 'instrument_cron_job', 'Dara'),
    timer('DaraMonthly', '0 8 1 * *', 'aiOpsScheduler.ts:369', 'instrument_cron_job', 'Dara'),
    timer('PairA', '0 * * * *', 'schedulerService.ts:10', 'instrument_cron_job', 'Paired'),
    timer('PairB', '30 2 * * *', 'schedulerService.ts:11', 'instrument_cron_job', 'Paired'),
  ]));
  const m = by(a);
  assert.match(m.get('Thrower')!.notes.join(' '), /error_count \(6\) exceeds run_count \(4\)/);
  assert.match(m.get('ReesePresenceHeartbeat')!.notes.join(' '), /never takes the 30-point error penalty/);
  assert.match(m.get('Dara')!.notes.join(' '), /3 timers on 3 different schedules .* share this one row/);
  assert.match(m.get('Paired')!.notes.join(' '), /2 timers on 2 different schedules/);
  assert.match(m.get('Orphan')!.notes.join(' '), /no timer in aiOpsScheduler\.ts, schedulerService\.ts records under this row/);
});

test('a timer with no row is listed as having no score at all, with what its wrapper then does', () => {
  const a = agentHealth(snap([row('Healthy')], [
    timer('PaySimplePaymentSync', '*/30 * * * *', 'schedulerService.ts:2175', 'instrument_cron_job'),
    timer('WeeklyReport', '0 13 * * 0', 'aiOpsScheduler.ts:266', 'run_agent'),
    timer('DeptCampaignPerformanceAgent', '25 */6 * * *', 'aiOpsScheduler.ts:189', 'unknown', null),
  ]));
  const names = a.no_row.map((n) => n.name);
  assert.deepEqual(names, ['PaySimplePaymentSync', 'WeeklyReport']);
  assert.match(a.no_row[0].statement, /no score at all.*runs it anyway, untracked/);
  assert.match(a.no_row[1].statement, /returns without running/);
});

test('fleet counts include the overview counts over the same rows', () => {
  const a = agentHealth(snap([
    row('A', { status: 'running' }), row('B'), row('C', { enabled: false }), row('D', { status: 'paused' }), row('E', { status: 'error', error_count: 1 }),
  ]));
  assert.deepEqual(a.fleet.overview, { running: 1, idle: 1, paused: 1, disabled: 1, errored: 1 });
  assert.equal(a.fleet.platform_shows_100, 4);
  assert.match(a.statement, /The registry tab shows 100 for 4 agents; 0 of those rest on zero runs/);
});

test('the live formula is confirmed, and a changed one is an error', () => {
  confirmLiveFormula(LIVE);
  assert.throws(() => confirmLiveFormula(LIVE.replace('* 200', '* 100')), /no longer computes 100 - /);
  assert.throws(() => confirmLiveFormula(LIVE.replace('a.run_count > 0 ?', 'a.run_count >= 0 ?')), /error_rate/);
});

test('the same snapshot gives the same answer twice, and is not changed by reading it', () => {
  const s = snap([row('A', { run_count: 0 }), row('B', { run_count: 10, error_count: 3 })], [timer('A', '0 * * * *', 'x.ts:1', 'run_agent')]);
  const before = JSON.stringify(s);
  assert.deepEqual(agentHealth(s), agentHealth(s));
  assert.equal(JSON.stringify(s), before);
});

test('CLI: exit codes, a missing counter is refused, and --source confirms the formula', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ellis-health-'));
  const run = (s: unknown, extra: string[] = []) => {
    const p = join(dir, `s${Math.random()}.json`);
    writeFileSync(p, JSON.stringify(s));
    return spawnSync(process.execPath, ['src/cli/agentHealth.ts', '--snapshot', p, ...extra], { encoding: 'utf8' });
  };
  assert.equal(run(snap([row('A')])).status, 0);
  assert.equal(run(snap([row('A', { run_count: 0 })])).status, 3);
  assert.equal(run(snap([row('A', { run_count: 0, error_count: 2 })])).status, 4);
  const missing = run({ ...snap([]), ai_agents: [{ id: 'x', agent_name: 'X', enabled: true, status: 'idle', error_count: 0 }] });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /a missing counter is not a zero/);

  mkdirSync(join(dir, 'backend/src/services'), { recursive: true });
  writeFileSync(join(dir, 'backend/src/services/aiOpsService.ts'), LIVE);
  const ok = run(snap([row('A')]), ['--source', dir]);
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).formula_source, 'backend/src/services/aiOpsService.ts in the given checkout, confirmed at run time');
  writeFileSync(join(dir, 'backend/src/services/aiOpsService.ts'), LIVE.replace('* 200', '* 150'));
  assert.equal(run(snap([row('A')]), ['--source', dir]).status, 1);
});
