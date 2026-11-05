// platform.platform_bug_fix_dispatch, rung R4: verifies a proposed fix in a sandbox. The reproduction test must
// fail on the pre-fix tree for the reported reason (the R1 baseline), and pass on the post-fix tree with the rest
// of the suite green, on every run. The diff is read back from the two trees, and it may touch only the files the
// attempt record names; a fix that edits a test is refused whatever it names, because a test changed to pass
// proves nothing. Wrong fixes run alongside the right one, so each refusal is shown able to happen.
// Ellis does not write the fix in this phase: the attempt record carries it. Merging and deploying are for a person.
//
// Platform facts this rests on (platform repo, commit a29dfb245):
// - riskTierIndex() returns 0 for a tier it does not recognise, so such a ticket clears every ceiling
//   (backend/src/services/workGraph/capabilityRouter.ts:28-31); unchanged since the R1 baseline at c35fbc5.
// - A ticket with no tier is unrestricted by design (capabilityRouter.ts:34).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { prepareSandbox, runTests, type Excerpt } from '../sandbox/baselineRunner.ts';
import { applyFix, copyTree, treeDiff, type Change, type Edit } from '../sandbox/fixRunner.ts';
import { classifyBaseline, type BaselineRecord, type BugTicket, type ReportedReason, type RunResult, type TestOutcome } from './bugBaseline.ts';

export const PINNED_AT = 'a29dfb245';
export const RUNS = 2;
export const LIMITS: readonly string[] = [
  'The fix in each attempt record was written by a person for this demonstration. Ellis applies and verifies it; it does not write fixes in this phase.',
  'The suite is the baseline test and the suite files the record names, run against the copied platform lines. The platform\'s own full test suite was not run.',
  'Which defect classes a fix may be attempted for is K.D.\'s decision; until it is stated, every bug ticket is in scope here.',
  'A verified fix is a proposal. Merging needs push_to_protected_main and deploying needs production_deploy, both default-denied; a person does both.',
];

export type FixVerdict = 'fix_verified' | 'no_baseline' | 'fix_does_not_apply' | 'edits_the_test' | 'touches_unnamed_files' | 'still_fails' | 'suite_not_green' | 'did_not_run' | 'sandbox_violation' | 'inconsistent';
export const VERDICTS: FixVerdict[] = ['fix_verified', 'no_baseline', 'fix_does_not_apply', 'edits_the_test', 'touches_unnamed_files', 'still_fails', 'suite_not_green', 'did_not_run', 'sandbox_violation', 'inconsistent'];

export interface Attempt { id: string; author: string; files: string[]; edits: Edit[]; expect: FixVerdict }
export interface TestFile { file: string; path: string; content?: string }
export interface FixFixture {
  fixture_id: string; description: string; ticket: BugTicket; reported_reason: ReportedReason | null;
  excerpts: Excerpt[]; test: TestFile; suite: TestFile[]; attempts: Attempt[];
}

type RunSummary = { exit_code: number | null; timed_out: boolean; failures: TestOutcome[]; passes: number };
export interface AttemptResult { id: string; author: string; files_named: string[]; diff: Change[]; verdict: FixVerdict; expect: FixVerdict; accepted: boolean; reason: string; post_runs: RunSummary[] }

type PostVerdict = Extract<FixVerdict, 'fix_verified' | 'still_fails' | 'suite_not_green' | 'did_not_run' | 'sandbox_violation'>;
function judgeRun(run: RunResult, reproduction: Set<string>): PostVerdict {
  if (run.timed_out || run.outcomes.length === 0 || run.outcomes.some((o) => o.kind === 'load_error' || o.kind === 'timeout')) return 'did_not_run';
  if (run.outcomes.some((o) => o.kind === 'access_denied')) return 'sandbox_violation';
  const failures = run.outcomes.filter((o) => o.kind !== 'pass');
  if (failures.some((f) => reproduction.has(f.name))) return 'still_fails';
  return failures.length ? 'suite_not_green' : 'fix_verified';
}

