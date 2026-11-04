// Usage: node src/cli/defaultOnRehearsal.ts --fixture <default-on.fixture.json>
// Boots a sandbox scheduler with the guard and with the platform's code: with the table readable, unreadable and
// empty, then reloads with the table unreadable. Prints which timers each started and whether the guard is
// verified. Nothing runs on the platform. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadDefaultOnFixture } from '../capabilities/defaultOnRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <default-on.fixture.json>');
  const report = rehearse(loadDefaultOnFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
