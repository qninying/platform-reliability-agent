// platform.idempotency_and_replay_audit, first release behaviour (R1):
// builds the isolated fixtures and the twice-run harness for one job family (publishing), with a baseline that
// captures end state. The harness must catch a deliberately non-idempotent job as unsafe, or its result is refused.
// No verdict here is about a live job: these are fixture models, and every platform job stays unknown until it
// is run twice in a sandbox. Nothing is replayed against production, and no email or provider is reached.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - The publishing worker claims each job with an update conditional on the state it read
//   (services/publishing/publishingWorker.ts:290-295), so a second worker gets zero rows.
// - instrumentCronJob has no lock, in-flight set or claim, and the scheduler's options hold only a timezone
//   (aiOpsScheduler.ts:538, :549), so two concurrent runs of a timer are possible. Passing twice in a row does
//   not cover that case, so overlap is its own check here.

import { twiceRun, type Check, type Fixture, type Job } from '../sandbox/twiceRun.ts';
import { FIXTURE, NOTHING_DUE, claimedPublish, unclaimedPublish, unguardedPublish, brokenPublish } from '../sandbox/publishingJobs.ts';
import { scan, lineOf } from '../inventory/sourceScan.ts';
import type { Reader } from './registryReconciliation.ts';

export type Mechanism = 'optimistic_claim' | 'state_check_only' | 'none';
export type Verdict = 'safe' | 'safe_in_sequence_only' | 'unsafe' | 'unknown';
export interface FixtureJob { job: string; models: string; mechanism: Mechanism; expected: Verdict; verdict: Verdict; sequential: Check; overlap: Check }
export interface AuditAnswer {
  source_commit: string | null;
  family: 'publishing';
  verdict: 'harness_proven' | 'harness_cannot_fail';
  statement: string;
  claim_in_source: { file: string; line: number };
  fixture_jobs: FixtureJob[];
  platform_jobs: { verdict: 'unknown'; why: string };
  evidence_kind: 'twice_run_on_fixture';
  limits: string[];
}

const WORKER = 'backend/src/services/publishing/publishingWorker.ts';
export const LIMITS: readonly string[] = [
  'These verdicts are about fixture models. No platform job has a verdict yet: an untested job is unknown, whatever its code looks like.',
  'A job whose effect is an email or an external write cannot be double-run to test it, so any later verdict on one rests on a sandbox or on inspection, and says which.',
  'Overlap is tested at the points the job awaits, in one fixed order, so a pass does not cover every timing.',
  'A crash between the external effect and the state write is not tested here.',
  'Remediation ships through a reviewed deploy by a person. Ellis changes no job.',
];

interface Case { job: string; models: string; mechanism: Mechanism; expected: Verdict; run: Job; fixture: Fixture }
export const CASES: Case[] = [
  { job: 'claimed_publish', models: 'the worker\'s conditional claim', mechanism: 'optimistic_claim', expected: 'safe', run: claimedPublish, fixture: FIXTURE },
  { job: 'unclaimed_publish', models: 'the worker without its claim', mechanism: 'state_check_only', expected: 'safe_in_sequence_only', run: unclaimedPublish, fixture: FIXTURE },
  { job: 'unguarded_publish', models: 'deliberately non-idempotent', mechanism: 'none', expected: 'unsafe', run: unguardedPublish, fixture: FIXTURE },
  { job: 'nothing_to_do', models: 'a run that changes nothing', mechanism: 'optimistic_claim', expected: 'unknown', run: claimedPublish, fixture: NOTHING_DUE },
  { job: 'throws', models: 'a run that fails', mechanism: 'none', expected: 'unknown', run: brokenPublish, fixture: FIXTURE },
];

export function verdictOf(sequential: Check, overlap: Check): Verdict {
  if (sequential.mode === 'unsafe') return 'unsafe';
  if (sequential.mode === 'unknown') return 'unknown';
  if (overlap.mode === 'safe') return 'safe';
  return overlap.mode === 'unsafe' ? 'safe_in_sequence_only' : 'unknown';
}

// The model stands for this line. If the claim moves or goes, the model no longer stands for anything.
export function findClaim(r: Reader): { file: string; line: number } {
  const text = r.read(WORKER);
  const s = scan(text);
  const at = s.code.search(/where:\s*\{\s*id:\s*job\.id,\s*state:\s*previous\s*\}/);
  if (at < 0) throw new Error(`the conditional claim is no longer in ${WORKER}; the publishing model needs re-reading`);
  return { file: WORKER, line: lineOf(s.code, at) };
}

export async function audit(r: Reader, commit: string | null, cases: Case[] = CASES): Promise<AuditAnswer> {
  const claim_in_source = findClaim(r);
  const fixture_jobs: FixtureJob[] = [];
  for (const c of cases) {
    const { sequential, overlap } = await twiceRun(c.run, c.fixture);
    fixture_jobs.push({ job: c.job, models: c.models, mechanism: c.mechanism, expected: c.expected, verdict: verdictOf(sequential, overlap), sequential, overlap });
  }
  const wrong = fixture_jobs.filter((j) => j.verdict !== j.expected);
  const caught = fixture_jobs.some((j) => j.verdict === 'unsafe');
  const proven = caught && !wrong.length;
  return {
    source_commit: commit, family: 'publishing',
    verdict: proven ? 'harness_proven' : 'harness_cannot_fail',
    statement: proven
      ? `The harness caught the deliberately unsafe job and told all ${fixture_jobs.length} fixture jobs apart. This proves the harness, not any platform job: all stay unknown.`
      : `The harness did not tell the fixture jobs apart (${wrong.map((j) => j.job).join(', ') || 'no unsafe job caught'}), so nothing it says can be relied on.`,
    claim_in_source, fixture_jobs,
    platform_jobs: { verdict: 'unknown', why: 'No platform job has been run twice in a sandbox yet.' },
    evidence_kind: 'twice_run_on_fixture',
    limits: [...LIMITS],
  };
}
