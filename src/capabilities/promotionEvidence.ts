// platform.agent_promotion_and_approval_decision, first release behaviour (R2):
// assembles the evidence for one capability at one rung and states plainly whether it meets that rung's acceptance
// criteria. The ceiling is R2: this never grants a rung, records a decision or changes a level. An agent that could
// promote itself is not governed. Each answer is about one capability and reads nothing of any other.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - Autonomy is per capability, and a passing mocked test promotes nothing
//   (.loop-architect/runs/20261007-school-agent-factory/execution-contract.md:50-57).
// - The approved level is a human's and is never inferred from behaviour (agentDomain/autonomyLadder.ts).
// - Production at R6 or above needs its own pilot approval (agentDomain/autonomyLadder.ts:203-205).
// - approved_autonomy is null on all 48 capabilities, and agent_id is null for this domain.
// - A timeout is not an approval (docs/architecture/ai-workforce-management/APPROVAL_DROP_QUEUE_2026-10-06.md:90).

import { createHash } from 'node:crypto';
import type { Reader } from './registryReconciliation.ts';

export const CAPABILITIES_FILE = 'backend/src/services/agentDomain/capabilities/platform.json';
export const REGISTRY_FILE = 'backend/src/services/agentDomain/agentDomainRegistry.ts';
export const PROGRESS_FILE = '.colaberry/progress.json';

export const RUNGS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'].map((r) => `autonomy:${r}`);
const PILOT_INDEX = 6;
// K.D. signs through R2 and A.M. from R3, per A.M.'s ladder decision of 2026-10-30.
const FIRST_AM_INDEX = 3;

export type Environment = 'sandbox' | 'production';
export type Against = 'production' | 'sandbox' | 'platform_source';
export type ItemKind = 'run_record' | 'named_test' | 'mocked_test' | 'measured_figure' | 'file_line' | 'story_complete' | 'elapsed_time' | 'conversation' | 'auto_approval';
export type CriterionState = 'met' | 'unproven' | 'unmet';
export type Verdict = 'meets_criteria' | 'unproven' | 'unmet' | 'no_criteria_defined' | 'above_ceiling' | 'rung_needs_production';

export interface EvidenceItem { capability_id: string; rung: string; criterion: number; kind: ItemKind; cite: string; against?: Against }
export interface RecordFile { text: string }
export type RecordReader = (path: string) => RecordFile | null;

export interface Cited { criterion: number; kind: ItemKind; cite: string; source: 'evidence_file' | 'progress_record'; sha256?: string; against?: Against }
export interface NotCounted { kind: ItemKind; cite: string; why: string }
export interface Criterion { number: number; text: string; state: CriterionState; run_records: Cited[]; supporting: Cited[] }

interface CapabilityRow {
  capability_id: string;
  human_decision: boolean;
  approved_autonomy?: string | null;
  max_permitted_autonomy: string;
  release_behaviour: Array<{ autonomy: string; behaviour: string; acceptance_criteria: string }>;
}
interface StoryRow { id: string; tests_added: string[]; criteria: Array<{ text: string; passed: boolean }>; verification?: { state?: string; commit_sha?: string | null } }

export interface PromotionAnswer {
  source_commit: string | null;
  capability_id: string;
  rung: string;
  environment: Environment;
  verdict: Verdict;
  statement: string;
  criteria: Criterion[];
  not_counted: NotCounted[];
  level: { approved: string | null; ceiling: string; after_this_assembly: string | null; changed: false };
  separate_pilot_approval_required: boolean;
  story_status: { state: string | null; counts_as_evidence: false };
  blockers: string[];
  human_decision: { promotion: 'person_only'; decided_by: 'K.D.' | 'A.M.'; ellis_may: 'assemble_and_present'; decision_recorded: false; applies_to: 'this capability at this rung alone' };
  limits: string[];
}

export class PromotionInputError extends Error {
  readonly errorClass = 'ContractViolation';
}

