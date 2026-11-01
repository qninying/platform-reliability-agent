import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assemble, clausesOf, LIMITS, CAPABILITIES_FILE, REGISTRY_FILE, PROGRESS_FILE, type EvidenceItem, type Environment, type RecordReader } from '../src/capabilities/promotionEvidence.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout and repository shaped like the real ones at bbde6ef. Names are test inputs.
const CAP = 'platform.alpha';
const R2 = 'Every answer cites its row; an empty result is stated as empty.';
const capabilities = {
  capabilities: [
    { capability_id: CAP, human_decision: false, approved_autonomy: null, max_permitted_autonomy: 'autonomy:R6', release_behaviour: [
      { autonomy: 'autonomy:R2', behaviour: 'a', acceptance_criteria: R2 },
      { autonomy: 'autonomy:R3', behaviour: 'b', acceptance_criteria: 'A sandbox run is proven.' },
      { autonomy: 'autonomy:R6', behaviour: 'c', acceptance_criteria: 'A supervised pilot ran.' },
    ] },
    { capability_id: 'platform.beta', human_decision: true, approved_autonomy: 'autonomy:R2', max_permitted_autonomy: 'autonomy:R2', release_behaviour: [{ autonomy: 'autonomy:R2', behaviour: 'x', acceptance_criteria: 'Beta passes.' }] },
    { capability_id: 'platform.gamma', human_decision: false, max_permitted_autonomy: 'autonomy:R5', release_behaviour: [{ autonomy: 'autonomy:R2', behaviour: 'x', acceptance_criteria: R2 }] },
  ],
};
const progress = {
  stories: [
    { id: 'platform.CAP.alpha', tests_added: ['test/alpha.test.ts'], criteria: [{ text: R2, passed: true }], verification: { state: 'verified' } },
    { id: 'platform.CAP.beta', tests_added: ['test/beta.test.ts'], criteria: [{ text: 'Beta passes.', passed: false }], verification: { state: 'in_progress' } },
  ],
};
const PLATFORM: Record<string, string> = {
  [CAPABILITIES_FILE]: JSON.stringify(capabilities),
  [REGISTRY_FILE]: `{ domain_key: 'website', agent_id: 'abc', },\n{ domain_key: 'platform', title: 't', agent_id: null, },\n`,
};
const REPO: Record<string, string> = {
  [PROGRESS_FILE]: JSON.stringify(progress),
  'test/alpha.test.ts': "test('names the row', () => {});\n",
};
const readerOf = (files: Record<string, string>): Reader => ({
  read(p) { if (files[p] === undefined) throw new Error(`no ${p}`); return files[p]; },
  list() { return Object.keys(files); },
});
const RECORDS: RecordReader = (p) => (p === 'run.json' ? { text: '{"ok":true}' } : p === 'empty.json' ? { text: ' ' } : null);
const ask = (items: EvidenceItem[] = [], o: { capability_id?: string; rung?: string; environment?: Environment; platform?: Record<string, string>; repo?: Record<string, string> } = {}) =>
  assemble(readerOf(o.platform ?? PLATFORM), readerOf(o.repo ?? REPO), 'abc', { capability_id: o.capability_id ?? CAP, rung: o.rung ?? 'autonomy:R2', environment: o.environment ?? 'sandbox' }, items, RECORDS);
const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({ capability_id: CAP, rung: 'autonomy:R2', criterion: 1, kind: 'run_record', cite: 'run.json', against: 'platform_source', ...over });

test('the assembly cites real run records and names any criterion with no evidence as unmet', () => {
  const b = ask([item({ capability_id: 'platform.gamma' })], { capability_id: 'platform.gamma' });
  assert.deepEqual(b.criteria.map((c) => c.state), ['met', 'unmet']);
  assert.equal(b.verdict, 'unmet');
  assert.equal(b.statement, 'autonomy:R2 is not met: 1 of 2 criteria have no evidence');
  assert.equal(b.criteria[0].run_records[0].cite, 'run.json');
  assert.match(b.criteria[0].run_records[0].sha256!, /^[0-9a-f]{64}$/);
});

