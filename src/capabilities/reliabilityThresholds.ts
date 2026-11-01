// platform.reliability_threshold_ownership, first release behaviour (R2):
// reports every reliability threshold in the inventory, where it lives, and what it is producing. A threshold whose
// alert outcomes were never recorded is reported as unmeasured, never as well-tuned. Read-only: setting a number stays
// K.D.'s at every autonomy level, and this release proposes none, because the observed false-positive rate has never
// been measured. The constants are compiled in, so applying a change needs a deploy, and production_deploy is
// default-denied (delivery/execution/executionPolicy.ts:33-42).
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - The numbers are hardcoded across separate services, so tuning one tunes no other. The inventory below is the one
//   place they appear together. Each value and line is read from the checkout on every run, never copied here.
// - Only alerts raised through emitAlert leave a row with an outcome (backend/src/services/alertService.ts:206-237).
//   reliabilityAlertingService.ts:80 and schedulerService.ts:3401 send email directly and store nothing, and
//   cbSystemRoutes.ts:181-190 computes its flags on each read.
// - A dismissal records that a person closed an alert, not that it was false, so no rate can be derived from it.

import type { Reader } from './registryReconciliation.ts';

export type Delivery = 'alert_table' | 'email_only' | 'dead_letter_row' | 'response_only';
export type Concept = 'error_rate_limit' | 'error_count_limit' | 'minimum_sample' | 'overdue_multiplier' | 'consecutive_failures' | 'alert_cooldown' | 'measurement_window' | 'expected_volume' | 'status_flag_limit';

export interface LedgerEntry {
  file: string;
  name: string;
  concept: Concept;
  delivery: Delivery;
  // Alert title prefixes this number can raise. Empty on the alert table means rows cannot be attributed to it.
  fires?: readonly string[];
  // Finds a number that is not a top-level constant. Group 1 is the value.
  pattern?: RegExp;
  note?: string;
}

const CRON = 'backend/src/services/cronHealthAlertService.ts';
const REL = 'backend/src/services/reliabilityAlertingService.ts';
const DLQ = 'backend/src/services/deadLetterService.ts';
const SPIKE = 'backend/src/services/errorSpikeAlertService.ts';
const SCHED = 'backend/src/services/schedulerService.ts';
const CB = 'backend/src/routes/admin/cbSystemRoutes.ts';
const ALERTS = 'backend/src/services/alertService.ts';

const CRON_ERR = ['Cron Job Error Spike: '];
const CRON_MISS = ['Cron Job Missed Runs: '];
const SPIKES = ['Error Spike: '];
const MEASURED = 'A source comment records a one-off 7-day baseline to 2026-08-22. That is event volume, not alert outcomes.';
const override = (type: string, level: 'warning' | 'critical', note?: string): LedgerEntry => ({
  file: SPIKE, name: `THRESHOLD_OVERRIDES.${type}.${level}`, concept: 'error_count_limit', delivery: 'alert_table', fires: [`Error Spike: ${type}`],
  pattern: new RegExp(`^\\s*${type}: \\{.*\\b${level}: (\\d+)`), note,
});

