// platform.scheduler_registration_liveness_probe, rung R4: builds the probe and verifies it against a sandbox
// process started with the scheduler flag unset. At boot the process records how many timers it actually
// registered; the probe returns 503 when that count is zero or below a pinned floor, and 200 with the count when
// it is not. The platform's GET /health runs on the same cases as the control. Sandbox only: nothing runs on the
// platform.
//
// Platform facts this rests on (platform repo, commit 350243226):
// - One flag gates every timer: enableFollowUpScheduler is process.env.ENABLE_FOLLOWUP_SCHEDULER === 'true'
//   (backend/src/config/env.ts:182), and startScheduler() runs only under it (backend/src/server.ts:3701).
//   startScheduler() is the only caller of startAIOpsScheduler (backend/src/services/schedulerService.ts:3417).
// - GET /health runs SELECT 1 and nothing else (backend/src/routes/healthRoutes.ts:7-15): 200 while the database
//   answers, 503 when it does not. It never consults the scheduler.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = '350243226';
export const LIMITS: readonly string[] = [
  'A registered count is not a fired count: a timer can register and never fire. The probe detects non-registration and does not claim to detect non-execution; the heartbeat check in GET /health/full stays the second signal.',
  'The floor is the fixture\'s. The expected count, and how far below it the probe fails, are K.D.\'s to set and must be pinned, not derived from the registries the count comes from.',
  'Timers registered outside the task registry are not counted here, so the platform\'s own scheduled count is not a trustworthy denominator.',
  'Changing what GET /health returns changes what external monitoring treats as an outage. Shipping it is a reviewed deploy by a person.',
];

export interface LivenessFixture {
  fixture_id: string;
  description: string;
  registry: string[];
  pinned_expected: number;
  min_registered: number;
  // Values of ENABLE_FOLLOWUP_SCHEDULER that leave it unset; null means the variable is absent.
  unset_values: Array<string | null>;
  // Timers whose registration throws in the shortfall case.
  fail_to_register: string[];
}

export interface Process { flag: string | null; db_healthy: boolean; registered: string[] }
export interface Response { status: number; body: { status: 'ok' | 'error'; detail: string | null; registered?: number; expected?: number } }
export type Probe = 'ellis' | 'platform';

// The platform's own parse: only the exact string 'true' starts the scheduler.
export const flagOn = (v: string | null): boolean => v === 'true';

export function bootProcess(fx: LivenessFixture, flag: string | null, db_healthy: boolean, failing: string[] = []): Process {
  const registered = flagOn(flag) ? fx.registry.filter((n) => !failing.includes(n)) : [];
  return { flag, db_healthy, registered };
}

export function probe(p: Process, fx: LivenessFixture, which: Probe): Response {
  if (!p.db_healthy) return { status: 503, body: { status: 'error', detail: 'database unreachable' } };
  if (which === 'platform') return { status: 200, body: { status: 'ok', detail: null } };
  const n = p.registered.length, expected = fx.pinned_expected;
  if (n === 0) return { status: 503, body: { status: 'error', detail: `no timers registered at boot (ENABLE_FOLLOWUP_SCHEDULER is ${p.flag === null ? 'absent' : JSON.stringify(p.flag)})`, registered: n, expected } };
  if (n < fx.min_registered) return { status: 503, body: { status: 'error', detail: `${n} timers registered at boot, below the pinned floor of ${fx.min_registered}`, registered: n, expected } };
  return { status: 200, body: { status: 'ok', detail: null, registered: n, expected } };
}

// expect is what a probe that sees registration should return: 200 only with the database up and the floor met.
export interface Case { id: string; flag: string | null; db_healthy: boolean; registered: number; expect: 200 | 503; ellis: Response; platform: Response }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  cases: Case[];
  checks: {
    flag_unset_fails_probe: boolean;
    positive_control_returns_200: boolean;
    healthy_process_passes: boolean;
    shortfall_fails_probe: boolean;
  };
  verified: boolean;
  statement: string;
  limits: string[];
}

// The probe under test is the subject and GET /health the control. Swapping them shows the checks can fail.
export function rehearse(fx: LivenessFixture, roles: { subject: Probe; control: Probe } = { subject: 'ellis', control: 'platform' }): Rehearsal {
  const run = (id: string, p: Process): Case => ({
    id, flag: p.flag, db_healthy: p.db_healthy, registered: p.registered.length,
    expect: p.db_healthy && p.registered.length >= fx.min_registered ? 200 : 503, ellis: probe(p, fx, roles.subject), platform: probe(p, fx, roles.control),
  });
  const unset = fx.unset_values.map((v) => run(`flag_${v === null ? 'absent' : JSON.stringify(v)}_db_healthy`, bootProcess(fx, v, true)));
  const healthy = run('flag_true_db_healthy', bootProcess(fx, 'true', true));
  const short = run('flag_true_some_fail_to_register', bootProcess(fx, 'true', true, fx.fail_to_register));
  const down = [run('flag_true_db_down', bootProcess(fx, 'true', false)), run('flag_absent_db_down', bootProcess(fx, null, false))];
  const cases = [...unset, healthy, short, ...down];
  const checks = {
    flag_unset_fails_probe: unset.length > 0 && unset.every((c) => c.ellis.status !== 200),
    // The acceptance names this the exact case the current probe returns 200 for.
    positive_control_returns_200: unset.length > 0 && unset.every((c) => c.platform.status === 200),
    // Fails when the floor is above what the registry can register: the probe would never pass.
    healthy_process_passes: healthy.ellis.status === 200,
    // The failures must leave some timers registered, or this is the flag case again.
    shortfall_fails_probe: short.registered > 0 && short.ellis.status !== 200,
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const p200 = cases.filter((c) => c.platform.status === 200 && c.expect !== 200).length;
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, cases, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: with ENABLE_FOLLOWUP_SCHEDULER unset in ${unset.length} way(s) and the database healthy, no timer registered and the probe returned 503 each time. A process that registered all ${healthy.registered} returned 200, one that registered ${short.registered}, below the floor of ${fx.min_registered}, returned 503, and a down database returned 503 as before. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` GET /health on the same cases returned 200 in ${p200} case(s) where too few timers had registered.`,
    limits: [...LIMITS],
  };
}

export function loadLivenessFixture(path: string): LivenessFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: LivenessFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

export function checkFixture(fx: LivenessFixture, path: string): LivenessFixture {
  const strings = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (typeof fx.fixture_id !== 'string' || !strings(fx.registry) || fx.registry.length === 0 || !strings(fx.fail_to_register)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, a non-empty registry[] of names and fail_to_register[]`);
  }
  if (!Number.isInteger(fx.pinned_expected) || !Number.isInteger(fx.min_registered) || fx.min_registered < 1 || fx.min_registered > fx.pinned_expected) {
    throw new SandboxError('ContractViolation', `fixture ${path}: min_registered must be a whole number from 1 to pinned_expected`);
  }
  if (!Array.isArray(fx.unset_values) || !fx.unset_values.every((v) => v === null || (typeof v === 'string' && !flagOn(v)))) {
    throw new SandboxError('ContractViolation', `fixture ${path}: unset_values must be null or strings other than 'true'`);
  }
  return fx;
}