test('a capability whose only evidence is a passing mocked test is reported as unproven', () => {
  const a = ask();
  assert.equal(a.verdict, 'unproven');
  assert.deepEqual(a.criteria.map((c) => c.state), ['unproven', 'unproven']);
  assert.deepEqual(a.criteria[0].supporting, [{ criterion: 1, kind: 'mocked_test', cite: 'test/alpha.test.ts', source: 'progress_record' }]);
  assert.equal(a.statement, 'autonomy:R2 is unproven: 2 of 2 criteria rest on tests or citations with no run record');
  assert.deepEqual(a.story_status, { state: 'verified', counts_as_evidence: false });
});

test('a test on a criterion that has not passed is no evidence', () => {
  assert.equal(ask([], { capability_id: 'platform.beta' }).verdict, 'unmet');
});

test('a test from one rung is not evidence for the next', () => {
  assert.equal(ask([], { rung: 'autonomy:R3' }).verdict, 'unmet');
});

test('every criterion citing a run record meets the rung, and that still grants nothing', () => {
  const a = ask([item(), item({ criterion: 2 })]);
  assert.equal(a.verdict, 'meets_criteria');
  assert.equal(a.statement, 'all 2 criteria at autonomy:R2 cite a run record. A person decides whether that is enough');
  assert.deepEqual(a.level, { approved: null, ceiling: 'autonomy:R6', after_this_assembly: null, changed: false });
  assert.deepEqual(a.human_decision, { promotion: 'person_only', decided_by: 'K.D.', ellis_may: 'assemble_and_present', decision_recorded: false, applies_to: 'this capability at this rung alone' });
});

test('one strong criterion does not carry a weak one', () => {
  const a = ask([item()]);
  assert.deepEqual(a.criteria.map((c) => c.state), ['met', 'unproven']);
  assert.equal(a.verdict, 'unproven');
});

for (const [kind, why] of [['story_complete', /story/], ['elapsed_time', /elapsed/], ['conversation', /conversation/], ['auto_approval', /timeout is not an approval/]] as const) {
  test(`${kind} promotes nothing`, () => {
    const a = ask([item({ rung: 'autonomy:R3', kind, cite: 'x' })], { rung: 'autonomy:R3' });
    assert.equal(a.verdict, 'unmet');
    assert.match(a.not_counted[0].why, why);
  });
}

test('evidence for another capability or rung is listed and counts for nothing', () => {
  const a = ask([item({ capability_id: 'platform.beta' }), item({ rung: 'autonomy:R3' })]);
  assert.equal(a.not_counted.length, 2);
  assert.match(a.not_counted[0].why, /does not carry between capabilities or rungs/);
  assert.ok(a.criteria.every((c) => c.run_records.length === 0));
});

test('promotion on one capability leaves the others alone', () => {
  const beta = ask([], { capability_id: 'platform.beta' });
  assert.equal(beta.level.approved, 'autonomy:R2');
  assert.equal(ask([item(), item({ criterion: 2 })]).level.approved, null);
});

test('a fixture or example is never a run record', () => {
  for (const cite of ['examples/run.json', 'test/run.json', 'test/fixtures/run.json', 'fixtures/run.json', 'a/__tests__/run.json']) {
    const a = ask([item({ cite })], { rung: 'autonomy:R2' });
    assert.match(a.not_counted[0].why, /fixture or example/, cite);
  }
  assert.equal(ask([item({ cite: 'latest-run.json' })]).not_counted[0].why, 'the run record could not be read');
});

test('an unreadable or empty record counts for nothing', () => {
  assert.equal(ask([item({ cite: 'gone.json' })]).not_counted[0].why, 'the run record could not be read');
  assert.equal(ask([item({ cite: 'empty.json' })]).not_counted[0].why, 'the run record could not be read');
});

