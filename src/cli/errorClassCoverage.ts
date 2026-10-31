// Usage: node src/cli/errorClassCoverage.ts --source <platform checkout> --snapshot <records.json> [--window-days 7]
// Reports classification coverage as a share of all recorded failures, with a generic class counted as
// unclassified, and names every catch site on the cron path that records no class. Reads only. Exit code 0 when
// every recorded failure is classified, 3 when any is not, 4 when none is recorded (coverage unknown, never
// 100%), 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { coverage, TABLES, type CoverageSnapshot } from '../capabilities/errorClassCoverage.ts';
import { timerIndex } from '../inventory/timerHomes.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, snapshot: { type: 'string' }, 'window-days': { type: 'string' } } });

function load(path: string): CoverageSnapshot {
  let s: Partial<CoverageSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  return s as CoverageSnapshot;
}

try {
  const source = requireCheckout(values.source);
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const windowDays = values['window-days'] === undefined ? 7 : Number(values['window-days']);
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new InputError('ContractViolation', '--window-days needs a whole number of days, 1 or more');
  const snap = load(values.snapshot);
  const r = reader(source);
  const answer = coverage(r, timerIndex(r, commitOf(source)), snap, { window_days: windowDays });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(answer.verdict === 'no_failures' ? 4 : answer.coverage.unclassified ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
