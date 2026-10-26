// Usage: node src/cli/securityRollup.ts --snapshot <file.json> [--now <ISO time>]
// Prints one security verdict with every contributing scanner listed as clean, dirty or unknown.
// Exit code 0 when green, 3 when unknown (escalate: the rollup is not trustworthy), 4 when red, 1 for bad input.
import { parseArgs } from 'node:util';
import { loadSnapshot, snapshotSource, SnapshotSourceError } from '../readSource.ts';
import { securityRollup } from '../capabilities/securityOversightRollup.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, now: { type: 'string' } } });

try {
  if (!values.snapshot) throw new SnapshotSourceError('ContractViolation', 'missing --snapshot <file.json>');
  const snapshot = loadSnapshot(values.snapshot);
  const now = new Date(values.now ?? snapshot.captured_at);
  if (Number.isNaN(now.getTime())) throw new SnapshotSourceError('ContractViolation', `not a valid time: ${values.now ?? snapshot.captured_at}`);
  const rollup = securityRollup(snapshotSource(snapshot), { now });
  console.log(JSON.stringify({ snapshot: { captured_at: snapshot.captured_at, captured_by: snapshot.captured_by }, ...rollup }, null, 2));
  process.exit({ green: 0, unknown: 3, red: 4 }[rollup.verdict]);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
