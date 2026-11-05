// platform.error_class_coverage, rung R4: classifies the cron path in a sandbox and verifies grouping against seeded
// failures of several kinds. Ellis's classifier reads what a failure is (its code, its HTTP status, the name its
// library gives it), not the class it was thrown as, and maps it to the six classes the platform standard names.
// What it cannot place is recorded as Unclassified and counts against coverage. A sandbox cron wrapper persists the
// class beside the message and stack. The platform's only rule, run on the same seeds, is the control.
// Sandbox only: nothing runs on the platform.
//
// Platform facts this rests on (platform repo, commit bc936a315):
// - The cron path records the message and stack and no class (backend/src/services/cronInstrumentation.ts:63-64),
//   and writes details: null (:96).
// - The one rule that records a class is the dead-letter path's err?.constructor?.name || err?.name || 'Error'
//   (backend/src/services/deadLetterService.ts:46).
// - The standard names TimeoutError, RateLimitError, AuthError, ValidationError, UpstreamUnavailable and
//   ContractViolation, and calls a generic Error unacceptable (CLAUDE.md:672).

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { isGeneric, NAMED, type ActivityRow } from './errorClassCoverage.ts';

export const PINNED_AT = 'bc936a315';
export const UNCLASSIFIED = 'Unclassified';
export const LIMITS: readonly string[] = [
  'The vocabulary is the six classes the platform standard names. Agreeing it is K.D.\'s decision; until then these classes are a starting point, not a ruling.',
  'The classifier reads codes, HTTP statuses and library error names. A failure that carries none of them, such as a plain Error with only a message, is Unclassified: messages are not parsed, because a guess from wording would group wrongly.',
  'The seeds are shaped like the errors of common libraries (axios, fetch, undici, zod, Sequelize). An error from another library may carry its signal elsewhere.',
  'Persisting the class on the platform is a change to cronInstrumentation.ts and ships through a reviewed deploy by a person.',
];

export interface SeedError { thrown_as: string; name?: string; message: string; code?: string; status?: number; response_status?: number }
export interface Seed { id: string; kind: string; error: SeedError; expect: string }
export interface ClassFixture { fixture_id: string; description: string; job: string; seeds: Seed[] }

// The three kinds the acceptance names, and the class each must land in.
export const ACCEPTANCE_KINDS: Record<string, string> = { timeout: 'TimeoutError', rate_limit: 'RateLimitError', validation: 'ValidationError' };

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const TIMEOUT_NAMES = new Set(['TimeoutError', 'AbortError', 'SequelizeConnectionAcquireTimeoutError']);
const VALIDATION_NAMES = new Set(['ValidationError', 'ZodError', 'SequelizeValidationError', 'SequelizeUniqueConstraintError']);
const UPSTREAM_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH']);

// The error a seeded job throws: an instance of the class it was thrown as, with its library's fields.
export function thrown(e: SeedError): Error {
  const Cls = { [e.thrown_as]: class extends Error {} }[e.thrown_as];
  const err = new Cls(e.message) as Error & { code?: string; status?: number; response?: { status: number } };
  if (e.name) err.name = e.name;
  if (e.code) err.code = e.code;
  if (e.status) err.status = e.status;
  if (e.response_status) err.response = { status: e.response_status };
  return err;
}

// Ellis's rule: what the failure is, in a fixed order. A class already set from the vocabulary is kept.
export function classify(err: unknown): string {
  const e = (err ?? {}) as { name?: string; code?: string; status?: number; statusCode?: number; response?: { status?: number }; errorClass?: string; error_class?: string };
  const set = e.errorClass ?? e.error_class;
  if (set && NAMED.has(set)) return set;
  const status = e.response?.status ?? e.status ?? e.statusCode;
  if ((e.code && TIMEOUT_CODES.has(e.code)) || (e.name && TIMEOUT_NAMES.has(e.name)) || status === 408) return 'TimeoutError';
  if (status === 429) return 'RateLimitError';
  if (status === 401 || status === 403) return 'AuthError';
  if ((e.name && VALIDATION_NAMES.has(e.name)) || status === 400 || status === 422) return 'ValidationError';
  if ((e.code && UPSTREAM_CODES.has(e.code)) || (status !== undefined && status >= 500)) return 'UpstreamUnavailable';
  if (e.name === 'ContractViolation') return 'ContractViolation';
  return UNCLASSIFIED;
}

// The platform's rule (deadLetterService.ts:46).
export function platformClass(err: unknown): string {
  const e = err as { constructor?: { name?: string }; name?: string } | null;
  return e?.constructor?.name || e?.name || 'Error';
}

export type Rule = 'ellis' | 'platform';
const RULES: Record<Rule, (err: unknown) => string> = { ellis: classify, platform: platformClass };

