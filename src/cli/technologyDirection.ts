// Usage: node src/cli/technologyDirection.ts --snapshot <direction.json>
// Prints the tooling each enabled agent holds and where it diverges from the written, approved technology
// direction. With no direction on file, or tooling that is not recorded, the answer is unknown, never "no
// divergence". Reads only; setting the direction is a human decision. Exit code 0 when nothing diverges,
// 3 when the answer is unknown, 4 when something diverges, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assessDirection, type DirectionSnapshot } from '../capabilities/workforceTechnologyDirection.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

const TIERS = ['read_only', 'suggest_only', 'write_with_audit', 'communication'];
const RULES = ['allowed_tools', 'denied_tools', 'max_tier', 'allowed_models'];

function load(path: string): DirectionSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<DirectionSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs a readable captured_at`);
  for (const t of ['ai_agents', 'grant_map'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  if (!('direction' in s)) throw new InputError('ContractViolation', `${path} needs direction (use null when none is on file)`);
  if (!('model_uses' in s) || (s.model_uses !== null && !Array.isArray(s.model_uses))) throw new InputError('ContractViolation', `${path} needs model_uses[] (use null when no export was taken)`);
  for (const g of s.grant_map!) {
    if (!TIERS.includes(g.tier)) throw new InputError('ContractViolation', `${path} grant for ${g.agent_name} has an unknown tier ${g.tier}`);
  }
  if (s.direction) {
    if (!Array.isArray(s.direction.rules)) throw new InputError('ContractViolation', `${path} direction needs rules[]`);
    for (const r of s.direction.rules) {
      if (!RULES.includes(r.kind)) throw new InputError('ContractViolation', `${path} direction has an unknown rule ${r.kind}`);
      if (r.kind === 'max_tier' && !TIERS.includes(r.tier)) throw new InputError('ContractViolation', `${path} max_tier names an unknown tier ${r.tier}`);
    }
  }
  return s as DirectionSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <direction.json>');
  const snap = load(values.snapshot);
  const report = assessDirection(snap);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, report }, null, 2));
  process.exit(report.verdict === 'no_divergence' ? 0 : report.verdict === 'unknown' ? 3 : 4);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
