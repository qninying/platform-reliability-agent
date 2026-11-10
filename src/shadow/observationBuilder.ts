// Builds the inputs a shadow run scores (docs/shadow-evaluation.md), in three steps:
//   1. record   Ellis's output for a monitor on one dated export is kept, keyed by tool, subject and capture time.
//   2. sheet    a BLIND review sheet: what was judged, when, and the rows behind it, but never Ellis's verdict, so
//               the person judging what really happened is not anchored by what Ellis said.
//   3. pair     the signed sheet and the records become observations for evaluateShadow().
//
// Why references come from people and not from the platform's own check: several monitors reproduce that check
// with its own thresholds, so a reference taken from it would agree with Ellis by construction and prove nothing.
//
// Nothing here acts on the platform or approves anything. A reference counts only when the sheet names who
// approved it; this module never fills that in.

import { createHash } from 'node:crypto';
import type { Evidence, ToolOutput } from '../output/toolOutput.ts';
import { ContractViolation } from '../output/toolOutput.ts';
import type { ReferenceOutcome, ShadowObservation } from './shadowEvaluation.ts';

export interface RecordedOutput {
  id: string;
  tool: string;
  subject: string;
  observed_at: string;
  output: ToolOutput<unknown>;
}

export interface SheetRow {
  id: string;
  tool: string;
  subject: string;
  observed_at: string;
  // Where to look, not what Ellis concluded.
  rows_to_check: Evidence[];
  reference: { verdict: 'problem' | 'ok' | null; source: string; approved_by: string | null; approved_at: string | null };
}

export interface ReviewSheet {
  instructions: string;
  rows: SheetRow[];
}

export interface PairResult {
  observations: ShadowObservation[];
  awaiting_review: string[];
  // Sheet rows whose id matches no recorded output: refused from scoring, listed so they are not lost.
  orphaned: string[];
}

export const SHEET_INSTRUCTIONS =
  'For each row, look at what really happened on the platform for this subject at this time, using the rows listed. '
  + 'Set reference.verdict to "problem" or "ok", reference.source to where you looked, and reference.approved_by and '
  + 'reference.approved_at to your name and the date. Leave a row blank if you cannot tell: blank rows are not scored. '
  + "Ellis's verdict is left off this sheet on purpose.";

function canonicalTime(t: string, what: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new ContractViolation(`${what}: ${JSON.stringify(t)} is not a time`);
  return d.toISOString();
}

export function recordId(tool: string, subject: string, observedAt: string): string {
  const key = `${tool}\n${subject}\n${canonicalTime(observedAt, 'observed_at')}`;
  return 'obs-' + createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function makeRecord(output: ToolOutput<unknown>, subject = 'fleet'): RecordedOutput {
  const at = output.as_of?.captured_at;
  if (typeof at !== 'string') throw new ContractViolation(`${output.tool}: an output with no capture time cannot be recorded for shadow scoring`);
  if (subject.trim() === '') throw new ContractViolation('subject must not be empty');
  const observed_at = canonicalTime(at, `${output.tool} captured_at`);
  return { id: recordId(output.tool, subject, observed_at), tool: output.tool, subject, observed_at, output };
}

// Adding the same record again changes nothing; a different output under the same id is refused, because two
// verdicts for one subject at one time would make the score depend on which one was kept.
export function mergeRecords(existing: RecordedOutput[], incoming: RecordedOutput[]): { records: RecordedOutput[]; added: number } {
  const byId = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  for (const r of incoming) {
    const prior = byId.get(r.id);
    if (prior) {
      if (JSON.stringify(prior.output) !== JSON.stringify(r.output)) {
        throw new ContractViolation(`record ${r.id} (${r.tool}, ${r.subject}, ${r.observed_at}) already holds a different output`);
      }
      continue;
    }
    byId.set(r.id, r);
    added++;
  }
  return { records: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), added };
}

export function reviewSheet(records: RecordedOutput[], existing?: ReviewSheet): ReviewSheet {
  const kept = new Map((existing?.rows ?? []).map((r) => [r.id, r.reference]));
  const rows: SheetRow[] = [...records].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({
    id: r.id,
    tool: r.tool,
    subject: r.subject,
    observed_at: r.observed_at,
    rows_to_check: r.output.evidence,
    // A row a person already filled in is carried over untouched when the sheet is regenerated.
    reference: kept.get(r.id) ?? { verdict: null, source: '', approved_by: null, approved_at: null },
  }));
  return { instructions: SHEET_INSTRUCTIONS, rows };
}

export function pair(records: RecordedOutput[], sheet: ReviewSheet): PairResult {
  const byId = new Map(records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const filled = new Map<string, ReferenceOutcome>();
  const orphaned: string[] = [];
  for (const row of sheet.rows) {
    if (seen.has(row.id)) throw new ContractViolation(`sheet row ${row.id} appears twice`);
    seen.add(row.id);
    if (!byId.has(row.id)) { orphaned.push(row.id); continue; }
    const ref = row.reference;
    if (ref.verdict === null) continue;
    if (ref.verdict !== 'problem' && ref.verdict !== 'ok') throw new ContractViolation(`sheet row ${row.id}: verdict must be problem, ok or null`);
    if (typeof ref.source !== 'string' || ref.source.trim() === '') throw new ContractViolation(`sheet row ${row.id}: a filled-in reference must say where the reviewer looked`);
    filled.set(row.id, { verdict: ref.verdict, source: ref.source, approved_by: ref.approved_by, approved_at: ref.approved_at });
  }
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const observations: ShadowObservation[] = sorted.map((r) => ({
    id: r.id,
    tool: r.tool,
    subject: r.subject,
    observed_at: r.observed_at,
    ellis: { tool: r.output.tool, verdict: r.output.verdict, evidence: r.output.evidence },
    reference: filled.get(r.id) ?? null,
  }));
  const awaiting = sorted.filter((r) => !filled.has(r.id)).map((r) => r.id);
  return { observations, awaiting_review: awaiting, orphaned: orphaned.sort() };
}
