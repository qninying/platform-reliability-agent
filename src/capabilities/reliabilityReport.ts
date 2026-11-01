// platform.reliability_briefing_for_manager, first release behaviour (R2):
// produces the briefing on request, with every figure cited and an explicit unmeasured section. It composes the
// answers of capabilities already built and counts nothing itself. No percentage appears without its record
// count, and the unmeasured section comes first and always names the untracked timers and the phantom crons,
// because a report of only what is measurable reads as healthier than the platform is. There is no overall verdict.
// Read-only: live_email is default-denied (delivery/execution/executionPolicy.ts:33-42), so Ellis never sends it;
// delivery stays with the platform's briefing service (services/executiveBriefingService.ts).

import type { ReconAnswer } from './registryReconciliation.ts';
import type { ScoreAnswer } from './agentHealthScoring.ts';
import type { HealthAnswer } from './cronHealthAlerting.ts';
import type { DriftAnswer } from './schemaDriftDetection.ts';
import type { PositionAnswer } from './backupRestoreVerification.ts';

export interface RunTotals { rows: number; runs: number; failures: number }
export interface Records { captured_at: string; totals: RunTotals; agents: ScoreAnswer; cron: HealthAnswer }

export interface BriefingInput {
  produced_at: string;
  recon: ReconAnswer;
  drift: DriftAnswer;
  backup: PositionAnswer;
  records: Records | null;
}

export interface Figure { label: string; value: number | null; of: number | null; unit: string; percent: number | null; source: string }
export interface Unmeasured { item: string; count: number | null; why: string; names: string[]; source: string }
export interface Decision { question: string; owner: string; evidence_needed: string; source: string }

export interface Briefing {
  produced_at: string;
  source_commit: string | null;
  records_captured_at: string | null;
  scope: string;
  delivery: string;
  headline: string;
  unmeasured: Unmeasured[];
  measured: Figure[];
  decisions: Decision[];
  limits: string[];
}

// A percentage exists only with a record count behind it. No records, no percentage.
export function share(value: number | null, of: number | null): number | null {
  if (value === null || of === null || !Number.isInteger(of) || of <= 0) return null;
  return Math.round((value / of) * 1000) / 10;
}

const figure = (label: string, value: number | null, of: number | null, unit: string, source: string): Figure => ({ label, value, of, unit, percent: share(value, of), source });

export const SCOPE = 'A proposal. The data analyst duties this is meant to absorb are not documented in the platform repository, so this is not an inherited job description, and K.D. has yet to state the scope.';
export const DELIVERY = 'Not sent. Ellis produces this on request. Delivery stays with the platform\'s briefing service, and this text links to no admin page, so it can be read without a login.';

export const LIMITS: readonly string[] = [
  'Untracked timers and phantom crons are measured from source. Which of them are live on production is not read here.',
  'Every count comes from the capability cited beside it. This briefing recounts nothing, so it shares each one\'s limits.',
  'Run and failure counts are lifetime counters on each agent row, not figures for a period.',
  'An unknown is not a good result. It means there is no record to read.',
];

export const OPEN_DECISIONS: readonly Decision[] = [
  { question: 'What duties should this briefing take on?', owner: 'K.D.', evidence_needed: 'A written list of the data analyst duties. None is in the platform repository.', source: 'docs/capabilities/reliability-report.md' },
  { question: 'Should a skipped tick be recorded as a missed run?', owner: 'K.D.', evidence_needed: 'What the missed-run detector should report once overlap guards exist.', source: 'docs/capabilities/cron-overlap-guard.md' },
  { question: 'What are the recovery objective, the backup destination and the cadence?', owner: 'K.D. and A.M.', evidence_needed: 'How much data loss and downtime is acceptable, and what the host holds today.', source: 'docs/capabilities/backup-and-restore-verification.md' },
  { question: 'Who owns the approval for production changes?', owner: 'K.D. and A.M.', evidence_needed: 'The story names K.D.; the merge workflow makes A.M. the gate on main.', source: 'docs/capabilities/deploy-readiness.md' },
];

const RECON = 'npm run registry-reconcile, source only';

