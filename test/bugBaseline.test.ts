import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTap, classifyBaseline, type RunResult, type TestOutcome, type ReportedReason } from '../src/capabilities/bugBaseline.ts';
import { prepareSandbox, runBaseline, sandboxFiles, BaselineInputError, type BaselineSpec } from '../src/sandbox/baselineRunner.ts';

// TAP fixtures are real node test-runner output (v25), with local paths replaced by /sandbox.
const tap = (f: string) => readFileSync(new URL(`./fixtures/tap/${f}.tap`, import.meta.url), 'utf8');
const TICKET = { id: 'bug-1', type: 'bug', title: 'unrecognised tier clears ceilings', description: 'x' };
const REASON: ReportedReason = { error_name: 'AssertionError', message_includes: 'unrecognised tier cleared the R0 ceiling' };
const out = (name: string, kind: TestOutcome['kind'], error_name: string | null = null, message: string | null = null): TestOutcome => ({ name, kind, error_name, message });
const run = (...outcomes: TestOutcome[]): RunResult => ({ exit_code: 1, timed_out: false, outcomes });
const DEFECT = out('defect', 'assertion', 'AssertionError', 'unrecognised tier cleared the R0 ceiling\n\ntrue !== false');

// The platform's router lines (workGraph/capabilityRouter.ts:26-36 at c35fbc5), and the same lines fixed.
const ROUTER = `const RISK_TIER_ORDER = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;

// riskTierIndex
function riskTierIndex(tier: string): number {
  const idx = RISK_TIER_ORDER.indexOf(tier as any);
  return idx === -1 ? 0 : idx;
}

function riskTierAllowed(ticketRiskTier: string | null | undefined, maxRiskTier: string): boolean {
  if (!ticketRiskTier) return true;
  return riskTierIndex(ticketRiskTier) <= riskTierIndex(maxRiskTier);
}`;
const TEST = readFileSync(new URL('../examples/bug-baseline/risk-tier.baseline.test.mjs', import.meta.url), 'utf8');

function world(routerSource: string, testContent = TEST) {
  const base = mkdtempSync(join(tmpdir(), 'ellis-baseline-'));
  const source = join(base, 'platform');
  mkdirSync(join(source, 'backend'), { recursive: true });
  writeFileSync(join(source, 'backend', 'router.ts'), routerSource);
  const sandbox = join(base, 'sandboxes');
  mkdirSync(sandbox);
  const spec: BaselineSpec = {
    ticket: TICKET, reported_reason: REASON,
    excerpts: [{ from: 'backend/router.ts', lines: [1, routerSource.split('\n').length], to: 'capabilityRouter.excerpt.ts', exports: ['riskTierAllowed'] }],
    test: { file: 'risk-tier.baseline.test.mjs', content: testContent },
  };
  return { base, source, sandbox, spec };
}

test('acceptance: the baseline test fails for the reported reason before any fix and is shown to fail; a test that passes before the fix proves nothing', () => {
  const w = world(ROUTER);
  const prepared = prepareSandbox(w.spec, w.source, w.sandbox);
  const runs = [runBaseline(prepared), runBaseline(prepared)];
  const r = classifyBaseline(TICKET, REASON, runs, prepared.citations);
  assert.equal(r.verdict, 'baseline_confirmed');
  assert.equal(r.accepted, true);
  assert.equal(r.runs.length, 2);
  for (const x of r.runs) {
    assert.deepEqual(x.failures.map((f) => [f.kind, f.error_name]), [['assertion', 'AssertionError']]);
    assert.equal(x.passes, 1, 'the control test passes, so the harness itself works');
  }
  assert.deepEqual(sandboxFiles(prepared), ['capabilityRouter.excerpt.ts', 'risk-tier.baseline.test.mjs']);
  assert.equal(readFileSync(join(w.source, 'backend', 'router.ts'), 'utf8'), ROUTER, 'the source is only read');
  assert.match(r.citations[0].fields[0], /^sha256:[0-9a-f]{64}$/);

  const fixed = world(ROUTER.replace('return idx === -1 ? 0 : idx;', 'return idx === -1 ? Number.POSITIVE_INFINITY : idx;'));
  const p2 = prepareSandbox(fixed.spec, fixed.source, fixed.sandbox);
  const passing = classifyBaseline(TICKET, REASON, [runBaseline(p2), runBaseline(p2)]);
  assert.equal(passing.verdict, 'passes_before_fix');
  assert.equal(passing.accepted, false);
  assert.match(passing.statement, /passes before any fix, so it proves nothing/);
});

test('the sandbox refuses writes outside it, and such a run is never accepted', () => {
  const outside = join(tmpdir(), `ellis-outside-${process.pid}.txt`);
  const w = world(ROUTER, `import { test } from 'node:test'; import { writeFileSync } from 'node:fs';
test('writes outside', () => { writeFileSync(${JSON.stringify(outside)}, 'x'); });`);
  const p = prepareSandbox(w.spec, w.source, w.sandbox);
  const r = classifyBaseline(TICKET, REASON, [runBaseline(p), runBaseline(p)]);
  assert.equal(r.verdict, 'sandbox_violation');
  assert.equal(existsSync(outside), false);
});

