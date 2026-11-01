// Usage: node src/cli/promotionEvidence.ts --source <platform checkout> --capability <id> --rung autonomy:Rn
//          --environment sandbox|production [--evidence <evidence.json>]
// Assembles the evidence for one capability at one rung and states whether it meets that rung's acceptance criteria.
// Run from this repository: it reads .colaberry/progress.json and the cited tests here. Run record paths in the
// evidence file are relative to that file. Reads only: it grants nothing and records nothing. Exit code 0 when every
// criterion cites a run record, 4 for unproven or unmet, 5 when the rung cannot be reached, 1 for bad input.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assemble, type Environment, type EvidenceItem } from '../capabilities/promotionEvidence.ts';
import { reader, commitOf, requireCheckout, InputError } from './checkout.ts';

const { values: v } = parseArgs({ options: { source: { type: 'string' }, capability: { type: 'string' }, rung: { type: 'string' }, environment: { type: 'string' }, evidence: { type: 'string' } } });

function load(path: string): EvidenceItem[] {
  let s: { items?: EvidenceItem[] };
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(s.items) || !s.items.every((i) => ['capability_id', 'rung', 'kind', 'cite'].every((k) => typeof i?.[k as keyof EvidenceItem] === 'string'))) {
    throw new InputError('ContractViolation', `${path} needs items, each with capability_id, rung, criterion, kind and cite`);
  }
  return s.items;
}

try {
  const source = requireCheckout(v.source);
  if (!v.capability || !v.rung) throw new InputError('ContractViolation', 'needs --capability and --rung');
  if (v.environment !== 'sandbox' && v.environment !== 'production') throw new InputError('ContractViolation', 'needs --environment sandbox or production');
  const environment: Environment = v.environment;
  const items = v.evidence ? load(v.evidence) : [];
  const base = v.evidence ? dirname(resolve(v.evidence)) : process.cwd();
  const readRecord = (p: string) => {
    try {
      return { text: readFileSync(resolve(base, p), 'utf8') };
    } catch {
      return null; // reported on the item as unreadable, and it counts for nothing
    }
  };
  const answer = assemble(reader(source), reader(process.cwd()), commitOf(source), { capability_id: v.capability, rung: v.rung, environment }, items, readRecord);
  console.log(JSON.stringify(answer, null, 2));
  process.exit({ meets_criteria: 0, unproven: 4, unmet: 4, no_criteria_defined: 5, above_ceiling: 5, rung_needs_production: 5 }[answer.verdict]);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