test('sandbox evidence never carries to production', () => {
  for (const against of ['sandbox', 'platform_source'] as const) {
    const a = ask([item({ against })], { environment: 'production' });
    assert.match(a.not_counted[0].why, new RegExp(`a run against ${against} does not carry to production`));
  }
  assert.equal(ask([item({ against: 'production' })], { environment: 'production' }).criteria[0].state, 'met');
  assert.match(ask([item({ against: undefined })]).not_counted[0].why, /nothing stated/);
  assert.match(ask([item({ against: 'production' })]).not_counted[0].why, /does not carry to sandbox/);
});

test('a production rung needs the production environment and its own pilot approval', () => {
  const r6 = { rung: 'autonomy:R6', capability_id: CAP };
  const sandbox = ask([], r6);
  assert.equal(sandbox.verdict, 'rung_needs_production');
  assert.equal(sandbox.separate_pilot_approval_required, false);
  assert.equal(ask([], { ...r6, environment: 'production' }).separate_pilot_approval_required, true);
  assert.equal(ask([item({ rung: 'autonomy:R6', against: 'production' })], { ...r6, environment: 'production' }).verdict, 'meets_criteria');
  assert.equal(ask([], { rung: 'autonomy:R5', environment: 'production' }).separate_pilot_approval_required, false);
});

test('a rung above the ceiling cannot be reached, whatever the evidence', () => {
  const a = ask([item({ capability_id: 'platform.beta', rung: 'autonomy:R3' })], { capability_id: 'platform.beta', rung: 'autonomy:R3' });
  assert.equal(a.verdict, 'above_ceiling');
  assert.match(a.statement, /stops at autonomy:R2/);
});

