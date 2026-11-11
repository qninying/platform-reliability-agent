// Usage: node src/cli/defaultOnTimers.ts --source <platform checkout> [--rows <cron_schedule_configs export.json>]
// Names every scheduler registry name with no governing cron_schedule_configs row, each on by default, with the code
// locations that apply the default and what a failed row read does at boot and reload. Without --rows it measures
// against the rows the platform's seed creates and says so. Reads only; a person rules on each name. Exit code 0
// when every name has a row, 3 when any has none, 5 when the default sites are not in the expected shape, 1 for
// bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { guard, type Rows } from '../capabilities/defaultOnTimerGuard.ts';
import { reader, commitOf, requireCheckout, InputError } from './checkout.ts';

const { values: v } = parseArgs({ options: { source: { type: 'string' }, rows: { type: 'string' } } });

function load(path: string): Rows {
  let s: { captured_at?: unknown; cron_schedule_configs?: unknown };
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  if (!Array.isArray(s.cron_schedule_configs)) throw new InputError('ContractViolation', `${path} needs cron_schedule_configs[] (use [] when empty); a missing table is not an empty one`);
  const rows = s.cron_schedule_configs.map((x, i) => {
    if (typeof x?.agent_name !== 'string' || typeof x?.enabled !== 'boolean') throw new InputError('ContractViolation', `${path} row ${i} needs agent_name and a boolean enabled`);
    return { agent_name: x.agent_name, enabled: x.enabled };
  });
  return { from: 'records', captured_at: s.captured_at, rows };
}

try {
  const source = requireCheckout(v.source);
  const rows = v.rows ? load(v.rows) : null;
  const answer = guard(reader(source), commitOf(source), rows);
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = !answer.sites_as_expected ? 5 : answer.ungoverned.length ? 3 : 0;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