// The post-fix verdict over every run: anything that did not run, or reached outside, decides first; runs that
// disagree are inconsistent, so a fix that passes only sometimes is not verified.
export function judgePost(runs: RunResult[], reproduction: string[]): Exclude<FixVerdict, 'no_baseline' | 'fix_does_not_apply' | 'edits_the_test' | 'touches_unnamed_files'> {
  const judged = new Set(runs.map((r) => judgeRun(r, new Set(reproduction))));
  if (judged.has('did_not_run')) return 'did_not_run';
  if (judged.has('sandbox_violation')) return 'sandbox_violation';
  return judged.size > 1 ? 'inconsistent' : [...judged][0];
}

// The scope of a diff: a test file may never change, and every other changed file must be named in the record.
export function scopeOf(diff: Change[], named: string[], testFiles: string[]): Extract<FixVerdict, 'edits_the_test' | 'touches_unnamed_files'> | null {
  if (diff.some((d) => testFiles.includes(d.file))) return 'edits_the_test';
  if (diff.some((d) => !named.includes(d.file))) return 'touches_unnamed_files';
  return null;
}

const summary = (r: RunResult): RunSummary => ({ exit_code: r.exit_code, timed_out: r.timed_out, failures: r.outcomes.filter((o) => o.kind !== 'pass'), passes: r.outcomes.filter((o) => o.kind === 'pass').length });
const files = (d: Change[]) => d.map((x) => `${x.file} (${x.change})`).join(', ') || 'no file';

