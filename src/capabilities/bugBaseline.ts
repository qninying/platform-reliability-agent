// platform.platform_bug_fix_dispatch, first release behaviour (R1):
// prepares an isolated reproduction and a baseline test for a reported defect, and changes nothing else.
// The baseline is accepted only when the test fails, fails for the reported reason, and fails the same way on
// every run. A test that passes before any fix proves nothing; a test that fails because it cannot load, times
// out or is refused by the sandbox proves nothing either. Fixing, merging and deploying stay human.
//
// A failure that cannot be made to repeat is not evidence that there is no defect (A.M., 2026-10-27): races,
// a recovery that fires only after a delay, a breaker that resets when a window drains. Such a ticket is
// 'unreproducible' and kept on its own list, never mixed with the rejected baselines. Two cases:
// - the runs disagree and at least one failed for the reported reason (seen intermittently);
// - the reported reason is marked timing-dependent and the test passed on every run (not shown by this test).
//
// Platform behaviour this rests on (platform repo, commit c35fbc5):
// - The work-graph entry bug.platform_fix matches every ticket of type 'bug' (workGraph/capabilityRegistry.ts:87-101)
//   and runs PlatformFixAgent, which asks a model for a diagnosis from the title and description only, with no
//   reproduction and no test (services/agents/platformFixAgent.ts:33-58).
// - Node's test runner reports a file that cannot load as an ordinary failing test (with an exitCode in a child
//   process, or with the load error's own name and no failureType in process), so "it failed" alone is not
//   evidence of the defect.

import type { Citation } from './orchestrationHealthWatch.ts';

export interface BugTicket { id: string; type: string; title: string; description: string }
// The reported reason, as the failure it must produce: the error's name and a fragment of its message.
// timing_dependent marks a defect that needs timing or concurrency to appear (a race, a delay, a window).
export interface ReportedReason { error_name: string; message_includes: string; timing_dependent?: boolean }

export type OutcomeKind = 'pass' | 'assertion' | 'thrown' | 'load_error' | 'timeout' | 'access_denied';
export interface TestOutcome { name: string; kind: OutcomeKind; error_name: string | null; message: string | null }
export interface RunResult { exit_code: number | null; timed_out: boolean; outcomes: TestOutcome[] }

export type Verdict = 'baseline_confirmed' | 'unreproducible' | 'passes_before_fix' | 'fails_for_another_reason' | 'did_not_run' | 'sandbox_violation' | 'inconsistent' | 'not_repeated' | 'refused';
// Which list a record belongs on. 'unreproducible' is never folded into 'rejected'.
export type BaselineList = 'confirmed' | 'unreproducible' | 'rejected';

export interface BaselineRecord {
  decided_by: 'a named human';
  ticket_id: string;
  verdict: Verdict;
  accepted: boolean;
  list: BaselineList;
  // How many runs failed for the reported reason, out of how many ran (null when nothing ran).
  seen_in: { runs: number; of: number } | null;
  statement: string;
  reported_reason: ReportedReason | null;
  runs: Array<{ exit_code: number | null; timed_out: boolean; failures: TestOutcome[]; passes: number }>;
  citations: Citation[];
}

const unquote = (v: string) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"')) { try { return JSON.parse(t) as string; } catch { return t.slice(1, -1); } }
  return t;
};