export const LEDGER: readonly LedgerEntry[] = [
  { file: CRON, name: 'RECENT_RUN_SAMPLE_SIZE', concept: 'measurement_window', delivery: 'alert_table', fires: CRON_ERR },
  { file: CRON, name: 'MIN_SAMPLE_SIZE', concept: 'minimum_sample', delivery: 'alert_table', fires: CRON_ERR },
  { file: CRON, name: 'ERROR_RATE_WARNING_PERCENT', concept: 'error_rate_limit', delivery: 'alert_table', fires: CRON_ERR },
  { file: CRON, name: 'ERROR_RATE_CRITICAL_PERCENT', concept: 'error_rate_limit', delivery: 'alert_table', fires: CRON_ERR },
  { file: CRON, name: 'MISSED_RUN_WARNING_MULTIPLIER', concept: 'overdue_multiplier', delivery: 'alert_table', fires: CRON_MISS },
  { file: CRON, name: 'MISSED_RUN_CRITICAL_MULTIPLIER', concept: 'overdue_multiplier', delivery: 'alert_table', fires: CRON_MISS },
  { file: REL, name: 'WINDOW_MINUTES', concept: 'measurement_window', delivery: 'email_only' },
  { file: REL, name: 'MIN_SAMPLE_SIZE', concept: 'minimum_sample', delivery: 'email_only' },
  { file: REL, name: 'ERROR_RATE_THRESHOLD_PCT', concept: 'error_rate_limit', delivery: 'email_only' },
  { file: REL, name: 'COOLDOWN_MS', concept: 'alert_cooldown', delivery: 'email_only' },
  { file: DLQ, name: 'MAX_CONSECUTIVE_FAILURES', concept: 'consecutive_failures', delivery: 'dead_letter_row' },
  { file: SPIKE, name: 'WARNING_COUNT', concept: 'error_count_limit', delivery: 'alert_table', fires: SPIKES },
  { file: SPIKE, name: 'CRITICAL_COUNT', concept: 'error_count_limit', delivery: 'alert_table', fires: SPIKES },
  { file: SPIKE, name: 'WINDOW_HOURS', concept: 'measurement_window', delivery: 'alert_table', fires: SPIKES },
  override('admin_auth_failed', 'warning', MEASURED),
  override('admin_auth_failed', 'critical', MEASURED),
  override('participant_auth_failed', 'warning', MEASURED),
  override('participant_auth_failed', 'critical', MEASURED),
  override('delivery_client_link_request_error', 'warning'),
  override('delivery_client_link_request_error', 'critical'),
  override('delivery_client_redeem_error', 'warning'),
  override('delivery_client_redeem_error', 'critical'),
  { file: ALERTS, name: 'RENOTIFY_INTERVAL_MS', concept: 'alert_cooldown', delivery: 'alert_table', fires: [] },
  { file: SCHED, name: 'twoHoursMs', concept: 'alert_cooldown', delivery: 'email_only', pattern: /^\s*const twoHoursMs = ([^;]+);/ },
  { file: CB, name: 'EXPECTED_TICKS_24H', concept: 'expected_volume', delivery: 'response_only' },
  { file: CB, name: 'dispatcher_ticks.red_below', concept: 'status_flag_limit', delivery: 'response_only', pattern: /tick_count < (\d+)\) flags\.push\(\{ level: 'red'/ },
  { file: CB, name: 'dispatcher_ticks.yellow_below', concept: 'status_flag_limit', delivery: 'response_only', pattern: /tick_count < (\d+)\) flags\.push\(\{ level: 'yellow'/ },
  { file: CB, name: 'dispatcher_gap_minutes.yellow_above', concept: 'status_flag_limit', delivery: 'response_only', pattern: /max_gap_minutes > (\d+)\) flags\.push\(\{ level: 'yellow'/ },
  { file: CB, name: 'dispatcher_errors.red_above', concept: 'status_flag_limit', delivery: 'response_only', pattern: /error_count > (\d+)\) flags\.push\(\{ level: 'red'/ },
  { file: CB, name: 'dispatcher_errors.yellow_above', concept: 'status_flag_limit', delivery: 'response_only', pattern: /error_count > (\d+)\) flags\.push\(\{ level: 'yellow'/ },
  { file: CB, name: 'sync_errors.yellow_above', concept: 'status_flag_limit', delivery: 'response_only', pattern: /errors\.length > (\d+)\) flags\.push\(\{ level: 'yellow'/ },
];

// Files read for numbers the ledger does not hold. Alerting files only, so the list stays readable.
export const SWEEP_ROOTS = ['backend/src/services', 'backend/src/routes'] as const;
const THRESHOLD_NAME = /^\s*(?:export )?const ([A-Z][A-Z0-9_]*(?:THRESHOLD|COOLDOWN|MULTIPLIER|MIN_SAMPLE|SAMPLE_SIZE|WARNING|CRITICAL|MAX_CONSECUTIVE|ERROR_RATE|_PCT|PERCENT|RENOTIFY)[A-Z0-9_]*)\b/;
const ALERTS_SOMEONE = /\b(emitAlert|sendAlertEmail)\(|Health|Watch|Monitor/;

// A comment naming somebody's decision is a claim of ownership. It is not a review.
const OWNER_CLAIM = /'s discretion|defaults? per \w+'s/;

export type Reason = 'no_outcome_record_exists' | 'no_alert_record_read' | 'not_attributable_to_alert_titles' | 'nothing_fired_in_record' | 'not_in_a_partial_record' | 'fired_with_no_outcome';
export type Producing = {
  state: 'unmeasured';
  reason: Reason;
  alerts: number | null;
  occurrences: number | null;
  false_positive_rate: null;
} | {
  state: 'outcomes_recorded';
  alerts: number;
  occurrences: number;
  open: number;
  resolved: number;
  dismissed: number;
  false_positive_rate: null;
};

export interface Threshold {
  name: string;
  file: string;
  line: number | null;
  where: string | null;
  value: string | null;
  number: number | null;
  concept: Concept;
  delivery: Delivery;
  located: 'read' | 'not_found' | 'more_than_one_match';
  owner_claim_at: string | null;
  owner_review_on_record: false;
  producing: Producing;
  note?: string;
}

export interface AlertRow { title: string; status: string; metadata?: { occurrence_count?: number } | null }
export interface AlertRecord { captured_at: string; total: number; alerts: AlertRow[] }

export interface ThresholdAnswer {
  source_commit: string | null;
  statement: string;
  inventory_complete: boolean;
  counts: { thresholds: number; files: number; unmeasured: number; outcomes_recorded: number; not_located: number; owner_claimed_never_reviewed: number; no_owner_named: number; outside_the_inventory: number };
  thresholds: Threshold[];
  same_concept_different_numbers: Array<{ concept: Concept; values: Array<{ where: string | null; name: string; number: number | null }> }>;
  outside_the_inventory: Array<{ where: string; name: string; text: string }>;
  alert_record: { read: boolean; captured_at: string | null; rows: number; total: number | null; complete: boolean };
  human_decision: { setting_a_threshold: 'person_only'; owner: 'K.D.'; ellis_may: 'report_and_propose'; proposals_in_this_release: 0; why_none: string; applying_a_change: string };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'No false-positive rate exists, so none is given. A dismissal says a person closed an alert, not that it was false.',
  'Incident detection latency is not measured here. Nothing links an alert to the incident it caught, or to the incident it missed.',
  'Unmeasured does not mean badly tuned. It means there is no evidence either way.',
  'Silence is not evidence. A threshold that fired nothing may be well set or may be missing incidents, and the record cannot say which.',
  'The inventory is a fixed list and can fall behind the platform. The sweep shows threshold-shaped names in alerting files that are not on it. It reads names only, so numbers outside those files, or under other names, are not seen.',
  'Owner claims come from source comments. The platform has no place to record an owner\'s review, so none can be read.',
  'The source shows the number in the commit read, not the running deploy.',
];

// Windows are in runs, minutes and hours, and flag limits measure different things. Comparing their numbers says nothing.
const UNLIKE: readonly Concept[] = ['measurement_window', 'status_flag_limit'];
const clip = (s: string) => s.trim().slice(0, 170);
const WHY_NONE = 'The observed false-positive rate has never been measured, so no proposal could be evidence-based.';
const APPLYING = 'The numbers are compiled in, so a change needs a deploy, and production_deploy is default-denied for agents.';

// `2 * 60 * 60 * 1000` and `86_400_000` both reduce to a number. Anything else stays null, shown as written.
export function toNumber(expr: string): number | null {
  const parts = expr.split('*').map((p) => p.trim().replace(/_/g, ''));
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((a, p) => a * Number(p), 1);
}

export function locate(text: string, e: LedgerEntry): { line: number; value: string } | 'not_found' | 'more_than_one_match' {
  const re = e.pattern ?? new RegExp(`^\\s*(?:export )?const ${e.name}\\b[^=]*=\\s*([^;]+);`);
  const hits: Array<{ line: number; value: string }> = [];
  text.split('\n').forEach((l, i) => {
    const m = re.exec(l);
    if (m) hits.push({ line: i + 1, value: m[1].trim() });
  });
  if (hits.length === 0) return 'not_found';
  return hits.length > 1 ? 'more_than_one_match' : hits[0];
}

function producing(e: LedgerEntry, record: AlertRecord | null): Producing {
  const none = (reason: Reason, alerts: number | null = null, occurrences: number | null = null): Producing => ({ state: 'unmeasured', reason, alerts, occurrences, false_positive_rate: null });
  if (e.delivery !== 'alert_table') return none('no_outcome_record_exists');
  if (!record) return none('no_alert_record_read');
  if (!e.fires?.length) return none('not_attributable_to_alert_titles');
  const rows = record.alerts.filter((a) => e.fires!.some((p) => a.title.startsWith(p)));
  const occurrences = rows.reduce((n, a) => n + (a.metadata?.occurrence_count ?? 1), 0);
  // The alert list pages at 50 by default, so absence from a partial record says nothing.
  if (rows.length === 0) return none(record.alerts.length < record.total ? 'not_in_a_partial_record' : 'nothing_fired_in_record', 0, 0);
  const resolved = rows.filter((a) => a.status === 'resolved').length;
  const dismissed = rows.filter((a) => a.status === 'dismissed').length;
  if (resolved + dismissed === 0) return none('fired_with_no_outcome', rows.length, occurrences);
  return { state: 'outcomes_recorded', alerts: rows.length, occurrences, open: rows.length - resolved - dismissed, resolved, dismissed, false_positive_rate: null };
}

function sweep(r: Reader, sources: Map<string, string | null>): { found: ThresholdAnswer['outside_the_inventory']; complete: boolean } {
  const listed = new Set(LEDGER.map((e) => `${e.file}#${e.name}`));
  const found: ThresholdAnswer['outside_the_inventory'] = [];
  let complete = true;
  for (const root of SWEEP_ROOTS) {
    let files: string[];
    try {
      files = r.list(root);
    } catch {
      complete = false; // a sweep that could not run finds nothing, which must not read as nothing outstanding
      continue;
    }
    for (const file of files.filter((f) => f.endsWith('.ts') && !/__tests__\/|\.test\.ts$/.test(f))) {
      let text = sources.get(file) ?? null;
      if (text === null) {
        try {
          text = r.read(file);
        } catch {
          complete = false;
          continue;
        }
      }
      if (!ALERTS_SOMEONE.test(text) && !ALERTS_SOMEONE.test(file)) continue;
      text.split('\n').forEach((line, i) => {
        const m = THRESHOLD_NAME.exec(line);
        if (m && !listed.has(`${file}#${m[1]}`)) found.push({ where: `${file}:${i + 1}`, name: m[1], text: clip(line) });
      });
    }
  }
  return { found, complete };
}

export function thresholdReport(r: Reader, source_commit: string | null, record: AlertRecord | null = null): ThresholdAnswer {
  const sources = new Map<string, string | null>();
  for (const file of new Set(LEDGER.map((e) => e.file))) {
    try {
      sources.set(file, r.read(file));
    } catch {
      sources.set(file, null); // each entry in it then reports not_found, and the inventory reports incomplete
    }
  }
  const claimAt = (file: string) => {
    const lines = (sources.get(file) ?? '').split('\n');
    const i = lines.findIndex((l) => /^\s*(\/\/|\*)/.test(l) && OWNER_CLAIM.test(l));
    return i < 0 ? null : `${file}:${i + 1}`;
  };
  const thresholds: Threshold[] = LEDGER.map((e) => {
    const text = sources.get(e.file);
    const at = text == null ? 'not_found' : locate(text, e);
    const read = typeof at === 'object';
    return {
      name: e.name,
      file: e.file,
      line: read ? at.line : null,
      where: read ? `${e.file}:${at.line}` : null,
      value: read ? at.value : null,
      number: read ? toNumber(at.value) : null,
      concept: e.concept,
      delivery: e.delivery,
      located: read ? 'read' : at,
      owner_claim_at: claimAt(e.file),
      owner_review_on_record: false,
      producing: producing(e, record),
      ...(e.note ? { note: e.note } : {}),
    };
  });

  const { found, complete: sweepComplete } = sweep(r, sources);
  const notLocated = thresholds.filter((t) => t.located !== 'read').length;
  const inventory_complete = notLocated === 0 && sweepComplete;
  const recorded = thresholds.filter((t) => t.producing.state === 'outcomes_recorded').length;
  const concepts = [...new Set(thresholds.map((t) => t.concept))].filter((c) => !UNLIKE.includes(c));
  const same = concepts.flatMap((concept) => {
    const rows = thresholds.filter((t) => t.concept === concept);
    if (new Set(rows.map((t) => t.file)).size < 2 || new Set(rows.map((t) => t.number)).size < 2) return [];
    return [{ concept, values: rows.map((t) => ({ where: t.where, name: t.name, number: t.number })) }];
  });

  const statement = !inventory_complete
    ? `incomplete: ${notLocated} of ${thresholds.length} thresholds could not be read${sweepComplete ? '' : ', and the sweep could not finish'}`
    : `${thresholds.length} thresholds across ${sources.size} files: ${thresholds.length - recorded} unmeasured, ${recorded} with some outcomes recorded, none with a false-positive rate; ${found.length} threshold-shaped names sit outside the inventory`;

  return {
    source_commit,
    statement,
    inventory_complete,
    counts: {
      thresholds: thresholds.length,
      files: sources.size,
      unmeasured: thresholds.length - recorded,
      outcomes_recorded: recorded,
      not_located: notLocated,
      owner_claimed_never_reviewed: thresholds.filter((t) => t.owner_claim_at).length,
      no_owner_named: thresholds.filter((t) => !t.owner_claim_at).length,
      outside_the_inventory: found.length,
    },
    thresholds,
    same_concept_different_numbers: same,
    outside_the_inventory: found,
    alert_record: {
      read: record !== null,
      captured_at: record?.captured_at ?? null,
      rows: record?.alerts.length ?? 0,
      total: record?.total ?? null,
      complete: record !== null && record.alerts.length >= record.total,
    },
    human_decision: { setting_a_threshold: 'person_only', owner: 'K.D.', ellis_may: 'report_and_propose', proposals_in_this_release: 0, why_none: WHY_NONE, applying_a_change: APPLYING },
    limits: [...LIMITS],
  };
}
