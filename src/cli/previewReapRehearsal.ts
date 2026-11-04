// Usage: node src/cli/previewReapRehearsal.ts --fixture <preview-reap.fixture.json>
// Runs the platform's reap decision and a simulated stop against a sandbox inventory of preview stacks,
// interrupts the stops the fixture names, re-runs the reaper, and prints each stack's end state, any container
// left running behind a stopped stack, and any stop that left no stop event. Nothing reaches docker or a
// database. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadReapFixture } from '../capabilities/previewReapRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <preview-reap.fixture.json>');
  const report = rehearse(loadReapFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
