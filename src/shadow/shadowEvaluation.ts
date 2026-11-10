// R5 groundwork: shadow evaluation. The platform defines R5 as "evaluate in shadow mode against approved
// reference outcomes" (autonomyLadder.ts AUTONOMY_MEANINGS). This module scores Ellis's recorded verdicts
// against approved reference outcomes for the same subject and time, and judges each tool only against limits
// K.D. has written in governance/shadow-criteria.json. It is a pure function: it reads two inputs and returns a
// report. Nothing is acted on, and nothing about a tool's autonomy changes because of what it says.
//
// Rules it enforces (docs/shadow-evaluation.md):
// - Only an approved reference counts. A reference with no approver is listed as unreferenced, never scored.
// - An Ellis unknown on a real problem is counted with the misses: the problem was not caught. An unknown on an
//   ok is reported apart and is not a false alarm.
// - No rate without its counts, and no rate from an empty denominator: "no reference problems" is not a 0% miss
//   rate.
// - No judgement without K.D.'s limits. A tool with any limit unset is not_judged, and says which.
// - The same observations in any order give the same report; a repeated observation id is refused.

import type { Evidence, SharedVerdict } from '../output/toolOutput.ts';
import { ContractViolation } from '../output/toolOutput.ts';

export type ReferenceVerdict = 'problem' | 'ok';

