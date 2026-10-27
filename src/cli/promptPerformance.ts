// Usage: node src/cli/promptPerformance.ts --snapshot <prompts.json>
// Prints, per prompt, cost and latency from recorded llm.call runs (each figure with the run ids it came
// from), the rankings, and open change proposals. A prompt with no recorded runs is unknown, never zero.
// Reads only; adopting a prompt change is a human decision. Exit code 0 when every prompt is fully
// measured, 3 when any figure is partial or unknown, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assessPrompts, type PromptSnapshot } from '../capabilities/promptPerformance.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): PromptSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<PromptSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs a readable captured_at`);
  if (typeof s.window_days !== 'number' || !(s.window_days > 0)) throw new InputError('ContractViolation', `${path} needs window_days > 0`);
  for (const t of ['prompts', 'llm_calls'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  if (!('proposals' in s) || (s.proposals !== null && !Array.isArray(s.proposals))) throw new InputError('ContractViolation', `${path} needs proposals[] (use null when no proposal record exists)`);
  for (const c of s.llm_calls!) {
    if (typeof c.id !== 'string' || !('cost_usd' in c) || !('duration_ms' in c)) throw new InputError('ContractViolation', `${path} each llm_call needs id, cost_usd and duration_ms (null when not recorded)`);
  }
  return s as PromptSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <prompts.json>');
  const snap = load(values.snapshot);
  const report = assessPrompts(snap);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, report }, null, 2));
  process.exit(report.prompts.every((p) => p.cost.state === 'measured' && p.latency.state === 'measured') ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
