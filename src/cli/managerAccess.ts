// Usage: node src/cli/managerAccess.ts --snapshot <access.json> --agent <name>
// For one agent: who may act on it and by which login route, whether its accountable manager can reach it, and
// which manager directives actually take effect. Reads only; Ellis grants nothing. Exit code 0 when the accountable
// manager passes the gate and no directive is recorded but unenforced, 3 otherwise, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { managerAccess, type AccessSnapshot } from '../capabilities/managerAccess.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, agent: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): AccessSnapshot {
  let s: Partial<AccessSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'org_members', 'admin_users', 'management_grants', 'manager_directives'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  return s as AccessSnapshot;
}

try {
  if (!values.snapshot || !values.agent) throw new InputError('ContractViolation', 'needs --snapshot and --agent');
  const snap = load(values.snapshot);
  const a = managerAccess(snap, values.agent);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, access: a }, null, 2));
  process.exitCode = a.accountable?.passes_the_gate && !a.directives.some((d) => d.effect === 'recorded_but_unenforced') ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
