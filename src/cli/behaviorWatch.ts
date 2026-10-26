// Usage: node src/cli/behaviorWatch.ts --snapshot <behavior.json> [--hours 24] [--now <ISO time>]
// Prints which agents acted outside their grants in the window, each finding naming the missing grant.
// Reads only; stops nothing. Exit code 0 with no findings, 4 with findings, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { behaviorWatch, type BehaviorSnapshot } from '../capabilities/agentBehaviorSafetyWatch.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, hours: { type: 'string' }, now: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): BehaviorSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<BehaviorSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'agent_write_audits', 'ai_agent_activity_logs', 'ai_events'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  return s as BehaviorSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <behavior.json>');
  const snap = load(values.snapshot);
  const now = new Date(values.now ?? snap.captured_at);
  const hours = values.hours === undefined ? undefined : Number(values.hours);
  if (Number.isNaN(now.getTime())) throw new InputError('ContractViolation', `not a valid time: ${values.now ?? snap.captured_at}`);
  if (hours !== undefined && !(hours > 0 && hours <= 24 * 30)) throw new InputError('ContractViolation', `--hours must be between 0 and 720, got ${values.hours}`);
  const report = behaviorWatch(snap, { now, windowHours: hours });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.findings.length > 0 ? 4 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
