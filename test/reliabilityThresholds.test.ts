import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { thresholdReport, locate, toNumber, LEDGER, LIMITS, type AlertRecord, type AlertRow, type Threshold } from '../src/capabilities/reliabilityThresholds.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const CRON = 'backend/src/services/cronHealthAlertService.ts';
const REL = 'backend/src/services/reliabilityAlertingService.ts';
const SPIKE = 'backend/src/services/errorSpikeAlertService.ts';
const SCHED = 'backend/src/services/schedulerService.ts';
const CB = 'backend/src/routes/admin/cbSystemRoutes.ts';
const FILES: Record<string, string> = {
  [CRON]: `// Starting defaults per Person's decision on a ticket
// Someone's discretion, tuned conservatively to avoid noise.

const RECENT_RUN_SAMPLE_SIZE = 10;
const MIN_SAMPLE_SIZE = 5;
const ERROR_RATE_WARNING_PERCENT = 50;
const ERROR_RATE_CRITICAL_PERCENT = 80;
const MISSED_RUN_WARNING_MULTIPLIER = 2;
const MISSED_RUN_CRITICAL_MULTIPLIER = 4;
emitAlert({});
`,
  [REL]: `const WINDOW_MINUTES = 15;
const MIN_SAMPLE_SIZE = 20; // below this, skip
const ERROR_RATE_THRESHOLD_PCT = 25;
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h
`,
  'backend/src/services/deadLetterService.ts': 'const MAX_CONSECUTIVE_FAILURES = 3;\n',
  [SPIKE]: `// Conservative defaults per Person's "tune conservatively to avoid noise."
const WARNING_COUNT = 10;
const CRITICAL_COUNT = 25;
const WINDOW_HOURS = 1;
const THRESHOLD_OVERRIDES: Record<string, { warning: number; critical: number }> = {
  admin_auth_failed: { warning: 150, critical: 250 },
  participant_auth_failed: { warning: 30, critical: 60 },
  delivery_client_link_request_error: { warning: 1, critical: 3 },
  delivery_client_redeem_error: { warning: 1, critical: 3 },
};
`,
  'backend/src/services/alertService.ts': 'const RENOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;\n',
  [SCHED]: `function x() {
      const twoHoursMs = 2 * 60 * 60 * 1000;
}
`,
  [CB]: `const EXPECTED_TICKS_24H = 480; // every 3 min
    if (sync && sync.errors.length > 5) flags.push({ level: 'yellow', msg: 'a' });
      if (tick.tick_count < 200) flags.push({ level: 'red', msg: 'a' });
      else if (tick.tick_count < 400) flags.push({ level: 'yellow', msg: 'a' });
    if (tick.max_gap_minutes > 30) flags.push({ level: 'yellow', msg: 'a' });
    if (tick.error_count > 20) flags.push({ level: 'red', msg: 'a' });
    else if (tick.error_count > 5) flags.push({ level: 'yellow', msg: 'a' });
`,
  'backend/src/services/otherHealthService.ts': 'const ERROR_RATE_THRESHOLD = 0.3;\nconst notAThreshold = 1;\n',
  'backend/src/services/aiOpsScheduler.ts': 'export const x = 1;\n',
  'backend/src/services/plainService.ts': 'const QUALITY_THRESHOLD = 9;\n',
  'backend/src/services/__tests__/thing.test.ts': 'const FAKE_THRESHOLD = 1; emitAlert();\n',
};
const dirsOf = (files: Record<string, string>) => new Set(Object.keys(files).flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
const readerOf = (files: Record<string, string>): Reader => ({
  read(p) { if (files[p] === undefined) throw new Error(`no ${p}`); return files[p]; },
  list(dir) { if (!dirsOf(files).has(dir)) throw new Error(`no ${dir}`); return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const ask = (record: AlertRecord | null = null, files = FILES) => thresholdReport(readerOf(files), 'abc', record);
const pick = (ts: Threshold[], file: string, name: string) => ts.find((t) => t.file === file && t.name === name)!;
const record = (alerts: AlertRow[], total = alerts.length): AlertRecord => ({ captured_at: '2026-11-01T00:00:00Z', total, alerts });

test('each threshold is reported with its source file and line', () => {
  const a = ask();
  assert.equal(a.thresholds.length, LEDGER.length);
  assert.equal(a.inventory_complete, true);
  for (const t of a.thresholds) {
    assert.equal(t.located, 'read', t.name);
    assert.equal(t.where, `${t.file}:${t.line}`);
    assert.ok(FILES[t.file].split('\n')[t.line! - 1].includes(t.value!), t.name);
  }
  const rate = pick(a.thresholds, CRON, 'ERROR_RATE_WARNING_PERCENT');
  assert.deepEqual([rate.line, rate.value, rate.number], [6, '50', 50]);
  const flag = pick(a.thresholds, CB, 'dispatcher_ticks.yellow_below');
  assert.deepEqual([flag.line, flag.value], [4, '400']);
  const over = pick(a.thresholds, SPIKE, 'THRESHOLD_OVERRIDES.admin_auth_failed.critical');
  assert.deepEqual([over.line, over.value], [6, '250']);
  assert.equal(pick(a.thresholds, SCHED, 'twoHoursMs').number, 7_200_000);
});

test('a threshold whose alert outcomes were never recorded is reported as unmeasured, not as well-tuned', () => {
  const a = ask();
  assert.equal(a.counts.unmeasured, a.thresholds.length);
  for (const t of a.thresholds) {
    assert.equal(t.producing.state, 'unmeasured', t.name);
    assert.equal(t.producing.false_positive_rate, null);
  }
  const onTable = pick(a.thresholds, CRON, 'MIN_SAMPLE_SIZE').producing;
  assert.equal(onTable.state === 'unmeasured' && onTable.reason, 'no_alert_record_read');
  assert.doesNotMatch(JSON.stringify({ s: a.statement, t: a.thresholds }), /well[- ]tuned|healthy|\bgood\b/i);
  assert.match(a.statement, new RegExp(`^${a.thresholds.length} thresholds across 7 files: ${a.thresholds.length} unmeasured, 0 with some outcomes recorded, none with a false-positive rate; 1 threshold-shaped names sit outside`));
});

test('the line and value come from the checkout, so a moved or changed number is read as it now stands', () => {
  const a = ask(null, { ...FILES, [CRON]: `// moved\n${FILES[CRON].replace('PERCENT = 50', 'PERCENT = 60')}` });
  const t = pick(a.thresholds, CRON, 'ERROR_RATE_WARNING_PERCENT');
  assert.deepEqual([t.line, t.value], [7, '60']);
});

test('a number that cannot be found makes the inventory incomplete rather than dropping it', () => {
  const a = ask(null, { ...FILES, [REL]: FILES[REL].replace('const COOLDOWN_MS', 'const RENAMED') });
  const t = pick(a.thresholds, REL, 'COOLDOWN_MS');
  assert.deepEqual([t.located, t.line, t.where, t.value], ['not_found', null, null, null]);
  assert.equal(a.inventory_complete, false);
  assert.equal(a.counts.not_located, 1);
  assert.match(a.statement, /^incomplete: 1 of \d+ thresholds could not be read$/);
});

test('a missing file reports each of its numbers as not found', () => {
  const f = { ...FILES };
  delete f[SCHED];
  const a = ask(null, f);
  assert.equal(pick(a.thresholds, SCHED, 'twoHoursMs').located, 'not_found');
  assert.equal(a.inventory_complete, false);
});

test('two matching lines are refused instead of one being picked', () => {
  const e = LEDGER.find((x) => x.name === 'twoHoursMs')!;
  assert.equal(locate('const twoHoursMs = 1;\nconst twoHoursMs = 2;\n', e), 'more_than_one_match');
  const a = ask(null, { ...FILES, [SCHED]: `${FILES[SCHED]}${FILES[SCHED]}` });
  assert.equal(pick(a.thresholds, SCHED, 'twoHoursMs').located, 'more_than_one_match');
  assert.equal(a.inventory_complete, false);
});

test('a name inside a longer name is not taken for the constant', () => {
  const e = LEDGER.find((x) => x.name === 'WINDOW_HOURS')!;
  assert.equal(locate('const WINDOW_HOURS_MAX = 2;\n', e), 'not_found');
  assert.equal(locate('const INGEST_WINDOW_HOURS = 2;\n', e), 'not_found');
  assert.equal(locate('// const WINDOW_HOURS = 2;\n', e), 'not_found');
});

test('numbers reduce only when every factor is a number', () => {
  assert.equal(toNumber('2 * 60 * 60 * 1000'), 7_200_000);
  assert.equal(toNumber('86_400_000'), 86_400_000);
  assert.equal(toNumber('0.3'), 0.3);
  assert.equal(toNumber('HOUR * 2'), null);
  assert.equal(toNumber(''), null);
});

test('numbers with no outcome path stay unmeasured whatever the alert record holds', () => {
  const a = ask(record([{ title: 'Reliability Alert: 40%', status: 'resolved' }]));
  for (const [file, name] of [[REL, 'ERROR_RATE_THRESHOLD_PCT'], [SCHED, 'twoHoursMs'], [CB, 'dispatcher_ticks.red_below'], ['backend/src/services/deadLetterService.ts', 'MAX_CONSECUTIVE_FAILURES']]) {
    const p = pick(a.thresholds, file, name).producing;
    assert.deepEqual([p.state, p.state === 'unmeasured' && p.reason], ['unmeasured', 'no_outcome_record_exists'], name);
  }
});

test('alerts that fired with no outcome are volume, not measurement', () => {
  const a = ask(record([{ title: 'Cron Job Error Spike: A', status: 'active', metadata: { occurrence_count: 4 } }, { title: 'Cron Job Error Spike: B', status: 'acknowledged' }]));
  assert.deepEqual(pick(a.thresholds, CRON, 'ERROR_RATE_WARNING_PERCENT').producing, { state: 'unmeasured', reason: 'fired_with_no_outcome', alerts: 2, occurrences: 5, false_positive_rate: null });
});

test('recorded outcomes are counted, and a dismissal never becomes a false-positive rate', () => {
  const a = ask(record([
    { title: 'Cron Job Missed Runs: A', status: 'dismissed', metadata: { occurrence_count: 3 } },
    { title: 'Cron Job Missed Runs: B', status: 'resolved' },
    { title: 'Cron Job Missed Runs: C', status: 'active' },
  ]));
  assert.deepEqual(pick(a.thresholds, CRON, 'MISSED_RUN_WARNING_MULTIPLIER').producing, { state: 'outcomes_recorded', alerts: 3, occurrences: 5, open: 1, resolved: 1, dismissed: 1, false_positive_rate: null });
  assert.equal(a.counts.outcomes_recorded, 2);
  assert.equal(a.counts.unmeasured, a.thresholds.length - 2);
  assert.match(a.statement, /2 with some outcomes recorded, none with a false-positive rate/);
});

test('alerts go to the number that raised them, and a per-type override takes only its own type', () => {
  const a = ask(record([{ title: 'Cron Job Error Spike: A', status: 'resolved' }, { title: 'Error Spike: admin_auth_failed', status: 'resolved' }, { title: 'Error Spike: apollo_failed', status: 'resolved' }]));
  const alerts = (f: string, n: string) => { const p = pick(a.thresholds, f, n).producing; return p.alerts; };
  assert.equal(alerts(CRON, 'ERROR_RATE_WARNING_PERCENT'), 1);
  assert.equal(alerts(SPIKE, 'WARNING_COUNT'), 2);
  assert.equal(alerts(SPIKE, 'THRESHOLD_OVERRIDES.admin_auth_failed.warning'), 1);
  assert.equal(alerts(SPIKE, 'THRESHOLD_OVERRIDES.participant_auth_failed.warning'), 0);
});

test('a number shared by every alert cannot be attributed and says so', () => {
  const p = pick(ask(record([{ title: 'Error Spike: x', status: 'resolved' }])).thresholds, 'backend/src/services/alertService.ts', 'RENOTIFY_INTERVAL_MS').producing;
  assert.deepEqual([p.state, p.state === 'unmeasured' && p.reason], ['unmeasured', 'not_attributable_to_alert_titles']);
});

test('silence in a full record stays unmeasured, and absence from a partial record says nothing', () => {
  const full = pick(ask(record([{ title: 'Other', status: 'active' }])).thresholds, CRON, 'ERROR_RATE_WARNING_PERCENT').producing;
  assert.equal(full.state === 'unmeasured' && full.reason, 'nothing_fired_in_record');
  const partial = ask(record([{ title: 'Other', status: 'active' }], 900));
  const p = pick(partial.thresholds, CRON, 'ERROR_RATE_WARNING_PERCENT').producing;
  assert.equal(p.state === 'unmeasured' && p.reason, 'not_in_a_partial_record');
  assert.deepEqual(partial.alert_record, { read: true, captured_at: '2026-11-01T00:00:00Z', rows: 1, total: 900, complete: false });
  assert.equal(ask(record([])).alert_record.complete, true);
  assert.equal(ask().alert_record.complete, false);
});

test('a name in a source comment is a claim, and no review is ever reported', () => {
  const a = ask();
  assert.equal(pick(a.thresholds, CRON, 'MIN_SAMPLE_SIZE').owner_claim_at, `${CRON}:1`);
  assert.equal(pick(a.thresholds, SPIKE, 'WARNING_COUNT').owner_claim_at, `${SPIKE}:1`);
  assert.equal(pick(a.thresholds, REL, 'MIN_SAMPLE_SIZE').owner_claim_at, null);
  assert.ok(a.thresholds.every((t) => t.owner_review_on_record === false));
  assert.equal(a.counts.owner_claimed_never_reviewed + a.counts.no_owner_named, a.thresholds.length);
  assert.equal(a.counts.owner_claimed_never_reviewed, 17);
  const notAComment = ask(null, { ...FILES, [REL]: `const s = "Someone's discretion";\n${FILES[REL]}` });
  assert.equal(pick(notAComment.thresholds, REL, 'MIN_SAMPLE_SIZE').owner_claim_at, null);
});

test('the same kind of number set differently across services is shown side by side', () => {
  const a = ask();
  assert.deepEqual(a.same_concept_different_numbers.map((g) => g.concept).sort(), ['alert_cooldown', 'error_rate_limit', 'minimum_sample']);
  const sample = a.same_concept_different_numbers.find((g) => g.concept === 'minimum_sample')!;
  assert.deepEqual(sample.values.map((v) => [v.where, v.number]), [[`${CRON}:5`, 5], [`${REL}:2`, 20]]);
  const same = ask(null, { ...FILES, [REL]: FILES[REL].replace('SIZE = 20', 'SIZE = 5') });
  assert.ok(!same.same_concept_different_numbers.some((g) => g.concept === 'minimum_sample'));
});

test('the sweep lists unlisted names in alerting files and skips the ledger, tests and other files', () => {
  const a = ask();
  assert.deepEqual(a.outside_the_inventory, [{ where: 'backend/src/services/otherHealthService.ts:1', name: 'ERROR_RATE_THRESHOLD', text: 'const ERROR_RATE_THRESHOLD = 0.3;' }]);
  const inCode = ask(null, { ...FILES, 'backend/src/routes/x.ts': 'emitAlert();\nexport const SOME_COOLDOWN = 1;\n' });
  assert.ok(inCode.outside_the_inventory.some((o) => o.where === 'backend/src/routes/x.ts:2'));
});

test('a sweep that cannot read reports incomplete instead of nothing outstanding', () => {
  const r = readerOf(FILES);
  const noList = thresholdReport({ ...r, list() { throw new Error('no'); } }, 'abc');
  assert.equal(noList.inventory_complete, false);
  assert.match(noList.statement, /and the sweep could not finish$/);
  const noFile = thresholdReport({ ...r, read(p) { if (p.includes('otherHealth')) throw new Error('no'); return r.read(p); } }, 'abc');
  assert.equal(noFile.inventory_complete, false);
});

test('this release proposes no number, and the decision stays with the owner', () => {
  const a = ask();
  assert.deepEqual([a.human_decision.setting_a_threshold, a.human_decision.owner, a.human_decision.proposals_in_this_release], ['person_only', 'K.D.', 0]);
  assert.match(a.human_decision.why_none, /never been measured/);
  assert.match(a.human_decision.applying_a_change, /deploy/);
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.ok(LIMITS.some((l) => /dismissal/.test(l)));
  assert.ok(LIMITS.some((l) => /Silence/.test(l)));
  assert.equal(a.source_commit, 'abc');
});

const CLI = 'src/cli/reliabilityThresholds.ts';
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
function checkout(files = FILES): string {
  const root = mkdtempSync(join(tmpdir(), 'thresholds-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

test('the CLI exits 4 while anything is unmeasured, reading a saved alert record', () => {
  const src = checkout();
  const r = run('--source', src);
  assert.equal(r.status, 4, r.stderr);
  const file = join(src, 'alerts.json');
  writeFileSync(file, JSON.stringify(record([{ title: 'Error Spike: x', status: 'resolved' }])));
  const r2 = run('--source', src, '--alerts', file);
  assert.equal(r2.status, 4);
  assert.equal(JSON.parse(r2.stdout).alert_record.read, true);
});

test('the CLI exits 5 for an unreadable inventory and 1 for bad input', () => {
  const f = { ...FILES };
  delete f[CB];
  assert.equal(run('--source', checkout(f)).status, 5);
  assert.equal(run().status, 1);
  const src = checkout();
  const file = join(src, 'bad.json');
  for (const bad of ['{', '{"alerts":[],"total":0}', '{"captured_at":"nope","alerts":[],"total":0}', '{"captured_at":"2026-11-01","alerts":[{"title":"x"}],"total":1}', '{"captured_at":"2026-11-01","alerts":[]}']) {
    writeFileSync(file, bad);
    const r = run('--source', src, '--alerts', file);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /ContractViolation|SourceUnavailable/);
  }
});
