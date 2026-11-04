// Usage: node src/cli/staleRecoveryRehearsal.ts --fixture <stale-recovery.fixture.json>
// Runs the platform's stale-action recovery against a sandbox copy of the queue in the fixture: two runs read
// at once, a slow row's owner renews its claim between their read and their writes, then both write.
// Prints each row's outcome, which run recovered it, and the journal. Nothing reaches a
// database. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadQueueFixture } from '../capabilities/staleRecoveryRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <stale-recovery.fixture.json>');
  const report = rehearse(loadQueueFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