export const LIMITS: readonly string[] = [
  'Meeting the criteria grants nothing. A person decides, and Ellis records no decision.',
  'Only a run record proves a criterion. Every test is treated as mocked, because a test passing proves the test, not the behaviour on the platform.',
  'A run record is read, not re-run. Ellis checks that it exists and is not a fixture, and gives its hash so a person can check it. It cannot tell that the run was genuine or that it covers the criterion. That call is the reviewer\'s.',
  'A rung holds one acceptance sentence. It is split into criteria at semicolons, so a clause can be judged alone.',
  'The approved level comes from the platform\'s capability record in the commit read, not from the running system.',
  'A passing rung here says nothing about any other capability, and nothing about the agent overall.',
];

const NOT_EVIDENCE: Partial<Record<ItemKind, string>> = {
  story_complete: 'a story marked complete promotes nothing',
  elapsed_time: 'elapsed time promotes nothing',
  conversation: 'a conversation that went well promotes nothing',
  auto_approval: 'a timeout is not an approval',
};

export const clausesOf = (sentence: string) => sentence.split(/;\s+/).map((c) => c.trim()).filter(Boolean);
const FIXTURE_PATH = /(^|\/)(examples?|tests?|fixtures?|__tests__)\//;
const rungIndex = (r: string) => RUNGS.indexOf(r);

function json<T>(r: Reader, path: string): T {
  try {
    return JSON.parse(r.read(path)) as T;
  } catch (err) {
    throw new PromotionInputError(`${path} could not be read as JSON: ${(err as Error).message}`);
  }
}

function hasNoAgent(platform: Reader): boolean | null {
  try {
    const m = /domain_key: 'platform',[\s\S]*?agent_id: ([^,\n]+),/.exec(platform.read(REGISTRY_FILE));
    return m ? m[1].trim() === 'null' : null;
  } catch {
    return null; // an unreadable registry is reported as unknown, never as an agent existing
  }
}

function testExists(repo: Reader, cite: string): boolean {
  const [file, name] = cite.split('#');
  try {
    return repo.read(file).includes(`test('${name}'`);
  } catch {
    return false;
  }
}

function countable(item: EvidenceItem, environment: Environment, read: RecordReader, repo: Reader, total: number): { cited: Cited } | { why: string } {
  const why = NOT_EVIDENCE[item.kind];
  if (why) return { why };
  if (!Number.isInteger(item.criterion) || item.criterion < 1 || item.criterion > total) return { why: `criterion ${item.criterion} is not one of this rung's ${total}` };
  const base = { criterion: item.criterion, kind: item.kind, cite: item.cite, source: 'evidence_file' as const };
  if (item.kind === 'named_test') return testExists(repo, item.cite) ? { cited: base } : { why: 'the cited test was not found' };
  if (item.kind !== 'run_record') return { cited: base };
  if (FIXTURE_PATH.test(item.cite)) return { why: 'a fixture or example is not a run record' };
  const wanted: readonly Against[] = environment === 'production' ? ['production'] : ['sandbox', 'platform_source'];
  if (!item.against || !wanted.includes(item.against)) return { why: `a run against ${item.against ?? 'nothing stated'} does not carry to ${environment}` };
  const file = read(item.cite);
  if (!file || !file.text.trim()) return { why: 'the run record could not be read' };
  return { cited: { ...base, against: item.against, sha256: createHash('sha256').update(file.text).digest('hex') } };
}

