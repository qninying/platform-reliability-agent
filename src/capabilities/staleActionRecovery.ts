// platform.stale_action_recovery, first release behaviour (R2):
// answers "what is stuck right now, for how long, and on which attempt?" from the scheduled action
// records. 'Past the threshold' (stuck, attempts left, may be recycled) is kept apart from 'past the
// attempt cap' (stuck on its last allowed attempt, must not be recycled). Anything Ellis cannot judge
// is 'unknown' and never recyclable. Read-only; Ellis recovers nothing (production_database is
// default-denied, so the live recovery stays with the platform's timer).
//
// Platform behaviour this rests on (platform repo, commit 4f6b4d5):
// - StaleActionRecovery runs every 15 minutes (backend/src/services/schedulerService.ts:2344-2349) and
//   resets every scheduled_emails row in 'processing' for more than 10 minutes back to 'pending'
//   (:832-845, threshold :833). It does not touch attempts_made and does not check max_attempts.
// - The processor claims only rows with attempts_made < max_attempts (:457). attempts_made goes up only
//   when a run finishes (sent :1100-1105, failed :793-811), so a run that hangs is never counted.
// - max_attempts defaults to 1 (backend/src/models/ScheduledEmail.ts:112-116).
// - A batch claims up to 40 rows at once (:461) and works them one at a time, at least 5 seconds apart
//   (:783, pacing up to 180 more :786-789), so a row can sit in 'processing' while its batch is still
//   working through the rows before it. The records cannot tell that slow row from a stuck one.
//
// Ellis counts the stuck run as an attempt, as the brief's workflow does: a row is past the cap when
// attempts_made + 1 >= max_attempts, i.e. recycling it would run it more times than allowed.

import type { ActivityLogRow, AiAgentRow } from '../records.ts';
import { newestFirst } from '../readSource.ts';
import type { Citation } from './orchestrationHealthWatch.ts';

export const RECOVERY_TIMER = 'StaleActionRecovery';
export const PLATFORM_THRESHOLD_MINUTES = 10;
const TIMER_INTERVAL_MINUTES = 15;

// Columns of scheduled_emails Ellis reads (backend/src/models/ScheduledEmail.ts). No recipient fields.
export interface ScheduledActionRow {
  id: string;
  channel: string | null;
  campaign_id?: string | null;
  status: string;
  attempts_made: number;
  max_attempts: number;
  processing_started_at: string | null;
  processor_id: string | null;
}

export interface StaleSnapshot {
  captured_at: string;
  captured_by: string;
  scheduled_emails: ScheduledActionRow[];
  ai_agents: AiAgentRow[];
  ai_agent_activity_logs: ActivityLogRow[];
}

export type StuckState = 'in_flight' | 'past_threshold' | 'past_attempt_cap' | 'unknown';
export type PlatformOutcome = 'left_alone' | 'recycled_and_rerun' | 'recycled_but_unclaimable' | 'never_recovered' | 'unknown';

export interface ActionAnswer {
  id: string;
  channel: string | null;
  state: StuckState;
  minutes_in_flight: number | null;
  attempt: { this_run: number; cap: number } | null;
  recyclable: boolean;
  platform_outcome: PlatformOutcome;
  batch_size: number;
  reason: string;
  citation: Citation;
}

export interface StaleReport {
  threshold: { minutes: number; source: 'platform_code' | 'given' };
  timer: { status: 'ran' | 'overdue' | 'failed' | 'disabled' | 'never_run' | 'untracked'; at: string | null; reason: string };
  counts: Record<StuckState, number>;
  actions: ActionAnswer[];
  recyclable: string[];
  must_not_recycle: string[];
  escalate: boolean;
  slow_or_stuck: string;
}

export interface StaleOptions {
  now: Date;
  // The platform's value is hard-coded at schedulerService.ts:833; K.D. has not yet stated the intended one.
  thresholdMinutes?: number;
}

export function staleReport(snap: StaleSnapshot, opts: StaleOptions): StaleReport {
  const minutes = opts.thresholdMinutes ?? PLATFORM_THRESHOLD_MINUTES;
  const inFlight = snap.scheduled_emails.filter((r) => r.status === 'processing').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const batches = new Map<string, number>();
  for (const r of inFlight) if (r.processor_id) batches.set(r.processor_id, (batches.get(r.processor_id) ?? 0) + 1);
  const actions = inFlight.map((r) => judge(r, minutes, opts.now, r.processor_id ? batches.get(r.processor_id)! : 1));
  const counts = { in_flight: 0, past_threshold: 0, past_attempt_cap: 0, unknown: 0 };
  for (const a of actions) counts[a.state]++;
  return {
    threshold: { minutes, source: opts.thresholdMinutes === undefined ? 'platform_code' : 'given' },
    timer: timerStatus(snap, opts.now),
    counts,
    actions,
    recyclable: actions.filter((a) => a.recyclable).map((a) => a.id),
    must_not_recycle: actions.filter((a) => a.state === 'past_attempt_cap').map((a) => a.id),
    escalate: counts.past_attempt_cap > 0 || counts.unknown > 0,
    slow_or_stuck: 'the records show when a row was claimed, not whether its batch is still working on it, so a row past the threshold in a large batch may be slow rather than stuck',
  };
}

