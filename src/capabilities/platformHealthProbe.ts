// platform.system_resilience_supervision, extended with the platform's own health probes (A.M., 2026-11-04:
// the system health probe folds into resilience supervision). Reads an export of GET /health/full, judges each
// check on what it can actually show, and always states what the probes cannot see. Read-only: Ellis sends no
// alert; the platform's monitor does.
//
// Platform behaviour this rests on (platform repo, commit cc1ebc5):
// - GET /health runs SELECT 1 and nothing else (routes/healthRoutes.ts:7-15). GET /health/full runs
//   runFullSystemHealthCheck and returns 503 only when a check is critical (:18-27).
// - The checks run under Promise.allSettled (services/systemHealthService.ts:446-457), so a check that throws
//   without recording a result is dropped, and the overall status is worked out from the checks that remain.
// - scheduler_liveness reads one heartbeat (:136-169), written only by processScheduledActions
//   (schedulerService.ts:473, :839).
// - A window with no email is reported as ok (systemHealthService.ts:262-264), and a check that fails to run is
//   reported as a warning whose detail starts "Check failed:" (:167, :281).
// - SystemHealthMonitor runs at 3, 18, 33 and 48 past the hour on weekdays (schedulerService.ts:3316), and
//   only between 07:00 and 18:00 Central (:3319-3320). Its alert clock starts at boot (:3314) and waits two
//   hours between alerts (:3345-3351), although the comment says five minutes (:3313).

export const PINNED_AT = 'cc1ebc5';

// Recorded on every run, whatever the result (systemHealthService.ts:136-169, :172-212, :215-245, :248-282,
// :415-438). A run that lacks one of these lost it silently.
export const ALWAYS_REPORTED = ['database_connectivity', 'email_delivery', 'frontend_nginx', 'memory_pressure', 'process_uptime', 'scheduler_liveness'];

// A report older than this says nothing about now: the monitor itself runs every 15 minutes in its window.
export const STALE_AFTER_MINUTES = 30;

export interface HealthCheck { name: string; severity: 'ok' | 'warning' | 'critical'; detail: string; metric?: number; autoFixed?: string }
export interface HealthReport { timestamp: string; overall_status: 'ok' | 'warning' | 'critical'; checks: HealthCheck[]; duration_ms: number }
export interface HealthFullExport { captured_at: string; captured_by: string; report: HealthReport | null }

export type CheckState = 'ok' | 'problem' | 'unknown';
export interface CheckAnswer { name: string; platform_severity: HealthCheck['severity'] | 'not_reported'; state: CheckState; why: string; detail: string | null }

export interface BlindSpot { what: string; ref: string }
export const PROBES_CANNOT_SEE: BlindSpot[] = [
  { what: 'A scheduler that never registered is undetectable by GET /health: it runs SELECT 1 and nothing else, so it stays 200 while no timer is registered', ref: 'routes/healthRoutes.ts:7-15' },
  { what: 'scheduler_liveness reads the heartbeat of one job, processScheduledActions; it says nothing about the AI Ops scheduler or any other timer', ref: 'schedulerService.ts:473, :839; systemHealthService.ts:136-169' },
  { what: 'The health monitor runs only on weekdays between 07:00 and 18:00 Central, so a failure at night or at the weekend is neither checked nor alerted by it', ref: 'schedulerService.ts:3316, :3319-3320' },
  { what: 'After every restart the first alert waits two hours, not the five minutes the comment says, because the alert clock starts at boot', ref: 'schedulerService.ts:3313-3314, :3345-3351' },
  { what: 'A critical is alerted at most once every two hours, however often it recurs', ref: 'schedulerService.ts:3345-3351' },
  { what: 'A check that throws without recording a result is dropped, and the overall status reads as if it passed', ref: 'systemHealthService.ts:446-457' },
  { what: 'SystemHealthMonitor has no ai_agents row, so whether the monitor itself ran is not recorded anywhere', ref: 'examples/timer-inventory.example.json' },
];

export interface ProbeAnswer {
  pinned_at: string;
  verdict: 'ok' | 'problem' | 'unknown' | 'partly_unknown';
  report_at: string | null;
  report_age_minutes: number | null;
  platform_overall: HealthReport['overall_status'] | null;
  checks: CheckAnswer[];
  // The platform reads healthy while Ellis cannot say so.
  platform_says_ok_but: string[];
  cannot_see: BlindSpot[];
  statement: string;
}

function judge(c: HealthCheck): CheckAnswer {
  const base = { name: c.name, platform_severity: c.severity, detail: c.detail };
  if (c.detail.startsWith('Check failed:')) return { ...base, state: 'unknown', why: 'the check did not run, so its warning says nothing about the subsystem' };
  if (c.name === 'email_delivery' && c.severity === 'ok' && c.metric === 0) return { ...base, state: 'unknown', why: 'no email in the window: no evidence is not health' };
  if (c.severity === 'ok') return { ...base, state: 'ok', why: 'the check ran and passed' };
  return { ...base, state: 'problem', why: `the platform rates it ${c.severity}` };
}

export function probeHealth(exp: HealthFullExport | null, now: string): ProbeAnswer {
  const empty = { pinned_at: PINNED_AT, cannot_see: PROBES_CANNOT_SEE };
  if (!exp || !exp.report) {
    return { ...empty, verdict: 'unknown', report_at: null, report_age_minutes: null, platform_overall: null, checks: [], platform_says_ok_but: [], statement: 'No GET /health/full export was given, so the platform\'s own probes say nothing here.' };
  }
  const r = exp.report;
  const at = Date.parse(r.timestamp);
  const age = Number.isNaN(at) ? null : Math.round((Date.parse(now) - at) / 60_000);
  const seen = r.checks.map(judge);
  const missing: CheckAnswer[] = ALWAYS_REPORTED.filter((n) => !r.checks.some((c) => c.name === n))
    .map((name) => ({ name, platform_severity: 'not_reported', state: 'unknown', why: 'recorded on every run, but missing from this one: the check was dropped', detail: null }));
  const checks = [...seen, ...missing].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stale = age === null || age < 0 || age > STALE_AFTER_MINUTES;
  const problems = checks.filter((c) => c.state === 'problem');
  const unknowns = checks.filter((c) => c.state === 'unknown');
  const verdict = stale ? 'unknown' : problems.length ? 'problem' : unknowns.length ? 'partly_unknown' : 'ok';
  const platform_says_ok_but = r.overall_status === 'ok' && verdict !== 'ok'
    ? (stale ? [`the report is ${age === null ? 'undated' : `${age} minutes old`}`] : unknowns.map((c) => `${c.name}: ${c.why}`))
    : [];
  const statement = stale
    ? `The health report is ${age === null ? 'undated or unreadable' : age < 0 ? 'dated in the future' : `${age} minutes old`}, so it says nothing about now.`
    : `${checks.length} checks: ${problems.length} problem(s), ${unknowns.length} unknown.${platform_says_ok_but.length ? ' The platform reads ok; Ellis cannot.' : ''} ${PROBES_CANNOT_SEE.length} failure modes these probes cannot see are listed.`;
  return { ...empty, verdict, report_at: r.timestamp, report_age_minutes: age, platform_overall: r.overall_status, checks, platform_says_ok_but, statement };
}
