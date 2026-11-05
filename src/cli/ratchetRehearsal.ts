// Usage: node src/cli/ratchetRehearsal.ts --fixture <registry-ratchet.fixture.json>
// Runs the full timer and agent registry reconciliation and the ratchet over a sandbox checkout, untouched and once
// per planted change, and prints what each run failed on. Nothing runs on the platform.
// Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadRatchetFixture } from '../capabilities/ratchetRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <registry-ratchet.fixture.json>');
  const report = rehearse(loadRatchetFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
