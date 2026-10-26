// Usage: node src/cli/retentionSweep.ts --snapshot <retention.json> [--now <ISO time>]
// Prints each swept table's retention window (stated, conflicting or unknown) and when it was last swept.
// Reads only; deletes nothing. Exit code 0 when every window is stated and every table was swept on
// time, 3 when any is not, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { retentionReport, type RetentionSnapshot } from '../capabilities/dataRetentionSweep.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, now: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): RetentionSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<RetentionSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'ai_system_events'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  if (s.retention_policy !== undefined && !Array.isArray(s.retention_policy)) throw new InputError('ContractViolation', `${path}: retention_policy must be an array`);
  return s as RetentionSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <retention.json>');
  const snap = load(values.snapshot);
  const now = new Date(values.now ?? snap.captured_at);
  if (Number.isNaN(now.getTime())) throw new InputError('ContractViolation', `not a valid time: ${values.now ?? snap.captured_at}`);
  const tables = retentionReport(snap, { now });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, tables }, null, 2));
  const allKnown = tables.every((t) => t.window.status === 'stated' && t.last_sweep.status === 'swept');
  process.exit(allKnown ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
