// platform.idempotency_and_replay_audit, rung R4: runs the twice-run comparison across the enumerated job families
// and gives each job a verdict: safe, unsafe, or untestable in a sandbox, each with its reason. A job is safe only
// when two runs in a row and two runs at once both end where one run ends; a guard in its code earns it nothing on
// its own. The deliberately unsafe job from R1 runs alongside, so the harness is shown able to fail.
// Sandbox only: nothing runs on the platform.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { twiceRun, type Check, type Fixture, type Job } from '../sandbox/twiceRun.ts';
import { claimedPublish, unguardedPublish, FIXTURE as PUBLISH_FIXTURE } from '../sandbox/publishingJobs.ts';
import { staleRecovery, previewReaper, retentionSweep, STALE_FIXTURE, REAP_FIXTURE, RETENTION_FIXTURE } from '../sandbox/platformJobs.ts';

export const PINNED_AT = '29bdbb61b';
export const LIMITS: readonly string[] = [
  'Each verdict is about a sandbox model of the job, built from the lines it cites. The job itself was not run.',
  'Overlap is tested at the points the job awaits, in one fixed order. A SQL statement is taken as one step; two statements truly at once under the database\'s isolation are not run.',
  'A crash between an external effect and the state write is not tested.',
  'An unsafe verdict is a finding for the job\'s owner; the fix ships through a reviewed deploy by a person. Ellis changes no job.',
];

export type Verdict = 'safe' | 'unsafe' | 'untestable_in_sandbox';
export interface FamilyRef { job: string; family: string; cites: string[]; guard_in_code: string }
interface Modelled extends FamilyRef { run: Job; fixture: Fixture }
interface Untestable extends FamilyRef { untestable: string }

// The registry of job models, by name. A fixture names which of these it enumerates and what it expects.
export const MODELS: Record<string, Modelled | Untestable> = {
  publishing_worker: { job: 'publishing_worker', family: 'publishing', cites: ['backend/src/services/publishing/publishingWorker.ts:290-294'], guard_in_code: 'an update conditional on the state it read', run: claimedPublish, fixture: PUBLISH_FIXTURE },
  stale_action_recovery: { job: 'stale_action_recovery', family: 'scheduled email recovery', cites: ['backend/src/services/scheduling/claimLease.ts:87-111'], guard_in_code: 'one UPDATE per outcome, conditional on status processing', run: staleRecovery, fixture: STALE_FIXTURE },
  preview_stack_reaper: { job: 'preview_stack_reaper', family: 'preview stacks', cites: ['backend/src/services/previewStackReaper.ts:18-38', 'backend/src/services/previewStackService.ts:299-308'], guard_in_code: 'stopStack returns early when the stack is not running', run: previewReaper, fixture: REAP_FIXTURE },
  intelligence_retention: { job: 'intelligence_retention', family: 'retention', cites: ['backend/src/services/cory/intelligenceRetention.ts:17', 'backend/src/services/cory/intelligenceRetention.ts:50-55', 'backend/src/services/cory/intelligenceRetention.ts:74-79'], guard_in_code: 'archive skips decisions already archived (NOT IN)', run: retentionSweep, fixture: RETENTION_FIXTURE },
  openclaw_content_response: {
    job: 'openclaw_content_response', family: 'outreach content', cites: ['backend/src/services/agents/openclaw/openclawContentResponseAgent.ts:99', 'backend/src/services/agents/openclaw/openclawContentResponseAgent.ts:447'], guard_in_code: 'not read',
    untestable: 'its end state holds text a model writes on each run (the chat completion at :447), so two runs differ whether or not the job repeats itself; a stubbed model would test the stub, not the job',
  },
  // The R1 job built to be unsafe. It stands for no platform job: if it passes, the harness cannot fail.
  harness_control: { job: 'harness_control', family: 'control', cites: [], guard_in_code: 'none, by design', run: unguardedPublish, fixture: PUBLISH_FIXTURE },
};