test('a rung with no written criteria cannot be met', () => {
  const a = ask([item({ rung: 'autonomy:R4' })], { rung: 'autonomy:R4' });
  assert.equal(a.verdict, 'no_criteria_defined');
  assert.match(a.not_counted[0].why, /not one of this rung's 0/);
});

test('the deciding person follows the rung', () => {
  assert.equal(ask([], { rung: 'autonomy:R2' }).human_decision.decided_by, 'K.D.');
  assert.equal(ask([], { rung: 'autonomy:R3' }).human_decision.decided_by, 'A.M.');
});

test('named tests are checked to exist and count as support only', () => {
  const a = ask([item({ rung: 'autonomy:R3', kind: 'named_test', cite: 'test/alpha.test.ts#names the row' })], { rung: 'autonomy:R3' });
  assert.equal(a.criteria[0].state, 'unproven');
  for (const cite of ['test/alpha.test.ts#no such test', 'test/gone.test.ts#names the row', 'test/alpha.test.ts']) {
    assert.equal(ask([item({ rung: 'autonomy:R3', kind: 'named_test', cite })], { rung: 'autonomy:R3' }).not_counted[0].why, 'the cited test was not found');
  }
});

test('a citation alone supports and does not prove, and a wrong criterion number is refused', () => {
  assert.equal(ask([item({ rung: 'autonomy:R3', kind: 'file_line', cite: 'a.ts:1' })], { rung: 'autonomy:R3' }).criteria[0].state, 'unproven');
  assert.equal(ask([item({ rung: 'autonomy:R3', kind: 'measured_figure', cite: '5' })], { rung: 'autonomy:R3' }).verdict, 'unproven');
  assert.match(ask([item({ criterion: 1.5 })]).not_counted[0].why, /not one of this rung's 2/);
  for (const criterion of [0, 2, 1.5]) assert.match(ask([item({ rung: 'autonomy:R3', criterion })], { rung: 'autonomy:R3' }).not_counted[0].why, /not one of this rung's 1/);
});

test('the blockers come from the records', () => {
  const a = ask();
  assert.equal(a.blockers.length, 3);
  assert.match(a.blockers[0], /agent_id is null/);
  assert.ok(!ask([], { capability_id: 'platform.beta' }).blockers.some((b) => /No level has been approved/.test(b)));
  const withAgent = ask([], { platform: { ...PLATFORM, [REGISTRY_FILE]: "domain_key: 'platform', agent_id: 'x',\n" } });
  assert.ok(!withAgent.blockers.some((b) => /agent/.test(b)));
  const unreadable = { ...PLATFORM };
  delete unreadable[REGISTRY_FILE];
  assert.match(ask([], { platform: unreadable }).blockers[0], /could not be read/);
  assert.match(ask([], { platform: { ...PLATFORM, [REGISTRY_FILE]: 'nothing here' } }).blockers[0], /could not be read/);
});

test('sentences split at semicolons only', () => {
  assert.deepEqual(clausesOf('a, b; c;  d.'), ['a, b', 'c', 'd.']);
  assert.deepEqual(clausesOf('see a;b here'), ['see a;b here']);
  assert.deepEqual(clausesOf(R2), ['Every answer cites its row', 'an empty result is stated as empty.']);
});

test('bad questions are refused', () => {
  assert.throws(() => ask([], { rung: 'R2' }), /not a rung/);
  assert.throws(() => ask([], { capability_id: 'platform.none' }), /is not in/);
  assert.throws(() => ask([], { repo: {} }), /could not be read/);
});

test('the limits are stated in every answer, and the source commit is carried', () => {
  const a = ask();
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.equal(a.source_commit, 'abc');
});

const CLI = join(process.cwd(), 'src/cli/promotionEvidence.ts');
function checkout(): { root: string; run: (...a: string[]) => ReturnType<typeof spawnSync> } {
  const root = mkdtempSync(join(tmpdir(), 'promo-'));
  for (const [p, text] of Object.entries({ ...PLATFORM, ...REPO, 'backend/src/services/aiOpsScheduler.ts': 'x', 'runs/run.json': '{"ok":true}' })) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return { root, run: (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', cwd: root }) };
}
const BASE = ['--capability', CAP, '--rung', 'autonomy:R2', '--environment', 'sandbox'];

test('the CLI exits 0, 4 and 5 by verdict, reading records beside the evidence file', () => {
  const { root, run } = checkout();
  assert.equal(run('--source', root, ...BASE).status, 4);
  const file = join(root, 'runs/evidence.json');
  writeFileSync(file, JSON.stringify({ items: [item({ cite: 'run.json' }), item({ cite: 'run.json', criterion: 2 })] }));
  const ok = run('--source', root, ...BASE, '--evidence', file);
  assert.equal(ok.status, 0, String(ok.stderr));
  assert.equal(JSON.parse(String(ok.stdout)).verdict, 'meets_criteria');
  assert.equal(run('--source', root, '--capability', CAP, '--rung', 'autonomy:R7', '--environment', 'production').status, 5);
  assert.equal(run('--source', root, '--capability', CAP, '--rung', 'autonomy:R4', '--environment', 'sandbox').status, 5);
  assert.equal(run('--source', root, '--capability', CAP, '--rung', 'autonomy:R6', '--environment', 'sandbox').status, 5);
});

test('the CLI exits 1 for bad input', () => {
  const { root, run } = checkout();
  assert.equal(run('--source', root).status, 1);
  assert.equal(run('--source', root, '--capability', CAP, '--rung', 'autonomy:R2').status, 1);
  assert.equal(run('--source', root, '--capability', CAP, '--rung', 'autonomy:R2', '--environment', 'staging').status, 1);
  const file = join(root, 'bad.json');
  for (const bad of ['{', '{}', '{"items":[{"kind":"run_record"}]}']) {
    writeFileSync(file, bad);
    const r = run('--source', root, ...BASE, '--evidence', file);
    assert.equal(r.status, 1, bad);
    assert.match(String(r.stderr), /ContractViolation|SourceUnavailable/);
  }
});
