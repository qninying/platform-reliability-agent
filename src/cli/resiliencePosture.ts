// Usage: node src/cli/resiliencePosture.ts --snapshot <resilience.json> [--now <ISO time>]
// Prints the resilience posture: each subsystem's state and the age of its last signal. Reads only.
// --now defaults to the snapshot's captured_at. Exit code 0 when healthy, 3 when any subsystem is
// unknown, 4 when degraded with no unknowns, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resiliencePosture, type ResilienceSnapshot } from '../capabilities/systemResilienceSupervision.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, now: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): ResilienceSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<ResilienceSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'department_reports'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  if (s.circuit_status === undefined) throw new InputError('ContractViolation', `${path} needs circuit_status (use null when no export was taken)`);
  if (s.circuit_status !== null && (typeof s.circuit_status.captured_at !== 'string' || !Array.isArray(s.circuit_status.statuses))) {
    throw new InputError('ContractViolation', `${path} circuit_status needs captured_at and statuses[]`);
  }
  return s as ResilienceSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <resilience.json>');
  const snap = load(values.snapshot);
  const now = values.now ?? snap.captured_at;
  if (!Number.isFinite(Date.parse(now))) throw new InputError('ContractViolation', `--now '${now}' is not a readable time`);
  const report = resiliencePosture(snap, { now });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, now, ...report }, null, 2));
  process.exit(report.verdict === 'healthy' ? 0 : report.verdict === 'unknown' ? 3 : 4);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
