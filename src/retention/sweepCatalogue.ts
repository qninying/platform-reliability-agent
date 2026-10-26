// The platform's retention sweeps, pinned to the platform repo at commit 769ff4e. Each entry names
// the job that sweeps the table, what the sweep does, and where in the code it happens.
//
// `codeDays` is what the code uses today. It is NEVER reported as a table's window: a window found
// only in code is not a stated policy. It is used for one thing, to flag a stated window the code
// does not follow.

export const CATALOGUE_COMMIT = '769ff4e';

export type SweepAction = 'delete' | 'archive_then_delete' | 'archive' | 'expire';

export interface SweepSpec {
  table: string;
  job: string;
  action: SweepAction;
  cadenceHours: number;
  batched: boolean;
  codeDays: number | null;
  codeRef: string;
  // A stated-window source must name this job's run records, when it writes any.
  runRecordSource?: string;
  risks: string[];
}

export const SWEEPS: SweepSpec[] = [
  {
    table: 'page_events',
    job: 'PageEventCleanup',
    action: 'delete',
    cadenceHours: 24,
    batched: false,
    codeDays: 90,
    codeRef: 'backend/src/services/schedulerService.ts:2473-2488',
    risks: [
      'one unbounded DELETE per run, not batches (schedulerService.ts:2479-2481)',
      'the deleted count goes to the server log only, never to a run record (:2482-2484)',
    ],
  },
  {
    table: 'chat_messages',
    job: 'ChatMessageCleanup',
    action: 'delete',
    cadenceHours: 24,
    batched: false,
    codeDays: 180,
    codeRef: 'backend/src/services/schedulerService.ts:2490-2505',
    risks: [
      'one unbounded DELETE per run, not batches (schedulerService.ts:2496-2498)',
      'the deleted count goes to the server log only, never to a run record (:2499-2501)',
      "the only index leads with conversation_id, so the age filter cannot use it (backend/src/models/ChatMessage.ts:62-63)",
    ],
  },
  {
    table: 'intelligence_decisions',
    job: 'IntelligenceRetentionCycle',
    action: 'archive_then_delete',
    cadenceHours: 24,
    batched: true,
    codeDays: 30,
    codeRef: 'backend/src/services/cory/intelligenceRetention.ts:17-18, :45-82',
    runRecordSource: 'IntelligenceRetention',
    risks: [
      'the delete does not check that a row was archived; archive and delete each take an unordered 5,000 rows, so with a larger backlog rows can be deleted unarchived (intelligenceRetention.ts:50-55, :74-79)',
      'a failed cycle is caught inside the job, so the run is recorded as a success (:152-158)',
      'the archive table has no retention of its own (:19)',
    ],
  },
  {
    table: 'timeline_cards',
    job: 'AiNewsRefresh',
    action: 'archive',
    cadenceHours: 24,
    batched: false,
    codeDays: null,
    codeRef: 'backend/src/services/timeline/generatedContentRetention.ts:47, :55-80; schedulerService.ts:2100-2113',
    risks: [
      'the window is GENERATED_CONTENT_RETENTION_DAYS, default 18, so it depends on the environment (generatedContentRetention.ts:47)',
      'the second daily prune at 03:45 runs outside any instrumented job, so it leaves no run record (schedulerService.ts:2122-2137)',
      'the prune runs after the news refresh in the same job, so a failed refresh skips it (:2106-2107)',
    ],
  },
  {
    table: 'proposed_agent_actions',
    job: 'ProposalCleanupService',
    action: 'expire',
    cadenceHours: 24,
    batched: false,
    codeDays: null,
    codeRef: 'backend/src/services/aiOpsScheduler.ts:344; proposalCleanupService.ts:18-40',
    risks: [
      'marks pending proposals expired and deletes nothing, so the table is not bounded by this job (proposalCleanupService.ts:21-29)',
    ],
  },
];
