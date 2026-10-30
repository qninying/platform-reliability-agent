// platform.dead_letter_triage, first release behaviour (R2):
// presents both dead-letter stores as one queue grouped by error class, with the job families that cannot
// dead-letter named alongside. An empty queue is reported as "empty, and here is what could not have reached
// it", never as a healthy fleet. Ellis proposes per entry; replaying, abandoning and marking resolved stay a
// person's decision at every autonomy level. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - A dead_letter_jobs row carries no payload: context holds only last_failed_at
//   (services/deadLetterService.ts:48), so what can be run again is the job, not the failed work.
// - Nothing sets resolved or resolved_at (deadLetterService.ts:49-50), and the table has no reason column
//   (models/DeadLetterJob.ts:39-50), so an abandon reason has no place on the row.
// - trackAgentRun moves last_run_at on every run and last_error_at only on a failure (agentRunTracker.ts:53,
//   :90-96). A director's run writes neither here (workforce/directorActions.ts).
// - A publishing job's failure is one of two kinds: state failed is permanent, state dead_lettered has
//   exhausted its attempts (services/publishing/publishingWorker.ts:126-146).
// - Retrying clears dead_lettered_at (publishingReceiptService.ts:73-92). Cancelling sets state cancelled and
//   leaves dead_lettered_at set (:95-113), so a set date alone does not mean the job is open.
// - Both actions are person-only admin routes (routes/admin/publishingRoutes.ts, /jobs/:id/retry and /cancel).

import { report as captureReport, type DeadLetterRow, type PublishingRow, type DeadLetterAnswer, type FamilyReport, type Family } from './deadLetterCapture.ts';
import type { TimerIndex } from '../inventory/timerHomes.ts';

export interface TriageDeadLetterRow extends DeadLetterRow { error_message?: string | null }
export interface TriagePublishingRow extends PublishingRow { provider: string | null; last_error?: string | null }
export interface AgentRunState { agent_name: string; last_run_at: string | null; last_error_at: string | null }
export interface TriageSnapshot { captured_at: string; captured_by: string; dead_letter_jobs: TriageDeadLetterRow[]; publishing_jobs: TriagePublishingRow[]; ai_agents: AgentRunState[] }
export const TABLES = ['dead_letter_jobs', 'publishing_jobs', 'ai_agents'] as const;

export type Since = 'ran_clean' | 'still_failing' | 'no_run_since' | 'not_readable';
export type Option = 'recover_by_replay' | 'fix_and_replay' | 'abandon' | 'read_first';
export interface Entry {
  store: 'dead_letter_jobs' | 'publishing_jobs';
  job: string;
  family: Family | 'not_in_source' | 'publishing';
  rows: number;
  row_ids: string[];
  last_at: string | null;
  since_last_dead_letter: Since | null;
  proposal: Option;
  because: string;
  how_a_person_acts: string;
}
export interface Group { error_class: string; rows: number; jobs: number; stores: Entry['store'][]; distinct_errors: number | null; broad_class: boolean; note: string | null; entries: Entry[] }
export interface TriageAnswer {
  captured_at: string;
  source_commit: string | null;
  verdict: 'queue_open' | 'queue_empty';
  statement: string;
  queue: Group[];
  closed: { marked_resolved: string[]; publishing_cancelled: string[] };
  could_not_have_reached: { cannot_or_unknown: number; of: number; families: FamilyReport[]; conditions: string[] };
  decision: { decided_by: 'a person, at every autonomy level'; replay_safety: 'unproven'; why: string };
  limits: string[];
}

// What keeps a failure out of the queue even for a job that can dead-letter (deadLetterService.ts:17, :19, :31).
export const CONDITIONS: readonly string[] = [
  'a job in a can_dead_letter family that failed fewer than three times in a row',
  'a failure count cleared by a restart, because the count is held in memory',
  'a job that catches its own errors inside its runner',
];
export const LIMITS: readonly string[] = [
  'Every proposal is unproven for replay: per-job idempotency is a separate capability, not yet built, so running a job again may repeat its side effects.',
  'The same error class is not proof of one fault; distinct_errors counts the different messages inside a group, and a group of a broad class needs reading.',
  'ran_clean reads the last run only: it says the job has run without error since, not that the failed work was redone.',
  'Row ids point a person to messages and stacks; Ellis never repeats them.',
  'A dead_letter_jobs row has no reason column, so a reason recorded by hand has nowhere on the row to go.',
];
const BROAD = new Set(['Error', 'TypeError', 'not recorded']);
const CLEAN_GAP_MS = 5000;

// Ids, counts and timestamps differ between runs of one fault; the rest of the message tells faults apart.
const fingerprint = (m: string) => m.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '#').replace(/\d+/g, '#').trim();

function since(agent: AgentRunState | undefined, lastAt: string): Since {
  if (!agent?.last_run_at) return 'not_readable';
  const ran = Date.parse(agent.last_run_at);
  if (ran <= Date.parse(lastAt)) return 'no_run_since';
  // A failure writes both stamps in one update; a clean run moves last_run_at alone.
  const failed = agent.last_error_at ? Date.parse(agent.last_error_at) : null;
  return failed !== null && ran - failed < CLEAN_GAP_MS ? 'still_failing' : 'ran_clean';
}

const JOB_ACT = "No replay surface: the row holds no payload, so the job's next scheduled run is the replay. Marking the row resolved is a production write by a person.";

