// Usage: node src/cli/agentHealth.ts --snapshot <health.json> [--source <platform checkout>]
// Reports each agent's health score as the registry tab computes it, worst first, and labels every score that
// rests on zero runs as unscored instead of 100. With --source, Ellis first confirms the checkout's
// aiOpsService.ts still computes the formula it reproduces; without it, the copy pinned at 4443087 is named.
// Reads only. Exit code 0 when every agent is scored, 4 when any agent has failures on record behind no score,
// 3 when any agent is unscored, cannot fall or has no row, 1 for bad input.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { agentHealth, confirmLiveFormula, type ScoreSnapshot } from '../capabilities/agentHealthScoring.ts';

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

function load(path: string): ScoreSnapshot {
  let s: Partial<ScoreSnapshot>;
  try {
    s = JSON.parse(read(path));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of ['ai_agents', 'timers', 'timer_scope'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  for (const a of s.ai_agents!) {
    if (typeof a.agent_name !== 'string' || typeof a.enabled !== 'boolean' || typeof a.status !== 'string') throw new InputError('ContractViolation', `${path} each ai_agents row needs agent_name, enabled and status`);
    for (const c of ['run_count', 'error_count'] as const) {
      if (!Number.isInteger(a[c]) || a[c] < 0) throw new InputError('ContractViolation', `${path} row ${a.agent_name} needs ${c} as a whole number of 0 or more; a missing counter is not a zero`);
    }
  }
  for (const t of s.timers!) {
    if (!Array.isArray(t.gates) || t.gates.length === 0) throw new InputError('ContractViolation', `${path} timer ${t.timer} needs at least one gate`);
  }
  return s as ScoreSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const snap = load(values.snapshot);
  let answer;
  if (values.source) {
    try {
      confirmLiveFormula(read(join(values.source, 'backend/src/services/aiOpsService.ts')));
    } catch (err) {
      if (err instanceof InputError) throw err;
      throw new InputError('ContractViolation', (err as Error).message);
    }
    answer = agentHealth(snap, 'backend/src/services/aiOpsService.ts in the given checkout, confirmed at run time');
  } else {
    answer = agentHealth(snap);
  }
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  const f = answer.fleet;
  process.exit(answer.unscored.some((a) => a.attention) ? 4 : f.unscored + f.score_cannot_fall + f.timers_with_no_row > 0 ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
