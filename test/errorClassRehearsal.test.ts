import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rehearse, classify, platformClass, thrown, runCron, checkFixture, loadClassFixture, UNCLASSIFIED, type ClassFixture, type Seed } from '../src/capabilities/errorClassRehearsal.ts';
import { classRehearsalOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The fixture is seeded failures with invented messages: not production data.
const FIXTURE = 'examples/error-class.fixture.json';
const load = (): ClassFixture => loadClassFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const err = (o: Record<string, unknown>) => Object.assign(new Error('m'), o);

test('acceptance (R4): seeded timeout, rate-limit and validation failures land in three distinct classes and none in the generic class', () => {
  const r = rehearse(load());
  assert.equal(r.verified, true, r.statement);
  const by = (kind: string) => [...new Set(r.seeds.filter((s) => s.kind === kind).map((s) => s.ellis))];
  assert.deepEqual([by('timeout'), by('rate_limit'), by('validation')], [['TimeoutError'], ['RateLimitError'], ['ValidationError']]);
  assert.match(r.statement, /Sandbox only; nothing ran on the platform/);
  assert.equal(r.limits.length, 4);
});

test('the platform\'s rule names a class for most seeds, only 2 of them standard, and groups nothing: AxiosError spans timeout, rate limit, validation and auth', () => {
  const r = rehearse(load());
  assert.deepEqual(r.seeds.filter((s) => s.platform === 'AxiosError').map((s) => s.kind), ['timeout', 'rate_limit', 'validation', 'auth']);
  // K.D., 2026-11-08: only the six standard classes count, so AxiosError and the like are unclassified.
  assert.deepEqual(r.platform_coverage, { failures: 11, classified: 2, share: 2 / 11 });
  assert.equal(r.checks.control_fails_acceptance, true);
  assert.match(r.statement, /classified 2 of 11 \(18%\); its cron path records no class at all/);
});

test('coverage is over all failures: the one Ellis cannot place is Unclassified and counts against it', () => {
  const r = rehearse(load());
  assert.deepEqual(r.coverage, { failures: 11, classified: 10, share: 10 / 11 });
  assert.equal(r.seeds.find((s) => s.id === 'plain-words')!.ellis, UNCLASSIFIED);
  assert.match(r.statement, /Coverage over all 11 failures is 10 \(91%\)/);
});

test('the classifier reads codes, statuses and library names in a fixed order, and never the wording of a message', () => {
  assert.equal(classify(err({ code: 'ETIMEDOUT' })), 'TimeoutError');
  assert.equal(classify(err({ status: 408 })), 'TimeoutError');
  assert.equal(classify(err({ name: 'SequelizeConnectionAcquireTimeoutError' })), 'TimeoutError');
  assert.equal(classify(err({ statusCode: 429 })), 'RateLimitError');
  assert.equal(classify(err({ response: { status: 403 } })), 'AuthError');
  assert.equal(classify(err({ status: 400 })), 'ValidationError');
  assert.equal(classify(err({ name: 'SequelizeUniqueConstraintError' })), 'ValidationError');
  assert.equal(classify(err({ code: 'ENOTFOUND' })), 'UpstreamUnavailable');
  assert.equal(classify(err({ status: 503 })), 'UpstreamUnavailable');
  assert.equal(classify(err({ status: 499 })), UNCLASSIFIED);
  assert.equal(classify(err({ name: 'ContractViolation' })), 'ContractViolation');
  assert.equal(classify(err({ errorClass: 'AuthError', status: 429 })), 'AuthError', 'a class already set from the vocabulary is kept');
  assert.equal(classify(err({ error_class: 'AuthError', status: 429 })), 'AuthError');
  assert.equal(classify(err({ error_class: 'Whatever', status: 429 })), 'RateLimitError', 'a class outside the vocabulary is not');
  assert.equal(classify(err({ code: 'ETIMEDOUT', status: 429 })), 'TimeoutError', 'timeout is read before rate limit');
  assert.equal(classify(new Error('timed out after 30s')), UNCLASSIFIED);
  assert.equal(classify(null), UNCLASSIFIED);
});

test('a seeded error is an instance of the class its library throws, with its library\'s fields', () => {
  const e = thrown({ thrown_as: 'AxiosError', name: 'AxiosError', message: 'x', code: 'ECONNABORTED', status: 500, response_status: 429 }) as Error & { code: string; status: number; response: { status: number } };
  assert.deepEqual([e.constructor.name, e.name, e.message, e.code, e.status, e.response.status], ['AxiosError', 'AxiosError', 'x', 'ECONNABORTED', 500, 429]);
  assert.ok(e instanceof Error);
  assert.equal(platformClass(e), 'AxiosError');
  assert.equal(platformClass(null), 'Error');
  assert.equal(platformClass(Object.assign(Object.create(null), { name: 'N' })), 'N');
});

test('the sandbox cron wrapper persists the class beside the message on every failure row', () => {
  const rows = runCron('J', load().seeds.slice(0, 2), 'ellis');
  assert.deepEqual(rows[0], { id: 'J-run-1', action: 'J', result: 'failed', reason: 'timeout of 30000ms exceeded', details: { error_class: 'TimeoutError' }, created_at: 'seed:timeout-axios' });
  assert.equal(rows[1].details!.error_class, 'TimeoutError');
});

test('graded as the subject, the platform\'s rule fails the acceptance and every seed but the two whose library class is already in the vocabulary', () => {
  const r = rehearse(load(), { subject: 'platform', control: 'ellis' });
  assert.deepEqual(r.seeds.filter((s) => r.checks[s.id]).map((s) => s.id), ['rate-sdk', 'validation-sequelize']);
  assert.deepEqual([r.checks.three_kinds_three_classes, r.checks.control_fails_acceptance], [false, false]);
  assert.equal(r.verified, false);
});

test('a fixture where one kind spans two classes, or two kinds share one, is not grouped apart', () => {
  const base = load().seeds;
  const odd: Seed = { id: 'odd', kind: 'timeout', error: { thrown_as: 'Error', message: 'm', status: 429 }, expect: 'RateLimitError' };
  assert.equal(rehearse({ ...load(), seeds: [...base, odd] }).checks.three_kinds_three_classes, false);
  const shared: Seed = { id: 'shared', kind: 'validation', error: { thrown_as: 'Error', message: 'm', code: 'ETIMEDOUT' }, expect: 'TimeoutError' };
  const r = rehearse({ ...load(), seeds: [...base.filter((s) => s.kind !== 'validation'), shared] });
  assert.equal(r.checks.three_kinds_three_classes, false);
  assert.equal(r.checks.shared, true);
  const generic: Seed = { id: 'generic', kind: 'validation', error: { thrown_as: 'Error', message: 'm' }, expect: UNCLASSIFIED };
  assert.equal(rehearse({ ...load(), seeds: [...base.filter((s) => s.kind !== 'validation'), generic] }).checks.three_kinds_three_classes, false, 'a kind in the generic class fails');
});

test('the same fixture always gives the same rehearsal, and the fixture itself is not changed', () => {
  const f = load();
  const before = JSON.stringify(f);
  assert.deepEqual(rehearse(f), rehearse(f));
  assert.equal(JSON.stringify(f), before);
});

test('in the shared output, a verified rehearsal is ok citing each seed and says it is not production; misclassified seeds are the evidence when it fails', () => {
  const c = { captured_at: '2026-11-05T13:00:00Z', captured_by: 'test' };
  const r = rehearse(load());
  const o = classRehearsalOutput(r, c, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 11);
  assert.match(o.as_of.note!, /sandbox fixture error-class-sandbox-1, not production/);
  assert.deepEqual(o.blind_spots, r.limits);
  const wrong: Seed = { id: 'wrong', kind: 'auth', error: { thrown_as: 'Error', message: 'm' }, expect: 'AuthError' };
  const f = classRehearsalOutput(rehearse({ ...load(), seeds: [...load().seeds, wrong] }), c, EMPTY);
  assert.equal(f.verdict, 'problem');
  assert.deepEqual(f.evidence.map((x) => x.id), ['wrong']);
});

test('a fixture is refused with no seeds, a malformed seed or a missing acceptance kind; the command exits 0, 3 and 1', () => {
  const base = load();
  const s0 = base.seeds[0];
  const bad: ClassFixture[] = [
    { ...base, seeds: [] }, { ...base, job: 1 as never }, { ...base, fixture_id: undefined as never },
    { ...base, seeds: [{ ...s0, id: 1 as never }] }, { ...base, seeds: [{ ...s0, kind: undefined as never }] }, { ...base, seeds: [{ ...s0, expect: undefined as never }] },
    { ...base, seeds: [{ ...s0, error: { ...s0.error, thrown_as: 'not a class' } }] }, { ...base, seeds: [{ ...s0, error: { ...s0.error, message: undefined as never } }] },
    { ...base, seeds: [{ ...s0, error: undefined as never }] },
  ];
  for (const f of bad) assert.throws(() => checkFixture(f, 'inline'), /needs/);
  assert.throws(() => checkFixture({ ...base, seeds: base.seeds.filter((s) => s.kind !== 'rate_limit') }, 'inline'), /no seed of kind rate_limit/);
  assert.equal(checkFixture(base, 'inline').seeds.length, 11);
  const ok = spawnSync(process.execPath, ['src/cli/errorClassRehearsal.ts', '--fixture', FIXTURE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const not = spawnSync(process.execPath, ['src/cli/errorClassRehearsal.ts', '--fixture', 'test/fixtures/error-class-wrong-expect.json'], { encoding: 'utf8' });
  assert.equal(not.status, 3, not.stderr);
  assert.equal(spawnSync(process.execPath, ['src/cli/errorClassRehearsal.ts'], { encoding: 'utf8' }).status, 1);
  const missing = spawnSync(process.execPath, ['src/cli/errorClassRehearsal.ts', '--fixture', 'examples/nope.json'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
