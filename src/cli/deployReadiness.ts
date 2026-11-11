// Usage: node src/cli/deployReadiness.ts --checkout <git checkout>
// Reports tree cleanliness and whether HEAD matches origin/main as measured facts, asking the remote directly.
// Acts on neither: it never fetches, merges, pushes or deploys. Exit code 0 when the facts are ready, 3 when they
// are not, 4 when the remote could not be read, 1 for bad input.
import { parseArgs } from 'node:util';
import { readiness, gitReader } from '../capabilities/deployReadiness.ts';
import { InputError, reader } from './checkout.ts';

const { values } = parseArgs({ options: { checkout: { type: 'string' } } });

try {
  if (!values.checkout) throw new InputError('ContractViolation', 'needs --checkout <git checkout>');
  const answer = readiness(gitReader(values.checkout), reader(values.checkout));
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = { facts_ready: 0, not_ready: 3, unknown: 4 }[answer.readiness];
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
