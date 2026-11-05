// Usage: node src/cli/livenessProbeRehearsal.ts --fixture <liveness-probe.fixture.json>
// Boots a sandbox process with the scheduler flag unset in several ways, set, and set with timers that fail to
// register, with the database healthy and down, and asks Ellis's probe and the platform's GET /health about each.
// Nothing runs on the platform. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadLivenessFixture } from '../capabilities/livenessProbeRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <liveness-probe.fixture.json>');
  const report = rehearse(loadLivenessFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
