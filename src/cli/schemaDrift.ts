// Usage: node src/cli/schemaDrift.ts --source <platform checkout> [--log <schema-drift.log copy>] [--captured-at <ISO date>] [--max-age-hours 26]
// Reports known drift from the latest run in the log and names the axes nothing measures. No log, or a log with
// no completed run, answers 'unknown, last run not found', never 'no drift'. Reads only. Exit code 0 when the
// latest fresh run reported none, 3 when drift is reported, 4 when the answer is unknown, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { schemaDriftAnswer } from '../capabilities/schemaDriftDetection.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, log: { type: 'string' }, 'captured-at': { type: 'string' }, 'max-age-hours': { type: 'string' } } });

try {
  const source = requireCheckout(values.source);
  const capturedAt = values['captured-at'] ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new InputError('ContractViolation', '--captured-at needs a date');
  const maxAge = values['max-age-hours'] === undefined ? 26 : Number(values['max-age-hours']);
  if (!Number.isFinite(maxAge) || maxAge <= 0) throw new InputError('ContractViolation', '--max-age-hours needs a number above 0');
  let log: string | null = null;
  if (values.log !== undefined) {
    try {
      log = readFileSync(values.log, 'utf8');
    } catch (err) {
      throw new InputError('ContractViolation', `${values.log} could not be read: ${(err as Error).message}`);
    }
  }
  const answer = schemaDriftAnswer(reader(source), log, capturedAt, { max_age_hours: maxAge, source_commit: commitOf(source) });
  console.log(JSON.stringify(answer, null, 2));
  process.exit(answer.verdict === 'drift_reported' ? 3 : answer.verdict === 'unknown' ? 4 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
