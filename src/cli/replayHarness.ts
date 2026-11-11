// Usage: node src/cli/replayHarness.ts --source <platform checkout>
// Runs the twice-run harness over the publishing fixture jobs, in memory, and says whether it can tell safe from
// unsafe. Reads the checkout only to confirm the claim the model stands for. Exit code 0 when the harness is
// proven, 3 when it cannot fail, 1 for bad input or a moved claim.
import { parseArgs } from 'node:util';
import { audit } from '../capabilities/idempotencyAudit.ts';
import { reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' } } });

try {
  const source = requireCheckout(values.source);
  const answer = await audit(reader(source), commitOf(source));
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = answer.verdict === 'harness_proven' ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
