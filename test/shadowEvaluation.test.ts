import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ContractViolation, type SharedVerdict } from '../src/output/toolOutput.ts';
import {
  classify, evaluateShadow, type ReferenceVerdict, type ShadowCriteria, type ShadowObservation,
} from '../src/shadow/shadowEvaluation.ts';

// Test inputs shaped like recorded Ellis outputs and reviewed outcomes; not production data.
const TOOL = 'platform.CAP.cron_health_alerting';
const OTHER = 'platform.CAP.security_oversight_rollup';

function obs(id: string, ellis: SharedVerdict, ref: ReferenceVerdict | null, over: Partial<ShadowObservation> = {}): ShadowObservation {
  const tool = over.tool ?? TOOL;
  return {
    id, tool, subject: `job-${id}`, observed_at: `2026-11-10T0${id.length % 9}:00:00Z`,
    ellis: { tool, verdict: ellis, evidence: ellis === 'problem' || ellis === 'ok' ? [{ table: 'cron_job_runs', id: `r-${id}`, fields: ['status'] }] : [] },
    reference: ref === null ? null : { verdict: ref, source: 'platform check', approved_by: 'K.D.', approved_at: '2026-11-10T12:00:00Z' },
    ...over,
  };
}

function criteria(over: Partial<ShadowCriteria['tools'][string]> = {}, tool = TOOL): ShadowCriteria {
  return { owner: 'K.D.', status: 'test', tools: { [tool]: { max_miss_rate: 0.25, max_false_alarm_rate: 0.25, min_observations: 4, ...over } } };
}

// 2 caught, 1 miss, 3 agreed ok, 1 false alarm: miss 1/3, false alarm 1/4.
const MIXED = [
  obs('a', 'problem', 'problem'), obs('b', 'problem', 'problem'), obs('c', 'ok', 'problem'),
  obs('d', 'ok', 'ok'), obs('e', 'ok', 'ok'), obs('f', 'ok', 'ok'), obs('g', 'problem', 'ok'),
];

test('classify: the four agreements and disagreements, and unknowns kept apart', () => {
  assert.equal(classify('problem', 'problem'), 'caught');
  assert.equal(classify('ok', 'ok'), 'agreed_ok');
  assert.equal(classify('ok', 'problem'), 'miss');
  assert.equal(classify('problem', 'ok'), 'false_alarm');
  assert.equal(classify('unknown', 'problem'), 'unseen_problem');
  assert.equal(classify('partly_unknown', 'problem'), 'unseen_problem');
  assert.equal(classify('unknown', 'ok'), 'unknown_on_ok');
});

test('happy path: counts and rates carry their numerator and denominator', () => {
  const t = evaluateShadow(MIXED, criteria({ max_miss_rate: 0.5, max_false_alarm_rate: 0.5 })).tools[0];
  assert.deepEqual(t.counts, { caught: 2, agreed_ok: 3, miss: 1, unseen_problem: 0, false_alarm: 1, unknown_on_ok: 0 });
  assert.deepEqual([t.miss_rate.numerator, t.miss_rate.denominator], [1, 3]);
  assert.deepEqual([t.false_alarm_rate.numerator, t.false_alarm_rate.denominator], [1, 4]);
  assert.deepEqual(t.misses, ['c']);
  assert.deepEqual(t.false_alarms, ['g']);
  assert.equal(t.judgement, 'meets');
});

test('a rate above K.D.\'s limit does not meet, and says which and by how much', () => {
  const r = evaluateShadow(MIXED, criteria());
  assert.equal(r.judgement, 'does_not_meet');
  assert.equal(r.tools[0].judgement, 'does_not_meet');
  assert.match(r.tools[0].reasons.join(' '), /miss rate 1\/3 is above the limit of 0.25/);
  assert.doesNotMatch(r.tools[0].reasons.join(' '), /false alarm/);
});

test('a rate exactly at the limit meets', () => {
  const t = evaluateShadow(MIXED, criteria({ max_miss_rate: 1 / 3, max_false_alarm_rate: 0.25 })).tools[0];
  assert.equal(t.judgement, 'meets');
});