export interface JobVerdict extends FamilyRef { verdict: Verdict | 'unknown'; reason: string; expect: Verdict; sequential: Check | null; overlap: Check | null }

const diffs = (c: Check) => c.differences.slice(0, 3).join('; ');
// Safe needs both comparisons run and matching. Anything the harness could not settle is unknown, not a verdict.
export function verdictOf(sequential: Check, overlap: Check): { verdict: Verdict | 'unknown'; reason: string } {
  if (sequential.mode === 'unknown' || overlap.mode === 'unknown') return { verdict: 'unknown', reason: sequential.mode === 'unknown' ? sequential.why : overlap.why };
  if (sequential.mode === 'unsafe') return { verdict: 'unsafe', reason: `a second run in a row changed the end state: ${diffs(sequential)}` };
  if (overlap.mode === 'unsafe') return { verdict: 'unsafe', reason: `safe twice in a row, but two runs at once changed the end state: ${diffs(overlap)}. The cron path has no overlap guard, so two runs at once can happen.` };
  return { verdict: 'safe', reason: 'two runs in a row and two runs at once each ended where one run ends' };
}

export interface AuditFixture { fixture_id: string; description: string; jobs: Array<{ job: string; expect: Verdict }> }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  jobs: JobVerdict[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export async function rehearse(fx: AuditFixture, models: Record<string, Modelled | Untestable> = MODELS): Promise<Rehearsal> {
  const jobs: JobVerdict[] = [];
  for (const { job, expect } of fx.jobs) {
    const m = models[job];
    const ref: FamilyRef = { job: m.job, family: m.family, cites: m.cites, guard_in_code: m.guard_in_code };
    if ('untestable' in m) {
      jobs.push({ ...ref, verdict: 'untestable_in_sandbox', reason: m.untestable, expect, sequential: null, overlap: null });
      continue;
    }
    const { sequential, overlap } = await twiceRun(m.run, m.fixture);
    jobs.push({ ...ref, ...verdictOf(sequential, overlap), expect, sequential, overlap });
  }
  // No job is safe on the strength of a guard in its code: verdictOf gives safe only when both comparisons ran and matched.
  const checks: Record<string, boolean> = {
    ...Object.fromEntries(jobs.map((j) => [j.job, j.verdict === j.expect])),
    // If it cannot fail, it cannot pass: some job in the run must come out unsafe.
    harness_caught_an_unsafe_job: jobs.some((j) => j.verdict === 'unsafe'),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const named = (v: string) => jobs.filter((j) => j.verdict === v && j.family !== 'control').map((j) => j.job);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, jobs, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${jobs.filter((j) => j.family !== 'control').length} platform jobs across their families, each run twice in a row and twice at once. Safe: ${named('safe').join(', ') || 'none'}. Unsafe: ${named('unsafe').join(', ') || 'none'}. Untestable in a sandbox: ${named('untestable_in_sandbox').join(', ') || 'none'}. The deliberately unsafe control was caught. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`),
    limits: [...LIMITS],
  };
}

export function loadAuditFixture(path: string): AuditFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: AuditFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const VERDICTS: Verdict[] = ['safe', 'unsafe', 'untestable_in_sandbox'];
export function checkFixture(fx: AuditFixture, path: string): AuditFixture {
  if (typeof fx.fixture_id !== 'string' || !Array.isArray(fx.jobs) || fx.jobs.length === 0) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id and a non-empty jobs[]`);
  }
  for (const j of fx.jobs) {
    if (!(typeof j?.job === 'string' && j.job in MODELS)) throw new SandboxError('ContractViolation', `fixture ${path}: job ${j?.job ?? '?'} is not a modelled job (${Object.keys(MODELS).join(', ')})`);
    if (!VERDICTS.includes(j.expect)) throw new SandboxError('ContractViolation', `fixture ${path}: job ${j.job} needs expect, one of ${VERDICTS.join(', ')}`);
  }
  if (new Set(fx.jobs.map((j) => j.job)).size !== fx.jobs.length) throw new SandboxError('ContractViolation', `fixture ${path}: each job is listed once`);
  return fx;
}
