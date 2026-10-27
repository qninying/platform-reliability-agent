// Usage: node src/cli/cronRuns.ts --snapshot <runs.json> (--name <job> [--name <job> ...] | --coverage)
// Answers, for each name, whether the job ran, when, how long it took and whether it failed, from what the
// cron wrappers recorded, and what it cannot say. A name with no ai_agents row is "not instrumented, no
// record exists", never "did not run". --coverage groups every timer in the snapshot by what can be
// answered for it. Reads only. Exit code 0 when every name has a recorded run (or, with --coverage, every
// timer records per run), 3 when any does not, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { askRun, coverage, type RunSnapshot } from '../capabilities/cronRunInstrumentation.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, name: { type: 'string', multiple: true }, coverage: { type: 'boolean' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): RunSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<RunSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'timers', 'timer_scope'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  for (const a of s.ai_agents!) {
    if (typeof a.agent_name !== 'string' || typeof a.enabled !== 'boolean' || typeof a.run_count !== 'number') throw new InputError('ContractViolation', `${path} each ai_agents row needs agent_name, enabled and run_count`);
  }
  for (const t of s.timers!) {
    if (!Array.isArray(t.gates) || t.gates.length === 0) throw new InputError('ContractViolation', `${path} timer ${t.timer} needs at least one gate`);
  }
  return s as RunSnapshot;
}

try {
  if (!values.snapshot || (!values.name?.length && !values.coverage)) throw new InputError('ContractViolation', 'needs --snapshot and either --name or --coverage');
  const snap = load(values.snapshot);
  const head = { captured_at: snap.captured_at, captured_by: snap.captured_by };
  if (values.coverage) {
    const c = coverage(snap);
    console.log(JSON.stringify({ snapshot: head, coverage: c }, null, 2));
    process.exit(c.counters_only.length + c.not_instrumented.length + c.unknown.length === 0 ? 0 : 3);
  }
  const answers = [...new Set(values.name)].sort().map((n) => askRun(snap, n));
  console.log(JSON.stringify({ snapshot: head, answers }, null, 2));
  process.exit(answers.every((a) => a.answer === 'run_recorded') ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
