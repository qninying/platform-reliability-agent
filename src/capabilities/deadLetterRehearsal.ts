// platform.dead_letter_capture, rung R4: exercises the capture path end to end against a sandbox job seeded to
// fail, and again across a simulated restart. The capture logic is the platform's, run in the sandbox with a
// sandbox table: count consecutive failures in memory, write one row on the third, clear the count after the
// write. A counter that survives a restart runs on the same steps as the contrast, so the restart check can fail.
// Sandbox only: nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit 350243226):
// - wrapWithDeadLetter (backend/src/services/deadLetterService.ts:25) counts consecutive failures in a
//   module-scope Map (:19), resets it on success (:32), and writes a dead_letter_jobs row when the count reaches
//   MAX_CONSECUTIVE_FAILURES = 3 (:17, :39-51), with error_class err?.constructor?.name || err?.name || 'Error'
//   (:46). The count is cleared after the write (:59), whether or not the write succeeded: a failed write is
//   only logged (:53-58).
// - The count resets on process restart, and the file's header calls that intended (:11-13).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = '350243226';
export const THRESHOLD = 3;
export const LIMITS: readonly string[] = [
  'The capture logic is the platform\'s, run in the sandbox against a sandbox table; the real wrapper and the real dead_letter_jobs table were not run.',
  'One job, failing with one error class. Two processes failing the same job, each with its own counter, are not run.',
  'Whether a restart should reset the count is the platform\'s stated choice (deadLetterService.ts:11-13). The durable counter is the contrast that shows the check can fail, not a proposed change.',
  'Nothing reads dead_letter_jobs on the platform; a row written is recorded, not seen. Reading it is the triage capability.',
];

export interface DeadLetterFixture { fixture_id: string; description: string; job_name: string; label: string; error: { class: string; message: string } }
export type Step = 'fail' | 'ok' | 'restart' | 'fail_write';
export type Counter = 'in_memory' | 'durable';
export interface DeadLetterRow { seq: number; job_name: string; label: string; consecutive_failures: number; error_class: string; error_message: string }
export interface Run { rows: DeadLetterRow[]; swallowed: number }

// The error the seeded job throws: an instance of a class with the name the fixture gives.
function seededError(fx: DeadLetterFixture): Error {
  const Cls = { [fx.error.class]: class extends Error {} }[fx.error.class];
  return new Cls(fx.error.message);
}
// The platform's rule (deadLetterService.ts:46): the class's name, then the error's name, then 'Error'.
export const classOf = (err: unknown): string => {
  const e = err as { constructor?: { name?: string }; name?: string } | null;
  return e?.constructor?.name || e?.name || 'Error';
};

// One sandbox process at a time. 'fail_write' fails the job and, if a row is due, fails the table write.
export function capture(fx: DeadLetterFixture, steps: Step[], counter: Counter): Run {
  const rows: DeadLetterRow[] = [];
  let counts = new Map<string, number>();
  let swallowed = 0;
  for (const step of steps) {
    if (step === 'restart') {
      if (counter === 'in_memory') counts = new Map();
      continue;
    }
    if (step === 'ok') {
      counts.delete(fx.job_name);
      continue;
    }
    const err = seededError(fx);
    const count = (counts.get(fx.job_name) ?? 0) + 1;
    counts.set(fx.job_name, count);
    if (count >= THRESHOLD) {
      // As on the platform, a failed write is only logged, and the count is cleared either way.
      if (step === 'fail_write') swallowed++;
      else rows.push({ seq: rows.length + 1, job_name: fx.job_name, label: fx.label, consecutive_failures: count, error_class: classOf(err), error_message: err.message });
      counts.delete(fx.job_name);
    }
  }
  return { rows, swallowed };
}

// Each case with the rows the platform's logic should write.
export const CASES: Record<string, { steps: Step[]; expect: number }> = {
  three_consecutive: { steps: ['fail', 'fail', 'fail'], expect: 1 },
  restart_between_two_and_three: { steps: ['fail', 'fail', 'restart', 'fail'], expect: 0 },
  success_between: { steps: ['fail', 'fail', 'ok', 'fail'], expect: 0 },
  six_consecutive: { steps: ['fail', 'fail', 'fail', 'fail', 'fail', 'fail'], expect: 2 },
  write_fails_on_third: { steps: ['fail', 'fail', 'fail_write', 'fail', 'fail', 'fail'], expect: 1 },
};

export interface CaseResult { id: string; steps: Step[]; expect: number; rows: DeadLetterRow[]; swallowed: number; contrast_rows: number }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  cases: CaseResult[];
  // One check per case (it wrote the rows expected), plus the contrast and the recorded error class.
  checks: Record<keyof typeof CASES | 'contrast_writes_after_restart' | 'error_class_recorded', boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

// The platform's counter is the subject and a durable one the contrast. Swapping them shows the checks can fail.
export function rehearse(fx: DeadLetterFixture, roles: { subject: Counter; contrast: Counter } = { subject: 'in_memory', contrast: 'durable' }): Rehearsal {
  const cases = Object.entries(CASES).map(([id, { steps, expect }]): CaseResult => {
    const run = capture(fx, steps, roles.subject);
    return { id, steps, expect, rows: run.rows, swallowed: run.swallowed, contrast_rows: capture(fx, steps, roles.contrast).rows.length };
  });
  const restart = cases.find((x) => x.id === 'restart_between_two_and_three')!;
  const checks = {
    // restart_between_two_and_three expects none: the acceptance's positive control for the in-memory counter.
    ...Object.fromEntries(cases.map((x) => [x.id, x.rows.length === x.expect])),
    // A counter that survives the restart writes the row, so the case can tell the two apart.
    contrast_writes_after_restart: restart.contrast_rows === 1,
    error_class_recorded: cases.every((x) => x.rows.every((row) => row.error_class === fx.error.class)),
  } as Rehearsal['checks'];
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, cases, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}: three consecutive failures of ${fx.job_name} wrote exactly one row, with error_class ${fx.error.class}. A restart between failures two and three wrote none, where a counter that survives the restart writes one. A success in between wrote none, six failures wrote two, and a failed write on the third left no row and no error, so three more failures were needed. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

export function loadDeadLetterFixture(path: string): DeadLetterFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: DeadLetterFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

export function checkFixture(fx: DeadLetterFixture, path: string): DeadLetterFixture {
  const text = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!text(fx.fixture_id) || !text(fx.job_name) || !text(fx.label) || !text(fx.error?.class) || typeof fx.error?.message !== 'string') {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, job_name, label and error { class, message }`);
  }
  return fx;
}
