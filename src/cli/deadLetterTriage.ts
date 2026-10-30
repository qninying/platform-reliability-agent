// Usage: node src/cli/deadLetterTriage.ts --source <platform checkout> --snapshot <records.json>
// Presents both dead-letter stores as one queue grouped by error class, proposes per entry, and names what
// could not have reached the queue. Reads only; a person decides. Exit code 0 when entries are open, 4 when the
// queue is empty (never a clean bill of health), 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { triage, TABLES, type TriageSnapshot } from '../capabilities/deadLetterTriage.ts';
import { timerIndex } from '../inventory/timerHomes.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, snapshot: { type: 'string' } } });

function load(path: string): TriageSnapshot {
  let s: Partial<TriageSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  return s as TriageSnapshot;
}

try {
  const source = requireCheckout(values.source);
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const snap = load(values.snapshot);
  const answer = triage(timerIndex(reader(source), commitOf(source)), snap);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(answer.verdict === 'queue_open' ? 0 : 4);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