// The sandbox cron wrapper: runs the job and, on failure, writes an activity row with the class beside the message.
export function runCron(job: string, seeds: Seed[], rule: Rule): Array<ActivityRow & { reason: string }> {
  return seeds.map((s, i) => {
    try {
      throw thrown(s.error);
    } catch (err) {
      return { id: `${job}-run-${i + 1}`, action: job, result: 'failed', reason: (err as Error).message, details: { error_class: RULES[rule](err) }, created_at: `seed:${s.id}` };
    }
  });
}

export interface SeedResult { id: string; kind: string; expect: string; ellis: string; platform: string }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  seeds: SeedResult[];
  coverage: { failures: number; classified: number; share: number };
  platform_coverage: { failures: number; classified: number; share: number };
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

const measure = (rows: ActivityRow[]) => {
  const classified = rows.filter((r) => !isGeneric(r.details?.error_class)).length;
  return { failures: rows.length, classified, share: rows.length ? classified / rows.length : 0 };
};
// The acceptance kinds land in one class each, distinct from one another, and none is generic.
const groups = (seeds: Seed[], classOf: (s: Seed) => string): Record<string, string[]> =>
  Object.fromEntries(Object.keys(ACCEPTANCE_KINDS).map((k) => [k, [...new Set(seeds.filter((s) => s.kind === k).map(classOf))]]));
const groupsApart = (g: Record<string, string[]>): boolean => {
  const all = Object.values(g);
  return all.every((cs) => cs.length === 1 && !isGeneric(cs[0])) && new Set(all.map((cs) => cs[0])).size === all.length;
};

export function rehearse(fx: ClassFixture, roles: { subject: Rule; control: Rule } = { subject: 'ellis', control: 'platform' }): Rehearsal {
  const mine = runCron(fx.job, fx.seeds, roles.subject);
  const ctrl = runCron(fx.job, fx.seeds, roles.control);
  const cls = (rows: typeof mine, i: number) => String(rows[i].details!.error_class);
  const seeds = fx.seeds.map((s, i): SeedResult => ({ id: s.id, kind: s.kind, expect: s.expect, ellis: cls(mine, i), platform: cls(ctrl, i) }));
  const at = (rows: typeof mine) => (s: Seed) => cls(rows, fx.seeds.indexOf(s));
  const g = groups(fx.seeds, at(mine));
  const cg = groups(fx.seeds, at(ctrl));
  // Each seed's class is read back from the row the wrapper persisted, so coverage is measured on what was written.
  const checks: Record<string, boolean> = {
    ...Object.fromEntries(seeds.map((s) => [s.id, s.ellis === s.expect])),
    // The acceptance: seeded timeout, rate-limit and validation failures land in three distinct classes, none generic.
    three_kinds_three_classes: groupsApart(g),
    // The positive control: the platform's rule does not group the same seeds apart.
    control_fails_acceptance: !groupsApart(cg),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const coverage = measure(mine), platform_coverage = measure(ctrl);
  const pct = (c: { share: number }) => `${Math.round(c.share * 100)}%`;
  const show = (x: Record<string, string[]>) => Object.entries(x).map(([k, cs]) => `${k} as ${cs.join(' or ')}`).join(', ');
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, seeds, coverage, platform_coverage, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${fx.seeds.length} seeded failures of ${fx.job} were classified and persisted with their message. ${show(g)}: three distinct classes, none generic. Coverage over all ${coverage.failures} failures is ${coverage.classified} (${pct(coverage)}); the rest is recorded as ${UNCLASSIFIED} and counts against it. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` The platform's rule on the same seeds recorded ${show(cg)}, and classified ${platform_coverage.classified} of ${platform_coverage.failures} (${pct(platform_coverage)}); its cron path records no class at all.`,
    limits: [...LIMITS],
  };
}

export function loadClassFixture(path: string): ClassFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: ClassFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

const CLASS_NAME = /^[A-Za-z_$][\w$]*$/;
export function checkFixture(fx: ClassFixture, path: string): ClassFixture {
  if (typeof fx.fixture_id !== 'string' || typeof fx.job !== 'string' || !Array.isArray(fx.seeds) || fx.seeds.length === 0) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, job and a non-empty seeds[]`);
  }
  for (const s of fx.seeds) {
    const e = s?.error;
    const ok = typeof s?.id === 'string' && typeof s.kind === 'string' && typeof s.expect === 'string'
      && typeof e?.thrown_as === 'string' && CLASS_NAME.test(e.thrown_as) && typeof e.message === 'string';
    if (!ok) throw new SandboxError('ContractViolation', `fixture ${path}: seed ${s?.id ?? '?'} needs id, kind, expect and error { thrown_as (a class name), message }`);
  }
  for (const k of Object.keys(ACCEPTANCE_KINDS)) {
    if (!fx.seeds.some((s) => s.kind === k)) throw new SandboxError('ContractViolation', `fixture ${path}: no seed of kind ${k}, which the acceptance names`);
  }
  return fx;
}
