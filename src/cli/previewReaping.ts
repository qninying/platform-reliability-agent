// Usage: node src/cli/previewReaping.ts --snapshot <preview.json> [--idle-minutes 30] [--now <ISO time>]
// Prints which preview stacks are live, how idle each is, and which are reap candidates.
// Reads only; stops nothing. Exit code 0 when every live stack's idleness is known and nothing needs
// attention, 3 when any stack is unknown_idle or needs attention, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { reapingReport, type PreviewSnapshot } from '../capabilities/previewStackReaping.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, 'idle-minutes': { type: 'string' }, now: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): PreviewSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<PreviewSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['preview_stacks', 'preview_events', 'ai_agents', 'ai_agent_activity_logs'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  return s as PreviewSnapshot;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <preview.json>');
  const snap = load(values.snapshot);
  const now = new Date(values.now ?? snap.captured_at);
  if (Number.isNaN(now.getTime())) throw new InputError('ContractViolation', `not a valid time: ${values.now ?? snap.captured_at}`);
  const raw = values['idle-minutes'];
  const idleMinutes = raw === undefined ? undefined : Number(raw);
  if (idleMinutes !== undefined && !(Number.isInteger(idleMinutes) && idleMinutes > 0)) throw new InputError('ContractViolation', `--idle-minutes must be a whole number above 0, got ${raw}`);
  const report = reapingReport(snap, { now, idleMinutes });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...report }, null, 2));
  process.exit(report.counts.unknown_idle > 0 || report.attention.length > 0 ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
