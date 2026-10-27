// Usage: node src/cli/cronHealth.ts --snapshot <health.json> [--source <platform checkout>]
// Answers which cron jobs the platform's health check would alert on right now (error spike or missed runs),
// which it evaluates only in part, and which it cannot evaluate at all, listed by name with the reason.
// With --source, the thresholds and the check's selection are read from the checkout's
// cronHealthAlertService.ts; without it, the copy pinned at 4443087 is used and named. Reads only; Ellis
// never raises an alert. Exit code 0 when no job alerts and every job is fully evaluated, 4 when any job
// alerts, 3 when none alerts but any job is evaluated in part or not at all, 1 for bad input.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cronHealth, readLiveThresholds, type HealthSnapshot } from '../capabilities/cronHealthAlerting.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, source: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
}

function load(path: string): HealthSnapshot {
  let s: Partial<HealthSnapshot>;
  try {
    s = JSON.parse(read(path));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'timers', 'timer_scope'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  for (const a of s.ai_agents!) {
    if (typeof a.agent_name !== 'string' || typeof a.enabled !== 'boolean' || typeof a.trigger_type !== 'string') throw new InputError('ContractViolation', `${path} each ai_agents row needs agent_name, enabled and trigger_type`);
  }
  for (const t of s.timers!) {
    if (!Array.isArray(t.gates) || t.gates.length === 0) throw new InputError('ContractViolation', `${path} timer ${t.timer} needs at least one gate`);
  }
  return s as HealthSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const snap = load(values.snapshot);
  let answer;
  if (values.source) {
    const file = join(values.source, 'backend/src/services/cronHealthAlertService.ts');
    let live;
    try {
      live = readLiveThresholds(read(file));
    } catch (err) {
      if (err instanceof InputError) throw err;
      throw new InputError('ContractViolation', (err as Error).message);
    }
    answer = cronHealth(snap, live, 'backend/src/services/cronHealthAlertService.ts in the given checkout, read at run time');
  } else {
    answer = cronHealth(snap);
  }
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(answer.answer === 'alerting' ? 4 : answer.answer === 'clear_with_blind_spots' ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
