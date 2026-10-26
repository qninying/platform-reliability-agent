// Usage: node src/cli/securityPosture.ts --snapshot <file.json> [--now <ISO time>]
// Prints, for each of the three security scans, what the last scan found and when.
// Exit code 0 when every scan has a known result, 3 when any is 'unknown', 1 for bad input.
import { parseArgs } from 'node:util';
import { loadSnapshot, snapshotSource, SnapshotSourceError } from '../readSource.ts';
import { securityPosture } from '../capabilities/securityPostureScan.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, now: { type: 'string' } } });

try {
  if (!values.snapshot) throw new SnapshotSourceError('ContractViolation', 'missing --snapshot <file.json>');
  const snapshot = loadSnapshot(values.snapshot);
  const now = new Date(values.now ?? snapshot.captured_at);
  if (Number.isNaN(now.getTime())) throw new SnapshotSourceError('ContractViolation', `not a valid time: ${values.now ?? snapshot.captured_at}`);
  const scans = securityPosture(snapshotSource(snapshot), { now });
  console.log(JSON.stringify({ snapshot: { captured_at: snapshot.captured_at, captured_by: snapshot.captured_by }, scans }, null, 2));
  process.exit(scans.some((s) => s.status === 'unknown') ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