export interface ReferenceOutcome {
  verdict: ReferenceVerdict;
  // Where the reference came from: the platform's own check, a person's review, an incident record.
  source: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface ShadowObservation {
  id: string;
  tool: string;
  // What was judged: an agent name, a job, a scanner. Free text, used only to show a person what to look at.
  subject: string;
  observed_at: string;
  ellis: { tool: string; verdict: SharedVerdict; evidence: Evidence[] };
  reference: ReferenceOutcome | null;
}

export interface ToolCriteria {
  max_miss_rate: number | null;
  max_false_alarm_rate: number | null;
  min_observations: number | null;
}

export interface ShadowCriteria {
  owner: string;
  status: string;
  tools: Record<string, ToolCriteria>;
}

export type Outcome = 'caught' | 'agreed_ok' | 'miss' | 'unseen_problem' | 'false_alarm' | 'unknown_on_ok';
export type Judgement = 'meets' | 'does_not_meet' | 'not_judged';

export interface Rate { value: number | null; numerator: number; denominator: number; note: string | null }

export interface ToolShadowReport {
  tool: string;
  observations: number;
  scored: number;
  counts: Record<Outcome, number>;
  miss_rate: Rate;
  false_alarm_rate: Rate;
  // Observation ids a person should look at first.
  misses: string[];
  false_alarms: string[];
  unreferenced: string[];
  judgement: Judgement;
  reasons: string[];
}

export interface ShadowReport {
  mode: 'shadow';
  acted_on: false;
  criteria_owner: string;
  criteria_status: string;
  window: { from: string | null; to: string | null };
  judgement: Judgement;
  tools: ToolShadowReport[];
}

const VERDICTS: ReadonlySet<string> = new Set(['problem', 'ok', 'unknown', 'partly_unknown']);
const REFERENCE_VERDICTS: ReadonlySet<string> = new Set(['problem', 'ok']);
const OUTCOMES: Outcome[] = ['caught', 'agreed_ok', 'miss', 'unseen_problem', 'false_alarm', 'unknown_on_ok'];

export function validateCriteria(c: ShadowCriteria): void {
  if (typeof c.owner !== 'string' || typeof c.status !== 'string' || typeof c.tools !== 'object' || c.tools === null) {
    throw new ContractViolation('shadow criteria need { owner, status, tools{} }');
  }
  for (const [tool, t] of Object.entries(c.tools)) {
    for (const k of ['max_miss_rate', 'max_false_alarm_rate'] as const) {
      const v = t[k];
      if (v !== null && !(typeof v === 'number' && v >= 0 && v <= 1)) {
        throw new ContractViolation(`${tool}: ${k} must be null or a number from 0 to 1, got ${JSON.stringify(v)}`);
      }
    }
    const m = t.min_observations;
    if (m !== null && !(Number.isInteger(m) && m >= 1)) {
      throw new ContractViolation(`${tool}: min_observations must be null or a whole number of at least 1, got ${JSON.stringify(m)}`);
    }
  }
}

export function validateObservations(obs: ShadowObservation[]): void {
  const seen = new Set<string>();
  for (const o of obs) {
    if (typeof o.id !== 'string' || o.id === '') throw new ContractViolation('every observation needs an id');
    if (seen.has(o.id)) throw new ContractViolation(`observation ${o.id} appears twice; counting it twice would skew every rate`);
    seen.add(o.id);
    if (typeof o.tool !== 'string' || typeof o.subject !== 'string' || typeof o.observed_at !== 'string') {
      throw new ContractViolation(`observation ${o.id} needs tool, subject and observed_at`);
    }
    if (Number.isNaN(new Date(o.observed_at).getTime())) throw new ContractViolation(`observation ${o.id}: observed_at is not a time`);
    if (!o.ellis || o.ellis.tool !== o.tool) throw new ContractViolation(`observation ${o.id}: Ellis's output is from ${o.ellis?.tool ?? 'nothing'}, not ${o.tool}`);
    if (!VERDICTS.has(o.ellis.verdict)) throw new ContractViolation(`observation ${o.id}: ${JSON.stringify(o.ellis.verdict)} is not a shared verdict`);
    if ((o.ellis.verdict === 'problem' || o.ellis.verdict === 'ok') && (!Array.isArray(o.ellis.evidence) || o.ellis.evidence.length === 0)) {
      throw new ContractViolation(`observation ${o.id}: an Ellis ${o.ellis.verdict} that cites no row cannot be scored`);
    }
    if (o.reference !== null) {
      if (!REFERENCE_VERDICTS.has(o.reference.verdict)) throw new ContractViolation(`observation ${o.id}: a reference is problem or ok, got ${JSON.stringify(o.reference.verdict)}`);
      if (typeof o.reference.source !== 'string' || o.reference.source === '') throw new ContractViolation(`observation ${o.id}: the reference needs a source`);
    }
  }
}

export function isApproved(r: ReferenceOutcome | null): r is ReferenceOutcome {
  return r !== null && typeof r.approved_by === 'string' && r.approved_by.trim() !== '';
}

export function classify(ellis: SharedVerdict, reference: ReferenceVerdict): Outcome {
  const seen = ellis === 'problem' || ellis === 'ok';
  if (reference === 'problem') {
    if (!seen) return 'unseen_problem';
    return ellis === 'problem' ? 'caught' : 'miss';
  }
  if (!seen) return 'unknown_on_ok';
  return ellis === 'problem' ? 'false_alarm' : 'agreed_ok';
}

function rate(numerator: number, denominator: number, empty: string): Rate {
  if (denominator === 0) return { value: null, numerator, denominator, note: empty };
  return { value: numerator / denominator, numerator, denominator, note: null };
}

function judge(tool: string, r: Omit<ToolShadowReport, 'judgement' | 'reasons'>, c: ToolCriteria | undefined, owner: string): { judgement: Judgement; reasons: string[] } {
  const unset = !c ? ['max_miss_rate', 'max_false_alarm_rate', 'min_observations']
    : (['max_miss_rate', 'max_false_alarm_rate', 'min_observations'] as const).filter((k) => c[k] === null);
  if (!c || unset.length > 0) {
    return { judgement: 'not_judged', reasons: [`${owner} has not set ${unset.join(', ')} for ${tool}`] };
  }
  const reasons: string[] = [];
  if (r.scored < (c.min_observations as number)) reasons.push(`${r.scored} scored observations, fewer than the ${c.min_observations} required`);
  if (r.miss_rate.value === null) reasons.push(r.miss_rate.note as string);
  if (r.false_alarm_rate.value === null) reasons.push(r.false_alarm_rate.note as string);
  if (reasons.length > 0) return { judgement: 'not_judged', reasons };
  const failed: string[] = [];
  if ((r.miss_rate.value as number) > (c.max_miss_rate as number)) failed.push(`miss rate ${r.miss_rate.numerator}/${r.miss_rate.denominator} is above the limit of ${c.max_miss_rate}`);
  if ((r.false_alarm_rate.value as number) > (c.max_false_alarm_rate as number)) failed.push(`false alarm rate ${r.false_alarm_rate.numerator}/${r.false_alarm_rate.denominator} is above the limit of ${c.max_false_alarm_rate}`);
  if (failed.length > 0) return { judgement: 'does_not_meet', reasons: failed };
  return { judgement: 'meets', reasons: [`within ${owner}'s limits over ${r.scored} scored observations`] };
}

export function evaluateShadow(observations: ShadowObservation[], criteria: ShadowCriteria): ShadowReport {
  validateCriteria(criteria);
  validateObservations(observations);
  const byTool = new Map<string, ShadowObservation[]>();
  for (const o of observations) byTool.set(o.tool, [...(byTool.get(o.tool) ?? []), o]);

  const tools: ToolShadowReport[] = [...byTool.keys()].sort().map((tool) => {
    const list = [...(byTool.get(tool) as ShadowObservation[])].sort((a, b) => a.id.localeCompare(b.id));
    const counts = Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<Outcome, number>;
    const misses: string[] = [], falseAlarms: string[] = [], unreferenced: string[] = [];
    for (const o of list) {
      if (!isApproved(o.reference)) { unreferenced.push(o.id); continue; }
      const out = classify(o.ellis.verdict, o.reference.verdict);
      counts[out]++;
      if (out === 'miss' || out === 'unseen_problem') misses.push(o.id);
      if (out === 'false_alarm') falseAlarms.push(o.id);
    }
    const problems = counts.caught + counts.miss + counts.unseen_problem;
    const oks = counts.agreed_ok + counts.false_alarm + counts.unknown_on_ok;
    const base = {
      tool,
      observations: list.length,
      scored: problems + oks,
      counts,
      miss_rate: rate(counts.miss + counts.unseen_problem, problems, 'no approved reference problems in the window, so misses cannot be measured'),
      false_alarm_rate: rate(counts.false_alarm, oks, 'no approved reference oks in the window, so false alarms cannot be measured'),
      misses,
      false_alarms: falseAlarms,
      unreferenced,
    };
    return { ...base, ...judge(tool, base, criteria.tools[tool], criteria.owner) };
  });

  const times = observations.map((o) => new Date(o.observed_at).toISOString()).sort();
  const judgements = tools.map((t) => t.judgement);
  const judgement: Judgement = judgements.includes('does_not_meet') ? 'does_not_meet'
    : judgements.length > 0 && judgements.every((j) => j === 'meets') ? 'meets' : 'not_judged';
  return {
    mode: 'shadow',
    acted_on: false,
    criteria_owner: criteria.owner,
    criteria_status: criteria.status,
    window: { from: times[0] ?? null, to: times[times.length - 1] ?? null },
    judgement,
    tools,
  };
}