function judge(r: ScheduledActionRow, minutes: number, now: Date, batchSize: number): ActionAnswer {
  const citation: Citation = { table: 'scheduled_emails', id: r.id, fields: ['status', 'processing_started_at', 'attempts_made', 'max_attempts', 'processor_id'] };
  const capKnown = Number.isInteger(r.attempts_made) && Number.isInteger(r.max_attempts) && r.attempts_made >= 0 && r.max_attempts >= 1;
  const attempt = capKnown ? { this_run: r.attempts_made + 1, cap: r.max_attempts } : null;
  // Fixed key order so the printed answer reads state first and citation last.
  const answer = (state: StuckState, minutes_in_flight: number | null, recyclable: boolean, platform_outcome: PlatformOutcome, reason: string): ActionAnswer =>
    ({ id: r.id, channel: r.channel, state, minutes_in_flight, attempt, recyclable, platform_outcome, batch_size: batchSize, reason, citation });
  const age = minutesSince(r.processing_started_at, now);
  if (r.processing_started_at === null) {
    return answer('unknown', null, false, 'never_recovered', 'in processing with no start time, so how long it has been stuck cannot be known; the platform timer never selects it, so it stays stuck');
  }
  if (age === null || age < 0) {
    return answer('unknown', null, false, 'unknown', `processing_started_at '${r.processing_started_at}' is not a usable time`);
  }
  if (age <= minutes) {
    return answer('in_flight', age, false, 'left_alone', `in processing for ${age} minutes, within the ${minutes}-minute threshold`);
  }
  const slow = batchSize > 1 ? `; its batch claimed ${batchSize} rows, so it may still be waiting its turn` : '';
  if (!attempt) {
    return answer('unknown', age, false, 'unknown', `past the threshold (${age} minutes) but attempts_made ${r.attempts_made} / max_attempts ${r.max_attempts} are not usable, so whether it may be recycled cannot be known${slow}`);
  }
  const platform: PlatformOutcome = r.attempts_made < r.max_attempts ? 'recycled_and_rerun' : 'recycled_but_unclaimable';
  if (attempt.this_run >= attempt.cap) {
    const what = platform === 'recycled_and_rerun'
      ? 'the platform timer will recycle it anyway and the processor will run it again'
      : 'the platform timer will reset it to pending, where the processor never claims it again';
    return answer('past_attempt_cap', age, false, platform, `stuck ${age} minutes on attempt ${attempt.this_run} of ${attempt.cap}, its last allowed attempt, so it must not be recycled; ${what}${slow}`);
  }
  return answer('past_threshold', age, true, platform, `stuck ${age} minutes on attempt ${attempt.this_run} of ${attempt.cap}, past the ${minutes}-minute threshold with attempts left${slow}`);
}

function timerStatus(snap: StaleSnapshot, now: Date): StaleReport['timer'] {
  const rows = snap.ai_agents.filter((a) => a.agent_name === RECOVERY_TIMER);
  if (rows.length !== 1) return { status: 'untracked', at: null, reason: rows.length === 0 ? `no ai_agents row named ${RECOVERY_TIMER}, so its runs are not recorded` : `${rows.length} rows named ${RECOVERY_TIMER}; the records are inconsistent` };
  const agent = rows[0];
  if (!agent.enabled) return { status: 'disabled', at: agent.last_run_at, reason: 'the recovery timer is disabled, so stuck rows stay stuck' };
  const latest = snap.ai_agent_activity_logs.filter((r) => r.agent_id === agent.id).sort(newestFirst)[0];
  const at = latest?.created_at ?? agent.last_run_at;
  if (!at) return { status: 'never_run', at: null, reason: 'no recovery run is recorded' };
  if (latest?.result === 'failed') return { status: 'failed', at, reason: 'the latest recovery run failed' };
  const age = minutesSince(at, now);
  if (age === null || age > TIMER_INTERVAL_MINUTES * 2) return { status: 'overdue', at, reason: `last ran ${age ?? 'an unknown number of'} minutes ago; it should run every ${TIMER_INTERVAL_MINUTES}` };
  return { status: 'ran', at, reason: `last ran ${age} minutes ago` };
}

function minutesSince(at: string | null, now: Date): number | null {
  if (at === null) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : Math.round((now.getTime() - t) / 60_000);
}
