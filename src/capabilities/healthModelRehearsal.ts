// platform.agent_health_scoring, rung R4: computes a corrected scoring model and verifies it over a sandbox fixture
// of agents with varied run and error histories. The platform's formula runs on the same rows as the control.
// The corrected model:
// - an agent with no counted run is unscored, never 100: what it should show is K.D.'s decision, so no number is
//   invented for it. If it has failures on record (it threw every time) it is unscored with failures, so it is
//   never buried among agents that simply have not run;
// - otherwise the score is the share of runs that did not fail, 100 * (1 - errors / runs), with no floor, so 50%
//   and 100% failing read differently;
// - status is not read, so the same counts cost every wrapper the same (only runAgent ever writes status error).
// Sandbox only: nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit a29dfb245):
// - healthScore = max(0, round(100 - (error_count / max(run_count, 1)) * 200 - (status 'error' ? 30 : 0)))
//   (backend/src/services/aiOpsService.ts:466-484). With no runs and no errors that is 100.
// - runAgent adds to error_count but not run_count when the agent throws (aiOrchestrator.ts:158-166, :300-312),
//   and is the only wrapper that writes status error; instrumentCronJob writes idle (cronInstrumentation.ts:74)
//   and trackAgentRun writes no status (agentRunTracker.ts:89-97).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { platformScore } from './agentHealthScoring.ts';

export const PINNED_AT = 'a29dfb245';
export const LIMITS: readonly string[] = [
  'The corrected model is Ellis\'s proposal. Adopting it, and what an unscored agent should show, are K.D.\'s decisions.',
  'Counters are lifetime totals, so the score is still about all runs ever, not how the agent is doing now.',
  'When error_count exceeds run_count, thrown failures were counted as errors but not runs, and the counters cannot say how many. The share is then taken over error_count, so the agent reads as all failing.',
  'Changing the platform\'s formula is a change to aiOpsService.ts and the registry tab, through a reviewed deploy by a person.',
];

export interface CountRow { run_count: number; error_count: number; status: string }
export interface ModelOutput { state: 'scored' | 'unscored' | 'unscored_with_failures'; score: number | null }
export interface Case { id: string; row: CountRow; expect: ModelOutput }
export interface ModelFixture { fixture_id: string; description: string; cases: Case[] }

export function correctedScore(r: CountRow): ModelOutput {
  if (r.run_count === 0) return { state: r.error_count > 0 ? 'unscored_with_failures' : 'unscored', score: null };
  const share = r.error_count / Math.max(r.run_count, r.error_count);
  return { state: 'scored', score: Math.round(100 * (1 - share)) };
}
// The platform scores every row, zero runs included.
export const platformOutput = (r: CountRow): ModelOutput => ({ state: 'scored', score: platformScore({ id: '', agent_name: '', enabled: true, ...r }) });

export type Model = 'corrected' | 'platform';
const MODELS: Record<Model, (r: CountRow) => ModelOutput> = { corrected: correctedScore, platform: platformOutput };

// The acceptance's two agents: one with no run, one with at least a hundred runs and no error.
const zeroRun = (c: Case) => c.row.run_count === 0 && c.row.error_count === 0;
const cleanHundred = (c: Case) => c.row.run_count >= 100 && c.row.error_count === 0;
const same = (a: ModelOutput, b: ModelOutput) => a.state === b.state && a.score === b.score;
const share = (r: CountRow) => r.error_count / Math.max(r.run_count, r.error_count);
const key = (r: CountRow) => `${r.run_count}/${r.error_count}`;

// The acceptance: the zero-run agent and the clean hundred-run agent get different outputs.
const tellsApart = (cases: Case[], out: (c: Case) => ModelOutput) => {
  const z = cases.filter(zeroRun), h = cases.filter(cleanHundred);
  return z.every((a) => h.every((b) => !same(out(a), out(b))));
};
// Among agents with runs, a higher failure share scores strictly lower.
const failuresOrdered = (cases: Case[], out: (c: Case) => ModelOutput) => {
  const ran = cases.filter((c) => c.row.run_count > 0);
  return ran.every((a) => ran.every((b) => share(a.row) <= share(b.row) || out(a).score! < out(b).score!));
};
// The same counts score the same, whatever the status says.
const statusIgnored = (cases: Case[], out: (c: Case) => ModelOutput) =>
  cases.every((a) => cases.every((b) => key(a.row) !== key(b.row) || same(out(a), out(b))));

export interface CaseResult { id: string; row: CountRow; expect: ModelOutput; subject: ModelOutput; control: ModelOutput }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  roles: { subject: Model; control: Model };
  cases: CaseResult[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

const show = (o: ModelOutput) => (o.state === 'scored' ? String(o.score) : o.state.replace(/_/g, ' '));

export function rehearse(fx: ModelFixture, roles: { subject: Model; control: Model } = { subject: 'corrected', control: 'platform' }): Rehearsal {
  const subj = (c: Case) => MODELS[roles.subject](c.row), ctrl = (c: Case) => MODELS[roles.control](c.row);
  const cases = fx.cases.map((c): CaseResult => ({ id: c.id, row: c.row, expect: c.expect, subject: subj(c), control: ctrl(c) }));
  const checks: Record<string, boolean> = {
    ...Object.fromEntries(cases.map((c) => [c.id, same(c.subject, c.expect)])),
    zero_run_and_clean_hundred_differ: tellsApart(fx.cases, subj),
    more_failures_score_lower: failuresOrdered(fx.cases, subj),
    same_counts_same_score: statusIgnored(fx.cases, subj),
    // The positive control: the control model gives the two acceptance agents the same output.
    control_fails_acceptance: !tellsApart(fx.cases, ctrl),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const z = cases.find((c) => zeroRun(c))!, h = cases.find((c) => cleanHundred(c))!;
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, roles, cases, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${cases.length} agents scored by the ${roles.subject} model. The zero-run agent (${z.id}) is ${show(z.subject)} and the clean ${h.row.run_count}-run agent (${h.id}) scores ${show(h.subject)}: different outputs. A higher failure share always scores lower, and the same counts score the same whatever the status. Adopting the model is K.D.'s decision. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` The ${roles.control} model gives ${z.id} ${show(z.control)} and ${h.id} ${show(h.control)}.`,
    limits: [...LIMITS],
  };
}

export function loadModelFixture(path: string): ModelFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: ModelFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
export function checkFixture(fx: ModelFixture, path: string): ModelFixture {
  // An empty cases[] is refused below, since it has no acceptance agents.
  if (typeof fx?.fixture_id !== 'string' || !Array.isArray(fx.cases)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id and cases[]`);
  }
  for (const c of fx.cases) {
    const e = c?.expect;
    // A missing counter is not a zero.
    const ok = typeof c?.id === 'string' && count(c.row?.run_count) && count(c.row.error_count) && typeof c.row.status === 'string'
      && (e?.state === 'unscored' || e?.state === 'unscored_with_failures' ? e.score === null : e?.state === 'scored' && Number.isInteger(e.score));
    if (!ok) throw new SandboxError('ContractViolation', `fixture ${path}: case ${c?.id ?? '?'} needs id, row { run_count, error_count (whole numbers), status } and expect { state, score }`);
  }
  if (new Set(fx.cases.map((c) => c.id)).size !== fx.cases.length) throw new SandboxError('ContractViolation', `fixture ${path}: each case id is listed once`);
  if (!fx.cases.some(zeroRun) || !fx.cases.some(cleanHundred)) throw new SandboxError('ContractViolation', `fixture ${path}: the acceptance needs a zero-run agent and an agent with at least 100 runs and no error`);
  return fx;
}
