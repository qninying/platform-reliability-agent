// Usage: node src/cli/registryAsk.ts --snapshot <registry.json> --name <agent> [--name <agent> ...]
// Answers, for each name, whether it is registered and, only if it is, its enabled state, status, live
// schedule and run history. A name with no ai_agents row is 'not registered', never 'disabled' and never
// 'zero runs'. Reads only. Exit code 0 when every name is registered, 3 when any is not or is ambiguous,
// 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { askRegistry, type RegistrySnapshot } from '../capabilities/registryReadSurface.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, name: { type: 'string', multiple: true } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): RegistrySnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<RegistrySnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'timers', 'timer_scope', 'cron_schedule_configs'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  for (const a of s.ai_agents!) {
    if (typeof a.agent_name !== 'string' || typeof a.enabled !== 'boolean' || typeof a.run_count !== 'number') throw new InputError('ContractViolation', `${path} each ai_agents row needs agent_name, enabled and run_count`);
  }
  return s as RegistrySnapshot;
}

try {
  if (!values.snapshot || !values.name?.length) throw new InputError('ContractViolation', 'needs --snapshot and at least one --name');
  const snap = load(values.snapshot);
  const answers = [...new Set(values.name)].sort().map((n) => askRegistry(snap, n));
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, answers }, null, 2));
  process.exit(answers.every((a) => a.registration === 'registered') ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
