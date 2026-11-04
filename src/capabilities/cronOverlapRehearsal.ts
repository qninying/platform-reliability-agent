// platform.cron_overlap_guard, rung R4: builds an overlap guard and verifies it against a sandbox timer forced to
// overrun its interval, on more than one scheduler process. The guard is a claim shared by every process, with a
// lease so a process that dies mid-run does not block the job for good, and it records every tick it skips, with
// the run that held the claim. The library's per-process guard runs on the same timeline as the control.
// Sandbox only: time is simulated and nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit c150d4c48):
// - Timers are node-cron 4 (backend/package.json:42), which offers noOverlap. The scheduler passes only a timezone
//   (backend/src/services/aiOpsScheduler.ts:572, :583), so no timer has an overlap guard today.
// - noOverlap holds a tick only while the same process has a run in flight, and skips without a record. Three
//   scheduler instances run in production by design (backend/src/services/scheduling/claimLease.ts:19), so a
//   per-process guard cannot stop a second process starting the same job.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = 'c150d4c48';
export const LIMITS: readonly string[] = [
  'Time is simulated in steps of one tick. Clock skew between processes, and a claim write that times out, are not run.',
  'The lease must outlast the longest run, and the fixture sets it. A run longer than its lease would let a second run start; renewing the lease while running is not built here.',
  'A skipped tick is recorded with the run that held the claim. Whether it counts as a missed run, and whether a job must catch up, is K.D.\'s open decision.',
  'The guard is verified on one job. Applying it to a platform timer is a reviewed deploy by a person.',
];

export interface OverlapFixture {
  fixture_id: string;
  description: string;
  job: string;
  interval_ms: number;
  run_ms: number;
  lease_ms: number;
  ticks: number;
  processes: string[];
  // A process that dies partway through the run it started at this tick, without releasing its claim.
  crash: { process: string; at_tick: number } | null;
}

export type Result = 'started' | 'skipped' | 'completed' | 'died';
export interface ActivityRow { seq: number; process: string; tick: number; at_ms: number; result: Result; run: string | null; reason: string | null }
interface Run { id: string; process: string; start: number; end: number; tick: number }
interface Claim { holder: string; run: string; expires: number }
export type Guard = 'shared_claim' | 'per_process';

// One timeline: every process fires the same cron at every tick; runs end, or die, before the ticks at that moment.
function simulate(fx: OverlapFixture, guard: Guard): { rows: ActivityRow[]; runs: Run[] } {
  const rows: ActivityRow[] = [];
  const runs: Run[] = [];
  const log = (process: string, tick: number, at_ms: number, result: Result, run: string | null, reason: string | null) =>
    rows.push({ seq: rows.length + 1, process, tick, at_ms, result, run, reason });
  let claim: Claim | null = null;
  const inFlight = new Map<string, Run>();
  const open: Run[] = [];
  for (let k = 0; k < fx.ticks; k++) {
    const t = k * fx.interval_ms;
    for (const r of open.filter((x) => x.end <= t).sort((a, b) => a.end - b.end)) {
      open.splice(open.indexOf(r), 1);
      inFlight.delete(r.process);
      const died = fx.crash?.process === r.process && fx.crash.at_tick === r.tick;
      log(r.process, r.tick, r.end, died ? 'died' : 'completed', r.id, died ? 'the process stopped mid-run; its claim was not released' : null);
      if (!died && claim?.run === r.id) claim = null;
    }
    for (const p of fx.processes) {
      if (guard === 'per_process') {
        // noOverlap: only this process's own run holds the tick, and the skip leaves no record.
        if (inFlight.has(p)) continue;
      } else if (claim && claim.expires > t) {
        log(p, k, t, 'skipped', null, `overlap: ${fx.job} is held by ${claim.holder}, run ${claim.run}, until ${claim.expires}`);
        continue;
      }
      const took = guard === 'shared_claim' && claim ? `the previous claim, held by ${claim.holder}, expired` : null;
      const dies = fx.crash?.process === p && fx.crash.at_tick === k;
      const run: Run = { id: `${p}#${k}`, process: p, start: t, end: t + (dies ? Math.floor(fx.run_ms / 2) : fx.run_ms), tick: k };
      if (guard === 'shared_claim') claim = { holder: p, run: run.id, expires: t + fx.lease_ms };
      runs.push(run);
      open.push(run);
      inFlight.set(p, run);
      log(p, k, t, 'started', run.id, took);
    }
  }
  return { rows, runs };
}

