// Usage: node src/cli/staleActions.ts --snapshot <stale.json> [--threshold-minutes 10] [--now <ISO time>]
// Prints which scheduled actions are stuck, for how long and on which attempt, keeping rows past the
// threshold apart from rows past their attempt cap. Reads only; recovers nothing. Exit code 0 when
// nothing is stuck or unknown, 3 when anything is past the threshold or unknown, 4 when anything is past
// its attempt cap, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { staleReport, type StaleSnapshot } from '../capabilities/staleActionRecovery.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, 'threshold-minutes': { type: 'string' }, now: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): StaleSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<StaleSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['scheduled_emails', 'ai_agents', 'ai_agent_activity_logs'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  return s as StaleSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <stale.json>');
  const snap = load(values.snapshot);
  const now = new Date(values.now ?? snap.captured_at);
  if (Number.isNaN(now.getTime())) throw new InputError('ContractViolation', `not a valid time: ${values.now ?? snap.captured_at}`);
  const raw = values['threshold-minutes'];
  const thresholdMinutes = raw === undefined ? undefined : Number(raw);
  if (thresholdMinutes !== undefined && !(Number.isInteger(thresholdMinutes) && thresholdMinutes > 0)) throw new InputError('ContractViolation', `--threshold-minutes must be a whole number above 0, got ${raw}`);
  const report = staleReport(snap, { now, thresholdMinutes });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...report }, null, 2));
  process.exit(report.counts.past_attempt_cap > 0 ? 4 : report.counts.past_threshold > 0 || report.counts.unknown > 0 ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