export function assemble(
  platform: Reader, repo: Reader, source_commit: string | null,
  ask: { capability_id: string; rung: string; environment: Environment },
  items: readonly EvidenceItem[] = [], read: RecordReader = () => null,
): PromotionAnswer {
  const { capability_id, rung, environment } = ask;
  if (rungIndex(rung) < 0) throw new PromotionInputError(`${rung} is not a rung; use autonomy:R0 to autonomy:R9`);
  const { capabilities } = json<{ capabilities: CapabilityRow[] }>(platform, CAPABILITIES_FILE);
  const cap = capabilities.find((c) => c.capability_id === capability_id);
  if (!cap) throw new PromotionInputError(`${capability_id} is not in ${CAPABILITIES_FILE}`);

  const { stories } = json<{ stories: StoryRow[] }>(repo, PROGRESS_FILE);
  const story = stories.find((s) => s.id === capability_id.replace(/^platform\./, 'platform.CAP.'));
  const sentence = cap.release_behaviour.find((b) => b.autonomy === rung)?.acceptance_criteria ?? null;
  const clauses = sentence ? clausesOf(sentence) : [];

  const cited: Cited[] = [];
  const not_counted: NotCounted[] = [];
  for (const item of items) {
    if (item.capability_id !== capability_id || item.rung !== rung) {
      not_counted.push({ kind: item.kind, cite: item.cite, why: `this item is for ${item.capability_id} at ${item.rung}; evidence does not carry between capabilities or rungs` });
      continue;
    }
    const r = countable(item, environment, read, repo, clauses.length);
    if ('why' in r) not_counted.push({ kind: item.kind, cite: item.cite, why: r.why });
    else cited.push(r.cited);
  }

  // The tests behind a passed criterion are found without being cited, so a mock-only capability shows as unproven.
  if (sentence && story?.criteria.some((c) => c.passed && c.text === sentence)) {
    for (const file of story.tests_added) {
      clauses.forEach((_, i) => cited.push({ criterion: i + 1, kind: 'mocked_test', cite: file, source: 'progress_record' }));
    }
  }

  const criteria: Criterion[] = clauses.map((text, i) => {
    const mine = cited.filter((c) => c.criterion === i + 1);
    const run_records = mine.filter((c) => c.kind === 'run_record');
    const supporting = mine.filter((c) => c.kind !== 'run_record');
    return { number: i + 1, text, state: run_records.length ? 'met' : supporting.length ? 'unproven' : 'unmet', run_records, supporting };
  });

  const overCeiling = rungIndex(rung) > rungIndex(cap.max_permitted_autonomy);
  const needsProduction = rungIndex(rung) >= PILOT_INDEX && environment !== 'production';
  const verdict: Verdict = overCeiling ? 'above_ceiling'
    : needsProduction ? 'rung_needs_production'
      : !clauses.length ? 'no_criteria_defined'
        : criteria.some((c) => c.state === 'unmet') ? 'unmet'
          : criteria.some((c) => c.state === 'unproven') ? 'unproven' : 'meets_criteria';
  const n = (s: CriterionState) => criteria.filter((c) => c.state === s).length;
  const statement = {
    above_ceiling: `${capability_id} stops at ${cap.max_permitted_autonomy}, so ${rung} cannot be promoted to`,
    rung_needs_production: `${rung} is a production rung, so sandbox evidence cannot reach it`,
    no_criteria_defined: `${capability_id} has no acceptance criteria at ${rung}, so nothing can meet it`,
    unmet: `${rung} is not met: ${n('unmet')} of ${clauses.length} criteria have no evidence`,
    unproven: `${rung} is unproven: ${n('unproven')} of ${clauses.length} criteria rest on tests or citations with no run record`,
    meets_criteria: `all ${clauses.length} criteria at ${rung} cite a run record. A person decides whether that is enough`,
  }[verdict];

  const approved = cap.approved_autonomy ?? null;
  const noAgent = hasNoAgent(platform);
  return {
    source_commit, capability_id, rung, environment, verdict, statement, criteria, not_counted,
    level: { approved, ceiling: cap.max_permitted_autonomy, after_this_assembly: approved, changed: false },
    separate_pilot_approval_required: environment === 'production' && rungIndex(rung) >= PILOT_INDEX,
    story_status: { state: story?.verification?.state ?? null, counts_as_evidence: false },
    blockers: [
      ...(noAgent === false ? [] : [noAgent === null ? 'Whether this domain has an agent could not be read.' : 'This domain has no AI employee yet (agent_id is null), so there is no agent to promote.']),
      ...(approved === null ? ['No level has been approved for this capability.'] : []),
      'K.D. has no surface on which to record a promotion decision.',
    ],
    human_decision: { promotion: 'person_only', decided_by: rungIndex(rung) >= FIRST_AM_INDEX ? 'A.M.' : 'K.D.', ellis_may: 'assemble_and_present', decision_recorded: false, applies_to: 'this capability at this rung alone' },
    limits: [...LIMITS],
  };
}
