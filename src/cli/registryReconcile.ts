// Usage: node src/cli/registryReconcile.ts --source <platform checkout> [--no-baseline]
// Measures, from the checkout's source at run time, which timers are untracked, which registry rows are phantom
// and which schedules disagree, and stamps every count with the measurement time and the commit. Compares with
// the platform's frozen baseline (cronRegistryBaseline.ts) only to say what is new and what has healed. Reads
// the checkout only; it never writes to it and runs none of its code. Exit code 0 when nothing differs from
// the baseline, 4 when something new has drifted, 3 when only healed entries differ (shrinking the baseline is
// K.D.'s call), 1 for bad input.
import { parseArgs } from 'node:util';
import { measure, parseBaseline, reconcileAnswer } from '../capabilities/registryReconciliation.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, 'no-baseline': { type: 'boolean', default: false } } });
const BASELINE = 'backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts';

try {
  const source = requireCheckout(values.source);
  const r = reader(source);
  let m;
  try {
    m = measure(r, new Date(), commitOf(source));
    if (!values['no-baseline']) m.baseline = parseBaseline(r.read(BASELINE));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('ContractViolation', (err as Error).message);
  }
  const answer = reconcileAnswer(m);
  console.log(JSON.stringify(answer, null, 2));
  process.exit(answer.verdict === 'new_drift' ? 4 : answer.verdict === 'healed_entries' ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
