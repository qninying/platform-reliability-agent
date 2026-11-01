// Usage: node src/cli/reliabilityThresholds.ts --source <platform checkout> [--alerts <alerts.json>]
// Reports every reliability threshold in the inventory with its file, line and what it is producing. --alerts takes
// a saved GET /api/admin/alerts response with captured_at added; ask for every row, because the route pages at 50.
// A threshold with no recorded alert outcomes is reported as unmeasured. Reads only, and proposes no number. Exit code
// 0 when nothing is unmeasured and nothing sits outside the inventory, 4 otherwise, 5 when the inventory could not be
// read, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { thresholdReport, type AlertRecord } from '../capabilities/reliabilityThresholds.ts';
import { reader, commitOf, requireCheckout, InputError } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, alerts: { type: 'string' } } });

function load(path: string): AlertRecord {
  let s: Partial<AlertRecord>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  if (!Array.isArray(s.alerts) || !s.alerts.every((a) => typeof a?.title === 'string' && typeof a?.status === 'string')) throw new InputError('ContractViolation', `${path} needs alerts, each with title and status`);
  if (!Number.isInteger(s.total) || (s.total as number) < 0) throw new InputError('ContractViolation', `${path} needs total, the route's full count`);
  return s as AlertRecord;
}

try {
  const source = requireCheckout(values.source);
  const answer = thresholdReport(reader(source), commitOf(source), values.alerts ? load(values.alerts) : null);
  console.log(JSON.stringify(answer, null, 2));
  process.exit(!answer.inventory_complete ? 5 : answer.counts.unmeasured || answer.counts.outside_the_inventory ? 4 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
