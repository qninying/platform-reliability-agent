// Usage: node src/cli/autonomyAuthority.ts --source <platform checkout> --environment sandbox|production [--capability <id>]
// Answers each capability's effective authority today and which constraint is binding. Without --capability it maps
// every capability, each resolved alone. A capability with no recorded approval resolves to null, never a default.
// Reads only. Exit code 0 when every capability asked about resolves, 4 when any has no authority, 5 when the rules
// could not be confirmed against the platform's module, 1 for bad input.
import { parseArgs } from 'node:util';
import { authorityReport } from '../capabilities/autonomyAuthority.ts';
import { reader, commitOf, requireCheckout, InputError } from './checkout.ts';

const { values: v } = parseArgs({ options: { source: { type: 'string' }, environment: { type: 'string' }, capability: { type: 'string' } } });

try {
  const source = requireCheckout(v.source);
  if (v.environment !== 'sandbox' && v.environment !== 'production') throw new InputError('ContractViolation', 'needs --environment sandbox or production');
  const answer = authorityReport(reader(source), commitOf(source), v.environment, v.capability);
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = !answer.rules_match ? 5 : answer.counts.no_authority ? 4 : 0;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
