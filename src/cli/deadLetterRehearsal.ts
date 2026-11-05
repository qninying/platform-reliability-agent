// Usage: node src/cli/deadLetterRehearsal.ts --fixture <dead-letter.fixture.json>
// Runs a sandbox job seeded to fail through the platform's dead-letter capture logic: three failures in a row, a
// restart between the second and third, a success in between, six in a row, and a failed table write. Prints the
// rows each case wrote, beside a counter that survives restarts. Nothing runs on the platform. Exit code 0 when
// verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadDeadLetterFixture } from '../capabilities/deadLetterRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <dead-letter.fixture.json>');
  const report = rehearse(loadDeadLetterFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
