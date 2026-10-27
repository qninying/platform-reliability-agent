// Usage: node src/cli/evolutionProposals.ts --snapshot <proposals.json> [--architect <name> ...]
// Prints what the architects proposed, the rationale, and what happened to each proposal. Reads
// only; decides nothing. Exit code 0 when every proposal has a recorded outcome, 3 when any is open,
// 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { proposalReport, type ProposalSnapshot } from '../capabilities/evolutionProposals.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, architect: { type: 'string', multiple: true } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): ProposalSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<ProposalSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['initiatives', 'tickets', 'ticket_activities'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  return s as ProposalSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <proposals.json>');
  const snap = load(values.snapshot);
  const report = proposalReport(snap, { architects: values.architect });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...report }, null, 2));
  process.exit(report.counts.open > 0 ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
