// Usage: node src/cli/disableRecommendation.ts --snapshot <control.json> [--agent <name> | --pause-gaps]
// For each request in the snapshot, prints whether Ellis recommends a person disable that agent, the
// evidence, and every timer the disable would and would not stop. Reads only; Ellis never disables
// anything. Exit code 0 when every request yields a disable recommendation, 3 when any yields none
// (no flag exists, already disabled, or no evidence), 1 for bad input.
// --agent prints which controls (disable, pause, the governance row) actually contain that agent: exit 0
// when pause contains it as fully as disable, 3 otherwise. --pause-gaps lists every registered agent that
// pause does not fully contain: exit 0 when there are none, 3 when there are any.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { recommendAll, containment, pauseGaps, type ControlSnapshot } from '../capabilities/agentEnableDisableControl.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, agent: { type: 'string' }, 'pause-gaps': { type: 'boolean' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): ControlSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<ControlSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['timers', 'ai_agents', 'cron_schedule_configs', 'requests'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  for (const t of s.timers!) {
    if (!Array.isArray(t.gates) || t.gates.length === 0) throw new InputError('ContractViolation', `${path} timer ${t.timer} needs gates[] (use [{"gate":"unknown","flag":null}] when not known)`);
  }
  for (const r of s.requests!) {
    if (typeof r.agent_name !== 'string' || !Array.isArray(r.evidence)) throw new InputError('ContractViolation', `${path} each request needs agent_name and evidence[]`);
  }
  return s as ControlSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <control.json>');
  const snap = load(values.snapshot);
  if (values.agent && values['pause-gaps']) throw new InputError('ContractViolation', 'use --agent or --pause-gaps, not both');
  const head = { captured_at: snap.captured_at, captured_by: snap.captured_by };
  if (values.agent) {
    const c = containment(snap, values.agent);
    console.log(JSON.stringify({ snapshot: head, containment: c }, null, 2));
    process.exit(c.row_exists && c.pause === c.disable ? 0 : 3);
  }
  if (values['pause-gaps']) {
    const gaps = pauseGaps(snap);
    console.log(JSON.stringify({ snapshot: head, pause_gaps: gaps }, null, 2));
    process.exit(gaps.length === 0 ? 0 : 3);
  }
  const recommendations = recommendAll(snap);
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, recommendations }, null, 2));
  process.exit(recommendations.every((r) => r.recommendation === 'disable') ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