test('a test file that cannot load is not the defect, even when its error has the reported name', () => {
  for (const f of ['syntax', 'missing', 'syntax.child', 'missing.child']) {
    assert.ok(parseTap(tap(f)).every((o) => o.kind === 'load_error'), f);
  }
  const syntax = parseTap(tap('syntax'));
  const r = classifyBaseline(TICKET, { error_name: 'SyntaxError', message_includes: 'Unexpected' }, [run(...syntax), run(...syntax)]);
  assert.equal(r.verdict, 'did_not_run');
});

test('the runner output is read into passes, assertions, thrown errors, timeouts and refusals', () => {
  assert.deepEqual(parseTap(tap('a')).map((o) => [o.name, o.kind, o.error_name]), [
    ['assert fails', 'assertion', 'AssertionError'], ['throws TypeError', 'thrown', 'TypeError'], ['passes', 'pass', null],
  ]);
  assert.match(parseTap(tap('a'))[0].message!, /^sum is wrong\n\n2 !== 3$/);
  assert.deepEqual(parseTap(tap('hang')).map((o) => o.kind), ['timeout']);
  assert.deepEqual(parseTap(tap('write')).map((o) => o.kind), ['access_denied', 'pass']);
});

test('a failure with another error or another message is not the reported reason', () => {
  const other = classifyBaseline(TICKET, REASON, [run(out('t', 'thrown', 'TypeError', 'unrecognised tier cleared the R0 ceiling')), run(out('t', 'thrown', 'TypeError', 'unrecognised tier cleared the R0 ceiling'))]);
  assert.equal(other.verdict, 'fails_for_another_reason');
  const msg = classifyBaseline(TICKET, REASON, [run(out('t', 'assertion', 'AssertionError', 'something else')), run(out('t', 'assertion', 'AssertionError', 'something else'))]);
  assert.equal(msg.verdict, 'fails_for_another_reason');
  const mixed = classifyBaseline(TICKET, REASON, [run(DEFECT, out('u', 'thrown', 'TypeError', 'x')), run(DEFECT, out('u', 'thrown', 'TypeError', 'x'))]);
  assert.equal(mixed.verdict, 'fails_for_another_reason', 'every failure must be the reported one');
});

test('a timeout, an empty run or a killed run did not run to a result', () => {
  const t = out('t', 'timeout', null, 'test timed out after 500ms');
  assert.equal(classifyBaseline(TICKET, REASON, [run(t), run(t)]).verdict, 'did_not_run');
  assert.equal(classifyBaseline(TICKET, REASON, [run(), run()]).verdict, 'did_not_run');
  const killed: RunResult = { exit_code: null, timed_out: true, outcomes: [DEFECT] };
  assert.equal(classifyBaseline(TICKET, REASON, [killed, killed]).verdict, 'did_not_run');
});

test('the failure must repeat: one run is not enough, and runs that disagree are rejected', () => {
  assert.equal(classifyBaseline(TICKET, REASON, [run(DEFECT)]).verdict, 'not_repeated');
  assert.equal(classifyBaseline(TICKET, REASON, [run(DEFECT), run(out('defect', 'pass'))]).verdict, 'inconsistent');
  const other = out('other', 'assertion', 'AssertionError', 'unrecognised tier cleared the R0 ceiling');
  assert.equal(classifyBaseline(TICKET, REASON, [run(DEFECT), run(other)]).verdict, 'inconsistent', 'same verdict, different failing test');
});

test('only a bug ticket with a stated reason is prepared', () => {
  const r = classifyBaseline({ ...TICKET, type: 'curriculum' }, REASON, [run(DEFECT), run(DEFECT)]);
  assert.equal(r.verdict, 'refused');
  assert.deepEqual(r.runs, []);
  assert.equal(classifyBaseline(TICKET, null, []).verdict, 'refused');
  assert.equal(classifyBaseline(TICKET, { error_name: 'AssertionError', message_includes: '' }, []).verdict, 'refused');
  assert.equal(r.decided_by, 'a named human');
});

test('the sandbox is prepared only from the checkout, into plain file names', () => {
  const w = world(ROUTER);
  assert.throws(() => prepareSandbox({ ...w.spec, test: { file: '../escape.mjs', content: '' } }, w.source, w.sandbox), BaselineInputError);
  assert.throws(() => prepareSandbox({ ...w.spec, excerpts: [{ ...w.spec.excerpts[0], to: 'a/b.ts' }] }, w.source, w.sandbox), BaselineInputError);
  assert.throws(() => prepareSandbox({ ...w.spec, excerpts: [{ ...w.spec.excerpts[0], from: '../../etc/hosts' }] }, w.source, w.sandbox), /outside the platform checkout/);
  assert.throws(() => prepareSandbox({ ...w.spec, excerpts: [{ ...w.spec.excerpts[0], lines: [5, 999] }] }, w.source, w.sandbox), /has no lines 5-999/);
  const p = prepareSandbox(w.spec, w.source, w.sandbox);
  assert.match(readFileSync(join(p.dir, 'capabilityRouter.excerpt.ts'), 'utf8'), /^\/\/ Copied from backend\/router\.ts:1-12 \(read-only source\)\.[\s\S]*export \{ riskTierAllowed \};\n$/);
});
