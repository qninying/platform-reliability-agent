// Usage: node src/cli/schedulerLiveness.ts --source <platform checkout> [--boot-log <file>]
// Reports what decides whether any timer registers: the flag gating startScheduler(), the only caller of
// startAIOpsScheduler(), and whether GET /health can fail when nothing registered. With a boot log it reports how
// many AI Ops timers the last boot registered, against the count the code registers. Reads only; a person decides any
// probe change. Exit code 0 when the public probe can detect zero timers and no boot fell short, 3 when it cannot or
// the last boot registered fewer timers than the code does (K.D., 2026-11-08: any shortfall alarms), 5 when the gate
// or the caller is not the single one the story describes, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { liveness } from '../capabilities/schedulerLiveness.ts';
import { reader, commitOf, requireCheckout, InputError } from './checkout.ts';

const { values: v } = parseArgs({ options: { source: { type: 'string' }, 'boot-log': { type: 'string' } } });

try {
  const source = requireCheckout(v.source);
  let log: string | null = null;
  if (v['boot-log']) {
    try { log = readFileSync(v['boot-log'], 'utf8'); } catch (err) { throw new InputError('SourceUnavailable', `${v['boot-log']} could not be read: ${(err as Error).message}`); }
  }
  const answer = liveness(reader(source), commitOf(source), log);
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = !answer.gate.single_flag || !answer.ai_ops_start.only_caller ? 5 : answer.public_probe.detects_zero_timers && answer.against_expected.state !== 'shortfall' ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