function unmeasured(i: BriefingInput): Unmeasured[] {
  const { classes, beyond_the_platform_reconciler: beyond } = i.recon;
  const axes = i.drift.axes_not_measured;
  const out: Unmeasured[] = [
    { item: 'Untracked timers', count: classes.scheduledNamesWithNoSeedRow.count, why: 'A timer fires under these names with no seed row, so they add nothing to the run figures below.', names: classes.scheduledNamesWithNoSeedRow.entries, source: RECON },
    { item: 'Phantom crons', count: classes.cronSeedRowsWithNoRegistration.count, why: 'These rows advertise a schedule with no timer registered under their name.', names: classes.cronSeedRowsWithNoRegistration.entries, source: RECON },
    { item: 'Timers with no name', count: beyond.timers_with_no_name.length, why: 'They record under no name Ellis can read.', names: beyond.timers_with_no_name.map((t) => t.ref), source: RECON },
    { item: 'Alert outcomes', count: null, why: 'Nothing records whether a raised alert was acted on or was right.', names: [], source: 'no record exists' },
    { item: 'Retry counts and latency percentiles', count: null, why: 'Runs carry a duration, but nothing here reports retries or percentiles.', names: [], source: 'no record exists' },
    { item: 'Schema comparisons nobody makes', count: axes.length, why: 'The nightly drift check does not compare these.', names: axes.map((a) => a.axis), source: 'npm run schema-drift' },
    { item: 'Recovery position', count: null, why: i.backup.statement, names: [], source: 'npm run backup-position' },
  ];
  if (i.drift.verdict === 'unknown') out.push({ item: 'Schema drift', count: null, why: i.drift.statement, names: [], source: 'npm run schema-drift' });
  if (!i.records) {
    out.push({ item: 'Runs, failures and alerts', count: null, why: 'No records were supplied, so these are unknown, not zero.', names: [], source: 'no snapshot supplied' });
    return out;
  }
  const { agents, cron } = i.records;
  out.push({ item: 'Agents with no score', count: agents.unscored.length, why: 'Zero runs on record. The platform shows these at 100.', names: agents.unscored.map((a) => a.name), source: 'npm run agent-health' });
  out.push({ item: 'Timers with no agent row', count: agents.no_row.length, why: 'They run with no record.', names: agents.no_row.map((a) => a.name), source: 'npm run agent-health' });
  out.push({ item: 'Jobs the health check cannot evaluate', count: cron.not_evaluated.length, why: 'Listed by the platform\'s own selection.', names: cron.not_evaluated.map((c) => c.name), source: 'npm run cron-health' });
  return out;
}

function measured(i: BriefingInput): Figure[] {
  const out: Figure[] = [];
  if (i.records) {
    const { totals, agents, cron } = i.records;
    const jobs = cron.alerting.length + cron.clear.length + cron.partly_evaluated.length + cron.not_evaluated.length;
    out.push(
      figure('Runs on record', totals.runs, null, 'runs', 'ai_agents.run_count'),
      figure('Failed runs on record', totals.failures, totals.runs, 'runs', 'ai_agents.error_count'),
      figure('Agents scored', agents.scored.length, totals.rows, 'agent rows', 'npm run agent-health'),
      figure('Jobs alerting now', cron.alerting.length, jobs, 'jobs', 'npm run cron-health'),
      figure('Jobs fully evaluated', cron.alerting.length + cron.clear.length, jobs, 'jobs', 'npm run cron-health'),
    );
  } else {
    for (const label of ['Runs on record', 'Failed runs on record', 'Jobs alerting now']) out.push(figure(label, null, null, 'unknown', 'no snapshot supplied'));
  }
  if (i.drift.drift) {
    const d = i.drift.drift;
    out.push(figure('Objects on production missing from development', d.tables.length + d.enums.length + d.columns.length, null, 'objects', 'npm run schema-drift'));
  }
  return out;
}

export function reliabilityBriefing(i: BriefingInput): Briefing {
  const un = unmeasured(i);
  const named = un.find((u) => u.item === 'Untracked timers')!.count;
  const phantom = un.find((u) => u.item === 'Phantom crons')!.count;
  return {
    produced_at: i.produced_at,
    source_commit: i.recon.source_commit,
    records_captured_at: i.records?.captured_at ?? null,
    scope: SCOPE,
    delivery: DELIVERY,
    headline: `${un.length} areas are not measured, including ${named} untracked timers and ${phantom} phantom crons. Read those first: the figures below cannot see them.`,
    unmeasured: un,
    measured: measured(i),
    decisions: [...OPEN_DECISIONS],
    limits: [...LIMITS],
  };
}

const showFigure = (f: Figure): string => {
  if (f.value === null) return `- ${f.label}: unknown (${f.source})`;
  const base = f.percent !== null ? `${f.percent}% (${f.value} of ${f.of} ${f.unit})` : `${f.value} ${f.unit}`;
  return `- ${f.label}: ${base} (${f.source})`;
};
const showItem = (u: Unmeasured): string => {
  const count = u.count === null ? 'unknown' : String(u.count);
  const names = u.names.length ? `\n  ${u.names.join(', ')}` : '';
  return `- **${u.item}: ${count}.** ${u.why} (${u.source})${names}`;
};

export function renderBriefing(b: Briefing): string {
  return [
    '# Reliability briefing',
    `Produced ${b.produced_at}. Source commit ${b.source_commit ?? 'not read'}. Records ${b.records_captured_at ?? 'not supplied'}.`,
    b.headline,
    '## Not measured',
    ...b.unmeasured.map(showItem),
    '## Measured',
    ...b.measured.map(showFigure),
    '## Decisions waiting on a person',
    ...b.decisions.map((d) => `- **${d.owner}:** ${d.question} Needs: ${d.evidence_needed} (${d.source})`),
    '## About this briefing',
    `Scope: ${b.scope}`,
    `Delivery: ${b.delivery}`,
    ...b.limits.map((l) => `- ${l}`),
  ].join('\n');
}
