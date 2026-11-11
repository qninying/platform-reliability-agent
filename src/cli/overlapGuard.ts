// Usage: node src/cli/overlapGuard.ts --source <platform checkout> --snapshot <records.json> [--window-days 30]
// Names every timer whose recorded duration can exceed its own interval, with both figures, says which jobs
// hold their own claim, and lists a timer with no duration data as unassessable. Reads only. Exit code 0 when
// every timer is assessed and none can overlap, 3 when any can, 4 when none can but some cannot be assessed,
// 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { overlapGuard, TABLES, type OverlapSnapshot } from '../capabilities/cronOverlapGuard.ts';
import { timerIndex } from '../inventory/timerHomes.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, snapshot: { type: 'string' }, 'window-days': { type: 'string' } } });

function load(path: string): OverlapSnapshot {
  let s: Partial<OverlapSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  return s as OverlapSnapshot;
}

try {
  const source = requireCheckout(values.source);
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const windowDays = values['window-days'] === undefined ? 30 : Number(values['window-days']);
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new InputError('ContractViolation', '--window-days needs a whole number of days, 1 or more');
  const snap = load(values.snapshot);
  const r = reader(source);
  const answer = overlapGuard(r, timerIndex(r, commitOf(source)), snap, { window_days: windowDays });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exitCode = answer.verdict === 'can_overlap' ? 3 : answer.verdict === 'none_assessable_overlap' ? 4 : 0;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