// Reads the TAP the node test runner prints (--test-reporter=tap). Suites that fail only because a child
// failed are skipped, so each failure is counted once, at the test that produced it.
export function parseTap(tap: string): TestOutcome[] {
  const lines = tap.split('\n');
  const out: TestOutcome[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(not ok|ok) \d+ - (.*?)(?: # (?:SKIP|TODO).*)?$/);
    if (!m) continue;
    const name = m[3];
    const fields: Record<string, string> = {};
    let j = i + 1;
    if (lines[j]?.trim() === '---') {
      const indent = lines[j].indexOf('---');
      for (j = j + 1; j < lines.length && lines[j].trim() !== '...'; j++) {
        const kv = lines[j].match(/^(\s*)([A-Za-z_]+):\s?(.*)$/);
        if (!kv || kv[1].length !== indent) continue;
        let value = kv[3];
        if (value === '|-' || value === '|' || value === '>-') {
          const block: string[] = [];
          while (j + 1 < lines.length && (lines[j + 1].trim() === '' || lines[j + 1].search(/\S/) > indent) && lines[j + 1].trim() !== '...') block.push(lines[++j].trim());
          value = block.join('\n').trim();
        }
        fields[kv[2]] = unquote(value);
      }
      i = j;
    }
    if (m[2] === 'ok') { out.push({ name, kind: 'pass', error_name: null, message: null }); continue; }
    if (fields.failureType === 'subtestsFailed') continue;
    const message = fields.error ?? null;
    // A real test failure always carries failureType. A file that never loaded has none when run in process,
    // and an exitCode when run in a child process; either way it is a load error, never the defect.
    const kind: OutcomeKind = !('failureType' in fields) || 'exitCode' in fields ? 'load_error'
      : fields.failureType === 'testTimeoutFailure' ? 'timeout'
      : fields.code === 'ERR_ACCESS_DENIED' ? 'access_denied'
      : fields.name === 'AssertionError' ? 'assertion' : 'thrown';
    out.push({ name, kind, error_name: fields.name ?? null, message });
  }
  return out;
}

const matches = (o: TestOutcome, r: ReportedReason) =>
  (o.kind === 'assertion' || o.kind === 'thrown') && o.error_name === r.error_name && (o.message ?? '').includes(r.message_includes);

function judgeRun(run: RunResult, reason: ReportedReason): Exclude<Verdict, 'unreproducible' | 'inconsistent' | 'not_repeated' | 'refused'> {
  if (run.timed_out || run.outcomes.length === 0 || run.outcomes.some((o) => o.kind === 'load_error' || o.kind === 'timeout')) return 'did_not_run';
  if (run.outcomes.some((o) => o.kind === 'access_denied')) return 'sandbox_violation';
  const failures = run.outcomes.filter((o) => o.kind !== 'pass');
  if (failures.length === 0) return 'passes_before_fix';
  return failures.every((f) => matches(f, reason)) ? 'baseline_confirmed' : 'fails_for_another_reason';
}

const signature = (run: RunResult) => run.outcomes.map((o) => `${o.name}|${o.kind}|${o.error_name}`).sort().join('\n');

const STATEMENTS: Record<Verdict, (t: BugTicket, r: ReportedReason | null) => string> = {
  baseline_confirmed: (t, r) => `Baseline confirmed for ${t.id}: the test fails with ${r!.error_name} ("${r!.message_includes}") on every run, before any fix. A fix can now be judged against it; making one, merging and deploying are for a person.`,
  passes_before_fix: (t) => `Not accepted for ${t.id}: the test passes before any fix, so it proves nothing about the reported defect.`,
  fails_for_another_reason: (t, r) => `Not accepted for ${t.id}: the test fails, but not with ${r!.error_name} ("${r!.message_includes}"), so it does not show the reported defect.`,
  did_not_run: (t) => `Not accepted for ${t.id}: the test did not run to a result (it could not load, timed out, or found no tests). A failure to load is not the defect.`,
  sandbox_violation: (t) => `Not accepted for ${t.id}: the test tried to reach outside its sandbox and was refused. A baseline must change nothing else.`,
  unreproducible: (t, r) => `Unreproducible for ${t.id}: ${r!.timing_dependent ? 'the defect is timing-dependent and this test did not show it' : `the test failed with ${r!.error_name} ("${r!.message_includes}") on some runs and not others`}. That is not evidence there is no defect; it stays on the unreproducible list for a person to reproduce another way.`,
  inconsistent: (t) => `Not accepted for ${t.id}: the runs disagree, so the failure is not repeatable.`,
  not_repeated: (t) => `Not accepted for ${t.id}: a baseline needs at least two runs to show the failure repeats.`,
  refused: (t) => `Refused ${t.id}: only a ticket of type 'bug' with a stated reported reason is prepared.`,
};

export function classifyBaseline(ticket: BugTicket, reason: ReportedReason | null, runs: RunResult[], citations: Citation[] = []): BaselineRecord {
  let verdict: Verdict;
  if (ticket.type !== 'bug' || !reason || !reason.error_name || !reason.message_includes) verdict = 'refused';
  else if (runs.length < 2) verdict = 'not_repeated';
  else {
    const judged = runs.map((r) => judgeRun(r, reason));
    const verdicts = new Set(judged);
    const sigs = new Set(runs.map(signature));
    const harmful = judged.some((v) => v === 'sandbox_violation');
    // Unreproducible only when the outcome itself varies (the reported failure on some runs, not others);
    // the same verdict from different failing tests is a test that does not pin the defect, so inconsistent.
    verdict = verdicts.size > 1 && !harmful && judged.includes('baseline_confirmed') ? 'unreproducible'
      : verdicts.size > 1 || sigs.size > 1 ? 'inconsistent'
      : [...verdicts][0];
    if (verdict === 'passes_before_fix' && reason.timing_dependent) verdict = 'unreproducible';
  }
  const seen = verdict === 'refused' || runs.length === 0 ? null
    : { runs: runs.filter((r) => reason && judgeRun(r, reason) === 'baseline_confirmed').length, of: runs.length };
  return {
    decided_by: 'a named human',
    ticket_id: ticket.id,
    verdict,
    accepted: verdict === 'baseline_confirmed',
    list: verdict === 'baseline_confirmed' ? 'confirmed' : verdict === 'unreproducible' ? 'unreproducible' : 'rejected',
    seen_in: seen,
    statement: STATEMENTS[verdict](ticket, reason),
    reported_reason: reason,
    runs: verdict === 'refused' ? [] : runs.map((r) => ({ exit_code: r.exit_code, timed_out: r.timed_out, failures: r.outcomes.filter((o) => o.kind !== 'pass'), passes: r.outcomes.filter((o) => o.kind === 'pass').length })),
    citations,
  };
}

// Splits records into the three lists, so the unreproducible half is never read as "not a defect".
export function byList(records: BaselineRecord[]): Record<BaselineList, BaselineRecord[]> {
  const out: Record<BaselineList, BaselineRecord[]> = { confirmed: [], unreproducible: [], rejected: [] };
  for (const r of [...records].sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0))) out[r.list].push(r);
  return out;
}
