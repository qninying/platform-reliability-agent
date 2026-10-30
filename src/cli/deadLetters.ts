// Usage: node src/cli/deadLetters.ts --source <platform checkout> --snapshot <records.json>
// Reports what has been dead-lettered, by error class, in both mechanisms, and names the job families that cannot
// dead-letter, read from the checkout's source. Reads only. Exit code 0 when something is dead-lettered, 4 when
// the queues are empty (never a clean bill of health), 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { report, TABLES, type DeadLetterSnapshot } from '../capabilities/deadLetterCapture.ts';
import { timerIndex } from '../inventory/timerHomes.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, snapshot: { type: 'string' } } });

function load(path: string): DeadLetterSnapshot {
  let s: Partial<DeadLetterSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  return s as DeadLetterSnapshot;
}

try {
  const source = requireCheckout(values.source);
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const snap = load(values.snapshot);
  const answer = report(timerIndex(reader(source), commitOf(source)), snap);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(answer.verdict === 'dead_lettered' ? 0 : 4);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