const overlapping = (runs: Run[]): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const [i, a] of runs.entries()) for (const b of runs.slice(i + 1)) if (a.start < b.end && b.start < a.end) out.push([a.id, b.id]);
  return out;
};
// Every process's every tick must leave a row: a run that started, or a recorded skip.
const silent = (fx: OverlapFixture, rows: ActivityRow[]): string[] => fx.processes.flatMap((p) =>
  Array.from({ length: fx.ticks }, (_, k) => k).filter((k) => !rows.some((r) => r.process === p && r.tick === k && (r.result === 'started' || r.result === 'skipped'))).map((k) => `${p}@${k}`));

export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  job: string;
  rows: ActivityRow[];
  runs: Array<{ id: string; start_ms: number; end_ms: number }>;
  overlaps: Array<[string, string]>;
  silent_skips: string[];
  control: { overlaps: Array<[string, string]>; silent_skips: string[] };
  checks: { overrun_forced: boolean; no_two_runs_at_once: boolean; every_skip_recorded: boolean; recovers_after_a_crash: boolean };
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: OverlapFixture): Rehearsal {
  const mine = simulate(fx, 'shared_claim');
  const ctrl = simulate(fx, 'per_process');
  const overlaps = overlapping(mine.runs), silent_skips = silent(fx, mine.rows);
  // The control is not a check of its own: with an overrun forced, the per-process guard always skips with no
  // record, so it shows the difference rather than proving the harness can fail.
  const control = { overlaps: overlapping(ctrl.runs), silent_skips: silent(fx, ctrl.rows) };
  const died = mine.rows.find((r) => r.result === 'died');
  const checks = {
    overrun_forced: fx.run_ms > fx.interval_ms && mine.rows.some((r) => r.result === 'skipped'),
    no_two_runs_at_once: overlaps.length === 0,
    every_skip_recorded: silent_skips.length === 0,
    // After a run dies holding its claim, a later run starts once the lease runs out.
    recovers_after_a_crash: died !== undefined && mine.runs.some((r) => r.start >= died.at_ms && r.start > 0),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const skipped = mine.rows.filter((r) => r.result === 'skipped').length;
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, job: fx.job, rows: mine.rows,
    runs: mine.runs.map((r) => ({ id: r.id, start_ms: r.start, end_ms: r.end })), overlaps, silent_skips, control, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${fx.job} overran its interval on ${fx.processes.length} processes; no two runs overlapped, ${skipped} skipped tick(s) were each recorded with the run holding the claim, and a run started again after a crash once the lease ran out. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` The per-process guard on the same timeline let ${control.overlaps.length} pair(s) of runs overlap and skipped ${control.silent_skips.length} tick(s) with no record.`,
    limits: [...LIMITS],
  };
}

export function loadOverlapFixture(path: string): OverlapFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: OverlapFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const pos = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (typeof fx.fixture_id !== 'string' || typeof fx.job !== 'string' || !pos(fx.interval_ms) || !pos(fx.run_ms) || !pos(fx.lease_ms) || !pos(fx.ticks)
    || !Array.isArray(fx.processes) || fx.processes.length === 0) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, job, positive interval_ms, run_ms, lease_ms and ticks, and processes[]`);
  }
  if (fx.lease_ms <= fx.run_ms) throw new SandboxError('ContractViolation', `fixture ${path}: lease_ms must outlast run_ms, or a live run could lose its claim`);
  if (fx.crash && (!fx.processes.includes(fx.crash.process) || !Number.isInteger(fx.crash.at_tick))) throw new SandboxError('ContractViolation', `fixture ${path}: crash names an unknown process or tick`);
  return fx;
}
