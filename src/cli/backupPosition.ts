// Usage: node src/cli/backupPosition.ts --source <platform checkout>
// States the recovery position with the search that establishes it. The position is unknown in this release:
// no restore record exists to read, and pg_dump in a script is never taken as one. Reads only. Exit code 4 for
// unknown with the search complete, 3 when lines need a person to read them, 5 when the search could not
// establish anything, 1 for bad input.
import { parseArgs } from 'node:util';
import { backupPosition } from '../capabilities/backupRestoreVerification.ts';
import { reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' } } });

try {
  const source = requireCheckout(values.source);
  const answer = backupPosition(reader(source), commitOf(source));
  console.log(JSON.stringify(answer, null, 2));
  process.exit({ nothing_found: 4, candidates_need_a_person: 3, search_incomplete: 5 }[answer.basis]);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
