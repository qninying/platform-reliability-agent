// Usage: node src/cli/accessWatch.ts --snapshot <access.json> [--previous <sweep.json>] [--save <sweep.json>]
// Prints who holds which admin section, and what changed since the previous sweep if one is given.
// --save writes this sweep so the next run can compare against it. Reads only; changes no access.
// Exit code 0 on success, 1 for bad input.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AccessSnapshotError, loadAccessSnapshot } from '../access/accessSnapshot.ts';
import { accessReport, type Sweep } from '../capabilities/runtimeThreatAccessWatch.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, previous: { type: 'string' }, save: { type: 'string' } } });

function loadSweep(path: string): Sweep {
  let parsed: Partial<Sweep>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new AccessSnapshotError('SourceUnavailable', `previous sweep ${path} could not be read: ${(err as Error).message}`);
  }
  if (typeof parsed.captured_at !== 'string' || !Array.isArray(parsed.identities)) {
    throw new AccessSnapshotError('ContractViolation', `previous sweep ${path} needs captured_at and identities[]`);
  }
  return parsed as Sweep;
}

try {
  if (!values.snapshot) throw new AccessSnapshotError('ContractViolation', 'missing --snapshot <access.json>');
  const snap = loadAccessSnapshot(values.snapshot);
  const previous = values.previous ? loadSweep(values.previous) : null;
  if (previous && Date.parse(previous.captured_at) >= Date.parse(snap.captured_at)) {
    throw new AccessSnapshotError('ContractViolation', `previous sweep (${previous.captured_at}) is not older than this snapshot (${snap.captured_at})`);
  }
  const report = accessReport(snap, previous);
  if (values.save) writeFileSync(values.save, JSON.stringify(report.sweep, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