export interface Rehearsal {
  decided_by: 'a named human';
  fixture_id: string;
  pinned_at: string;
  ticket_id: string;
  baseline: BaselineRecord;
  reproduction: string[];
  attempts: AttemptResult[];
  checks: Record<string, boolean>;
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: FixFixture, sourceRoot: string, sandboxRoot: string): Rehearsal {
  const testFiles = [fx.test.file, ...fx.suite.map((s) => s.file)];
  const prepared = prepareSandbox({ ticket: fx.ticket, reported_reason: fx.reported_reason, excerpts: fx.excerpts, test: { file: fx.test.file, content: fx.test.content! } }, sourceRoot, sandboxRoot);
  for (const s of fx.suite) {
    writeFileSync(join(prepared.dir, s.file), s.content!);
    prepared.citations.push({ table: 'suite_test', id: s.file, fields: [`sha256:${createHash('sha256').update(s.content!).digest('hex')}`] });
  }
  const pre = Array.from({ length: RUNS }, () => runTests(prepared.dir, testFiles));
  const baseline = classifyBaseline(fx.ticket, fx.reported_reason, pre, prepared.citations);
  // The reproduction is the tests that failed for the reported reason before any fix.
  const reproduction = [...new Set(pre.flatMap((r) => r.outcomes.filter((o) => o.kind !== 'pass').map((o) => o.name)))].sort();

  const attempts = fx.attempts.map((a): AttemptResult => {
    const base = { id: a.id, author: a.author, files_named: a.files, expect: a.expect };
    const done = (verdict: FixVerdict, reason: string, diff: Change[] = [], post: RunResult[] = []): AttemptResult => ({ ...base, diff, verdict, accepted: verdict === 'fix_verified', reason, post_runs: post.map(summary) });
    if (!baseline.accepted) return done('no_baseline', `the pre-fix tree gave no confirmed baseline (${baseline.verdict}), so no fix can be judged against it`);
    const dir = copyTree(prepared.dir);
    const missed = applyFix(dir, a.edits);
    if (missed) return done('fix_does_not_apply', `edit ${missed.edit + 1} did not apply: ${missed.why}`);
    const diff = treeDiff(prepared.dir, dir);
    const scope = scopeOf(diff, a.files, testFiles);
    if (scope === 'edits_the_test') return done(scope, `the diff changes a test (${files(diff.filter((d) => testFiles.includes(d.file)))}); a test changed to pass proves nothing`, diff);
    if (scope) return done(scope, `the diff touches ${files(diff.filter((d) => !a.files.includes(d.file)))}, not named in the record (${a.files.join(', ')})`, diff);
    const post = Array.from({ length: RUNS }, () => runTests(dir, testFiles));
    const verdict = judgePost(post, reproduction);
    const reasons: Record<typeof verdict, string> = {
      fix_verified: `the reproduction test passes on the post-fix tree and the suite is green on all ${RUNS} runs; the diff touches only ${files(diff)}`,
      still_fails: 'the reproduction test still fails on the post-fix tree',
      suite_not_green: `the reproduction test passes, but ${[...new Set(post.flatMap((r) => r.outcomes.filter((o) => o.kind !== 'pass').map((o) => o.name)))].join('; ')} now fails`,
      did_not_run: 'the post-fix tree did not run to a result (it could not load, timed out, or found no tests)',
      sandbox_violation: 'a post-fix run tried to reach outside its sandbox and was refused',
      inconsistent: 'the post-fix runs disagree, so the fix does not hold on every run',
    };
    return done(verdict, reasons[verdict], diff, post);
  });

  const checks: Record<string, boolean> = {
    ...Object.fromEntries(attempts.map((a) => [a.id, a.verdict === a.expect])),
    // The acceptance needs a fix shown verified, and a harness shown able to refuse one.
    a_fix_was_verified: attempts.some((a) => a.verdict === 'fix_verified'),
    a_wrong_fix_was_refused: attempts.some((a) => a.verdict !== 'fix_verified' && a.verdict !== 'no_baseline'),
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const ok = attempts.filter((a) => a.accepted);
  const r = fx.reported_reason;
  return {
    decided_by: 'a named human', fixture_id: fx.fixture_id, pinned_at: PINNED_AT, ticket_id: fx.ticket.id, baseline, reproduction, attempts, checks, verified,
    statement: verified
      ? `In sandbox ${fx.fixture_id}: on the pre-fix tree the reproduction test fails with ${r!.error_name} ("${r!.message_includes}") on all ${RUNS} runs. ${ok.map((a) => `Attempt ${a.id} passes it on the post-fix tree with the suite green on all ${RUNS} runs, and its diff touches only ${files(a.diff)}, named in its record`).join('. ')}. Refused: ${attempts.filter((a) => !a.accepted).map((a) => `${a.id} (${a.verdict})`).join(', ')}. Merging and deploying are for a person. Sandbox only; the platform's lines were copied, never changed, and nothing ran on the platform.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`,
    limits: [...LIMITS],
  };
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const str = (v: unknown): v is string => typeof v === 'string';
export function checkFixture(fx: FixFixture, path: string): FixFixture {
  const bad = (what: string) => new SandboxError('ContractViolation', `fixture ${path}: ${what}`);
  if (!str(fx?.fixture_id) || !str(fx.ticket?.id) || !str(fx.ticket.type) || !('reported_reason' in fx) || !Array.isArray(fx.excerpts) || !fx.excerpts.length) throw bad('needs fixture_id, ticket { id, type }, reported_reason and a non-empty excerpts[]');
  if (!str(fx.test?.file) || !Array.isArray(fx.suite) || ![fx.test, ...fx.suite].every((t) => str(t?.file) && SAFE_NAME.test(t.file) && str(t.path))) throw bad('needs test and suite[] entries with a plain file name and a path');
  if (!Array.isArray(fx.attempts) || !fx.attempts.length) throw bad('needs a non-empty attempts[]');
  for (const a of fx.attempts) {
    const editOk = (e: Edit) => str(e?.file) && ('content' in e ? str(e.content) : str((e as { find?: unknown }).find) && str((e as { replace?: unknown }).replace));
    if (!str(a?.id) || !str(a.author) || !Array.isArray(a.files) || !a.files.every(str) || !Array.isArray(a.edits) || !a.edits.length || !a.edits.every(editOk)) throw bad(`attempt ${a?.id ?? '?'} needs id, author, files[] and edits[] (each a file with find and replace, or content)`);
    if (!VERDICTS.includes(a.expect)) throw bad(`attempt ${a.id} needs expect, one of ${VERDICTS.join(', ')}`);
  }
  if (new Set(fx.attempts.map((a) => a.id)).size !== fx.attempts.length) throw bad('each attempt id is listed once');
  return fx;
}

export function loadFixFixture(path: string): FixFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: FixFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  checkFixture(fx, path);
  const read = (t: TestFile): TestFile => {
    try {
      return { ...t, content: readFileSync(resolve(dirname(path), t.path), 'utf8') };
    } catch (err) {
      throw new SandboxError('SourceUnavailable', `test ${t.path} could not be read: ${(err as Error).message}`);
    }
  };
  return { ...fx, test: read(fx.test), suite: fx.suite.map(read) };
}