test('no limits set: not judged, naming the limits K.D. has not set', () => {
  const r = evaluateShadow(MIXED, criteria({ max_miss_rate: null, min_observations: null }));
  assert.equal(r.judgement, 'not_judged');
  assert.match(r.tools[0].reasons[0], /K\.D\. has not set max_miss_rate, min_observations for platform\.CAP\.cron_health_alerting/);
  const none = evaluateShadow(MIXED, { owner: 'K.D.', status: 'not set', tools: {} });
  assert.match(none.tools[0].reasons[0], /has not set max_miss_rate, max_false_alarm_rate, min_observations/);
});

test('the shipped criteria file sets no limits, so nothing is judged today', () => {
  const shipped = JSON.parse(readFileSync(new URL('../governance/shadow-criteria.json', import.meta.url), 'utf8')) as ShadowCriteria;
  assert.equal(shipped.owner, 'K.D.');
  for (const t of Object.values(shipped.tools)) assert.deepEqual(t, { max_miss_rate: null, max_false_alarm_rate: null, min_observations: null });
  assert.equal(evaluateShadow(MIXED.map((o) => o), shipped).judgement, 'not_judged');
});

test('an unknown on a real problem counts with the misses; an unknown on an ok is not a false alarm', () => {
  const t = evaluateShadow([
    obs('a', 'problem', 'problem'), obs('b', 'unknown', 'problem'), obs('c', 'partly_unknown', 'ok'), obs('d', 'ok', 'ok'),
  ], criteria({ min_observations: 1, max_miss_rate: 1, max_false_alarm_rate: 0 })).tools[0];
  assert.deepEqual([t.miss_rate.numerator, t.miss_rate.denominator], [1, 2]);
  assert.deepEqual(t.misses, ['b']);
  assert.deepEqual([t.false_alarm_rate.numerator, t.false_alarm_rate.denominator], [0, 2]);
  assert.equal(t.counts.unknown_on_ok, 1);
  assert.equal(t.judgement, 'meets');
});

test('only approved references are scored; the rest are listed as unreferenced', () => {
  const unapproved = obs('x', 'ok', 'problem');
  (unapproved.reference as { approved_by: string | null }).approved_by = null;
  const blank = obs('y', 'ok', 'problem');
  (blank.reference as { approved_by: string | null }).approved_by = '  ';
  const t = evaluateShadow([...MIXED, unapproved, blank, obs('z', 'ok', null)], criteria({ max_miss_rate: 0.5, max_false_alarm_rate: 0.5 })).tools[0];
  assert.deepEqual(t.unreferenced, ['x', 'y', 'z']);
  assert.equal(t.observations, 10);
  assert.equal(t.scored, 7);
  assert.deepEqual(t.misses, ['c']);
});

test('boundary: no reference problems is not a 0% miss rate, and is not judged', () => {
  const t = evaluateShadow([obs('a', 'ok', 'ok'), obs('b', 'ok', 'ok'), obs('c', 'ok', 'ok'), obs('d', 'ok', 'ok')], criteria()).tools[0];
  assert.equal(t.miss_rate.value, null);
  assert.equal(t.miss_rate.denominator, 0);
  assert.match(t.miss_rate.note as string, /no approved reference problems/);
  assert.equal(t.judgement, 'not_judged');
});

test('boundary: no reference oks means false alarms cannot be measured', () => {
  const t = evaluateShadow([obs('a', 'problem', 'problem'), obs('b', 'problem', 'problem'), obs('c', 'problem', 'problem'), obs('d', 'problem', 'problem')], criteria()).tools[0];
  assert.equal(t.false_alarm_rate.value, null);
  assert.equal(t.judgement, 'not_judged');
});

test('boundary: fewer scored observations than K.D. requires is not judged, even with perfect agreement', () => {
  const t = evaluateShadow([obs('a', 'problem', 'problem'), obs('b', 'ok', 'ok')], criteria({ min_observations: 3 })).tools[0];
  assert.equal(t.judgement, 'not_judged');
  assert.match(t.reasons.join(' '), /2 scored observations, fewer than the 3 required/);
});

test('boundary: no observations at all is not judged, with an empty window', () => {
  const r = evaluateShadow([], criteria());
  assert.equal(r.judgement, 'not_judged');
  assert.deepEqual(r.tools, []);
  assert.deepEqual(r.window, { from: null, to: null });
});