function jobEntry(job: string, family: Entry['family'], rows: TriageDeadLetterRow[], agent: AgentRunState | undefined): Entry {
  const row_ids = rows.map((r) => r.id).sort();
  const last_at = rows.map((r) => r.created_at).sort().at(-1)!;
  const base = { store: 'dead_letter_jobs' as const, job, family, rows: rows.length, row_ids, last_at, how_a_person_acts: JOB_ACT };
  if (family === 'not_in_source') return { ...base, since_last_dead_letter: null, proposal: 'abandon', because: 'no timer at this source commit carries this name, so nothing is left to run' };
  const s = since(agent, last_at);
  const out: Record<Since, [Option, string]> = {
    ran_clean: ['abandon', 'it has run without error since its last dead letter; a person checks the failed work did not matter'],
    still_failing: ['fix_and_replay', 'its last run failed after this dead letter, so running it again repeats the fault'],
    no_run_since: ['read_first', 'it has not run since its last dead letter, so nothing shows whether the fault remains'],
    not_readable: ['read_first', 'its ai_agents record shows no run Ellis can read, so nothing shows whether the fault remains'],
  };
  return { ...base, since_last_dead_letter: s, proposal: out[s][0], because: out[s][1] };
}

function publishingEntries(provider: string, rows: TriagePublishingRow[]): Entry[] {
  const kinds: Array<[string, Option, string]> = [
    ['failed', 'fix_and_replay', 'the worker called this failure permanent, so retrying unchanged repeats it'],
    ['dead_lettered', 'recover_by_replay', 'the worker exhausted its attempts on a failure it treated as temporary'],
  ];
  return kinds.flatMap(([state, proposal, because]) => {
    const these = rows.filter((r) => r.state === state);
    if (!these.length) return [];
    return [{
      store: 'publishing_jobs' as const, job: `publishing:${provider}`, family: 'publishing' as const, rows: these.length,
      row_ids: these.map((r) => r.id).sort(), last_at: these.map((r) => r.dead_lettered_at!).sort().at(-1)!, since_last_dead_letter: null, proposal, because,
      how_a_person_acts: 'A person retries or cancels on the admin publishing routes. Retrying publishes outward, and cancelling takes the reason.',
    }];
  });
}

export function triage(ix: TimerIndex, s: TriageSnapshot): TriageAnswer {
  const capture: DeadLetterAnswer = captureReport(ix, s);
  const fams = capture.coverage.families;
  const familyOf = (job: string): Entry['family'] => fams.find((f) => f.jobs.includes(job))?.family ?? 'not_in_source';
  const rowOf = (job: string) => ix.registry.find((e) => e.agentName === job)?.row ?? job;

  const open = s.dead_letter_jobs.filter((r) => !r.resolved);
  const lettered = s.publishing_jobs.filter((j) => j.dead_lettered_at);
  // Open is an allow-list: a state the worker does not dead-letter into is not assumed to be waiting.
  const pubOpen = lettered.filter((j) => j.state === 'failed' || j.state === 'dead_lettered');
  const classes = new Set([...open.map((r) => r.error_class), ...pubOpen.map((j) => j.last_error_class ?? 'not recorded')]);

  const queue: Group[] = [...classes].map((error_class) => {
    const dl = open.filter((r) => r.error_class === error_class);
    const pub = pubOpen.filter((j) => (j.last_error_class ?? 'not recorded') === error_class);
    const entries: Entry[] = [
      ...[...new Set(dl.map((r) => r.job_name))].sort().map((job) => jobEntry(job, familyOf(job), dl.filter((r) => r.job_name === job), s.ai_agents.find((a) => a.agent_name === rowOf(job)))),
      ...[...new Set(pub.map((j) => j.provider ?? 'not recorded'))].sort().flatMap((p) => publishingEntries(p, pub.filter((j) => (j.provider ?? 'not recorded') === p))),
    ];
    const messages = [...dl.map((r) => r.error_message), ...pub.map((j) => j.last_error)];
    const distinct_errors = messages.some((m) => m === undefined || m === null) ? null : new Set(messages.map((m) => fingerprint(m!))).size;
    const jobs = new Set(entries.map((e) => e.job)).size;
    const broad_class = BROAD.has(error_class);
    const stores = [...new Set(entries.map((e) => e.store))];
    const note = broad_class ? `${error_class} is too broad to say one fault caused these`
      : jobs > 1 && distinct_errors === 1 ? `${jobs} jobs share one error: look for one upstream fault first` : null;
    return { error_class, rows: dl.length + pub.length, jobs, stores, distinct_errors, broad_class, note, entries };
  }).sort((a, b) => b.rows - a.rows || a.error_class.localeCompare(b.error_class));

  const { can_dead_letter, cannot_or_unknown, total_jobs } = capture.coverage;
  const named = fams.filter((f) => f.can_dead_letter !== true && f.count).map((f) => `${f.family} (${f.count})`).join(', ');
  const couldNot = `${cannot_or_unknown} of ${total_jobs} jobs could not have reached it: ${named}. Also out of reach: ${CONDITIONS.join('; ')}.`;
  const rows = open.length + pubOpen.length;
  return {
    captured_at: s.captured_at, source_commit: ix.source_commit,
    verdict: rows ? 'queue_open' : 'queue_empty',
    statement: rows
      ? `${rows} open in ${queue.length} error class(es). ${can_dead_letter} of ${total_jobs} jobs can reach this queue; ${couldNot}`
      : `The queue is empty, and here is what could not have reached it. ${couldNot} This is not a healthy fleet.`,
    queue,
    closed: { marked_resolved: s.dead_letter_jobs.filter((r) => r.resolved).map((r) => r.id).sort(), publishing_cancelled: lettered.filter((j) => j.state === 'cancelled').map((j) => j.id).sort() },
    could_not_have_reached: { cannot_or_unknown, of: total_jobs, families: fams, conditions: [...CONDITIONS] },
    decision: { decided_by: 'a person, at every autonomy level', replay_safety: 'unproven', why: 'running a job again re-fires its side effects, and idempotency is unproven per job' },
    limits: [...LIMITS],
  };
}
