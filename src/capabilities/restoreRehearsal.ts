// platform.backup_and_restore_verification, rung R3: on an operator's request, restores a supplied backup into an
// isolated sandbox target and asserts it answers known queries. Isolation is proven before the restore begins. Two
// truncated copies of the same backup run as the positive control, so the assertion is shown able to fail: one cut
// inside a statement, which cannot restore, and one cut cleanly between statements, which restores without an
// error and answers wrongly, so that "it restored" alone is shown not to be enough.
// Sandbox only: Ellis never takes or reads a production backup; a person supplies the artefact.
//
// Platform facts this rests on (platform repo, commit a29dfb245):
// - No backup policy exists to verify against, and no backup verification exists in the repository (the R2 answer).
// - production_database is default-denied (delivery/execution/executionPolicy.ts:35), so taking or reading a production
//   backup is a person's action.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { isolated, newTarget, proveIsolation, restore, runQueries, type Isolation } from '../sandbox/sandboxRestore.ts';

export const PINNED_AT = 'a29dfb245';
export const LIMITS: readonly string[] = [
  'The backup is SQL restored into SQLite. A platform backup is a Postgres dump restored with Postgres tools; restoring one needs both, and the artefact needs production_database, which is default-denied.',
  'The known queries are the fixture\'s. A real verification needs queries K.D. and A.M. agree answer for the platform, with the recovery objective, destination and cadence they have not yet set.',
  'A restore that answers its queries shows the backup holds those answers. It does not show the backup is current, complete beyond what is queried, or taken on schedule.',
  'Taking, reading and restoring a production backup, and keeping or rotating backups, are a person\'s actions.',
];

export interface KnownQuery { id: string; sql: string; expect: unknown[] }
export interface RestoreFixture { fixture_id: string; description: string; artefact: string; queries: KnownQuery[] }
export type Attempt = 'full' | 'truncated_mid_statement' | 'truncated_at_statement_boundary';

// Statements end with ";" at the end of a line. Returns the offset just after each one.
const ends = (sql: string) => [...sql.matchAll(/;\n/g)].map((m) => m.index! + 2);

// The two truncated copies, cut at fixed places so a run is repeatable.
export function truncations(sql: string): Record<Exclude<Attempt, 'full'>, string> {
  const e = ends(sql);
  const k = Math.floor(e.length * 0.6);
  return {
    // Halfway through a statement past the middle of the backup.
    truncated_mid_statement: sql.slice(0, e[k - 1] + Math.floor((e[k] - e[k - 1]) / 2)),
    // Every statement but the last.
    truncated_at_statement_boundary: sql.slice(0, e[e.length - 2]),
  };
}

export interface AttemptResult {
  attempt: Attempt;
  bytes: number;
  isolation: Isolation;
  // Refused when isolation was not proven: the restore is never begun.
  refused: boolean;
  restored: boolean;
  error: string | null;
  answers: Array<{ id: string; ok: boolean; rows: unknown[] | null; error: string | null }>;
  answered: boolean;
}
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  initiated_by: string;
  attempts: AttemptResult[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

function attempt(name: Attempt, sql: string, artefactPath: string, queries: KnownQuery[], sandboxRoot: string): AttemptResult {
  const t = newTarget(sandboxRoot, `${name}.sqlite`);
  const isolation = proveIsolation(t, artefactPath, sql);
  const base = { attempt: name, bytes: Buffer.byteLength(sql), isolation };
  if (!isolated(isolation)) return { ...base, refused: true, restored: false, error: null, answers: [], answered: false };
  const r = restore(t, sql);
  if (!r.restored) return { ...base, refused: false, restored: false, error: r.error, answers: [], answered: false };
  const results = runQueries(t, queries.map((q) => q.sql));
  const answers = queries.map((q, i) => ({ id: q.id, ok: results[i].rows !== null && isDeepStrictEqual(results[i].rows, q.expect), rows: results[i].rows, error: results[i].error }));
  return { ...base, refused: false, restored: true, error: null, answers, answered: answers.every((a) => a.ok) };
}

export function rehearse(fx: RestoreFixture, fixturePath: string, sandboxRoot: string, operator: string): Rehearsal {
  if (!operator.trim()) throw new SandboxError('ContractViolation', 'a restore is started by a named operator');
  const artefactPath = resolve(dirname(fixturePath), fx.artefact);
  let sql: string;
  try {
    sql = readFileSync(artefactPath, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `artefact ${fx.artefact} could not be read: ${(err as Error).message}`);
  }
  if (ends(sql).length < 2) throw new SandboxError('ContractViolation', `artefact ${fx.artefact} needs at least two statements, each ending ";" at the end of a line`);
  const cut = truncations(sql);
  const attempts = [
    attempt('full', sql, artefactPath, fx.queries, sandboxRoot),
    attempt('truncated_mid_statement', cut.truncated_mid_statement, artefactPath, fx.queries, sandboxRoot),
    attempt('truncated_at_statement_boundary', cut.truncated_at_statement_boundary, artefactPath, fx.queries, sandboxRoot),
  ];
  const [full, mid, boundary] = attempts;
  const passes = (a: AttemptResult) => a.restored && a.answered;
  const checks: Record<string, boolean> = {
    isolation_proven_before_restore: attempts.every((a) => isolated(a.isolation)),
    full_backup_answers_known_queries: passes(full),
    // The positive control: each truncated copy fails the assertion.
    truncated_mid_statement_fails: !passes(mid),
    truncated_at_statement_boundary_fails: !passes(boundary),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, initiated_by: operator, attempts, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}, started by ${operator}: each target was proven isolated before its restore began. The backup restored and answered all ${fx.queries.length} known queries. Cut inside a statement, it did not restore. Cut cleanly between statements, it restored without an error but answered ${boundary.answers.filter((a) => !a.ok).map((a) => a.id).join(', ')} wrongly: a restore that succeeds is not a restore that answers. Sandbox only; nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

export function loadRestoreFixture(path: string): RestoreFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: RestoreFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return checkFixture(fx, path);
}

export function checkFixture(fx: RestoreFixture, path: string): RestoreFixture {
  if (typeof fx?.fixture_id !== 'string' || typeof fx.artefact !== 'string' || !Array.isArray(fx.queries) || fx.queries.length === 0) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, artefact and a non-empty queries[]`);
  }
  for (const q of fx.queries) {
    if (!(typeof q?.id === 'string' && typeof q.sql === 'string' && /^\s*SELECT\b/i.test(q.sql) && Array.isArray(q.expect))) {
      throw new SandboxError('ContractViolation', `fixture ${path}: query ${q?.id ?? '?'} needs id, a SELECT and expect[]`);
    }
  }
  if (new Set(fx.queries.map((q) => q.id)).size !== fx.queries.length) throw new SandboxError('ContractViolation', `fixture ${path}: each query id is listed once`);
  return fx;
}
