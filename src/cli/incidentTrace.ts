// Usage: node src/cli/incidentTrace.ts --snapshot <trace.json> (--trace <id> | --activity <id> | --error <id> | --job <name>)
// Assembles the trace behind a trace id, an activity row, an error record or a job's latest failure, and states
// the probable cause in the run's own words with the rows behind it. Where no trace exists it says why, starting
// "not traceable", and pieces nothing together. Reads only; Ellis never marks an error resolved. Exit code 0 when
// traced, 3 when not traceable, 4 when nothing was found or no failure is recorded, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { trace, type Query, type TraceSnapshot } from '../capabilities/incidentTrace.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, trace: { type: 'string' }, activity: { type: 'string' }, error: { type: 'string' }, job: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): TraceSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<TraceSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'campaign_errors', 'ai_events', 'timers', 'timer_scope'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  for (const r of s.ai_agent_activity_logs!) {
    if (typeof r.id !== 'string' || typeof r.created_at !== 'string' || !('trace_id' in r)) throw new InputError('ContractViolation', `${path} each activity row needs id, created_at and trace_id (null when absent)`);
  }
  return s as TraceSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const asked = (['trace', 'activity', 'error', 'job'] as const).filter((k) => values[k] !== undefined);
  if (asked.length !== 1) throw new InputError('ContractViolation', 'needs exactly one of --trace, --activity, --error or --job');
  const v = values[asked[0]]!;
  const query: Query = asked[0] === 'trace' ? { trace_id: v } : asked[0] === 'activity' ? { activity_id: v } : asked[0] === 'error' ? { error_id: v } : { job: v };
  const snap = load(values.snapshot);
  const answer = trace(snap, query);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(answer.verdict === 'traced' ? 0 : answer.verdict === 'not_traceable' ? 3 : 4);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