test('one tool that does not meet makes the whole run not meet; all must meet to meet', () => {
  const good = [obs('p', 'problem', 'problem', { tool: OTHER }), obs('q', 'ok', 'ok', { tool: OTHER })];
  const both: ShadowCriteria = { owner: 'K.D.', status: 'test', tools: { ...criteria().tools, ...criteria({ min_observations: 2 }, OTHER).tools } };
  assert.equal(evaluateShadow([...MIXED, ...good], both).judgement, 'does_not_meet');
  assert.equal(evaluateShadow(good, both).judgement, 'meets');
  const partly: ShadowCriteria = { owner: 'K.D.', status: 'test', tools: criteria({ min_observations: 2 }, OTHER).tools };
  assert.equal(evaluateShadow([...good, obs('z', 'ok', 'ok')], partly).judgement, 'not_judged');
});

test('shadow mode: the report says it acted on nothing', () => {
  const r = evaluateShadow(MIXED, criteria());
  assert.equal(r.mode, 'shadow');
  assert.equal(r.acted_on, false);
});

test('idempotent: the same observations in any order give the same report', () => {
  const c = criteria({ max_miss_rate: 0.5, max_false_alarm_rate: 0.5 });
  const many = [...MIXED, obs('h', 'ok', 'problem'), obs('i', 'problem', 'ok'), obs('j', 'ok', null), obs('k', 'ok', null), obs('m', 'ok', 'ok', { tool: OTHER })];
  const a = evaluateShadow(many, c);
  const b = evaluateShadow([...many].reverse(), c);
  assert.deepEqual(a, b);
  assert.deepEqual(a.tools[0].misses, ['c', 'h']);
  assert.deepEqual(a.tools[0].unreferenced, ['j', 'k']);
  assert.deepEqual(a.tools.map((t) => t.tool), [TOOL, OTHER].sort());
  assert.deepEqual(evaluateShadow(many, c), a);
});

test('failure path: a repeated observation id is refused, not counted twice', () => {
  assert.throws(() => evaluateShadow([...MIXED, obs('a', 'problem', 'problem')], criteria()), (e: Error) => e instanceof ContractViolation && /appears twice/.test(e.message));
});

test('failure path: malformed observations are refused with ContractViolation', () => {
  const bad: Array<[string, ShadowObservation]> = [
    ['tool mismatch', { ...obs('a', 'ok', 'ok'), ellis: { tool: OTHER, verdict: 'ok', evidence: [{ table: 't', id: '1', fields: [] }] } }],
    ['bad verdict', { ...obs('a', 'ok', 'ok'), ellis: { tool: TOOL, verdict: 'healthy' as SharedVerdict, evidence: [{ table: 't', id: '1', fields: [] }] } }],
    ['no evidence', { ...obs('a', 'ok', 'ok'), ellis: { tool: TOOL, verdict: 'ok', evidence: [] } }],
    ['bad reference', { ...obs('a', 'ok', 'ok'), reference: { verdict: 'unknown' as ReferenceVerdict, source: 'x', approved_by: 'K.D.', approved_at: null } }],
    ['no source', { ...obs('a', 'ok', 'ok'), reference: { verdict: 'ok', source: '', approved_by: 'K.D.', approved_at: null } }],
    ['bad time', { ...obs('a', 'ok', 'ok'), observed_at: 'yesterday' }],
    ['no id', { ...obs('a', 'ok', 'ok'), id: '' }],
  ];
  for (const [why, o] of bad) assert.throws(() => evaluateShadow([o], criteria()), ContractViolation, why);
});

test('failure path: limits outside their range are refused', () => {
  for (const over of [{ max_miss_rate: 1.5 }, { max_false_alarm_rate: -0.1 }, { min_observations: 0 }, { min_observations: 2.5 }]) {
    assert.throws(() => evaluateShadow(MIXED, criteria(over)), ContractViolation, JSON.stringify(over));
  }
});

test('CLI: the example runs, judges nothing under the shipped criteria, and exits 3', () => {
  const run = spawnSync(process.execPath, ['src/cli/shadowEvaluation.ts', '--observations', 'examples/shadow-observations.example.json'], { encoding: 'utf8' });
  assert.equal(run.status, 3, run.stderr);
  const r = JSON.parse(run.stdout);
  assert.equal(r.judgement, 'not_judged');
  assert.equal(r.acted_on, false);
});

test('CLI: bad input exits 1 with an error class', () => {
  const run = spawnSync(process.execPath, ['src/cli/shadowEvaluation.ts', '--observations', 'no-such-file.json'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stderr).error_class, 'SourceUnavailable');
});
