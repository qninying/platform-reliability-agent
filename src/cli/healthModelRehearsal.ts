// Usage: node src/cli/healthModelRehearsal.ts --fixture <health-model.fixture.json>
// Scores a sandbox fixture of agents with the corrected model and with the platform's formula, and prints each
// agent's two outputs and whether the corrected model passes. Nothing runs on the platform.
// Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadModelFixture } from '../capabilities/healthModelRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <health-model.fixture.json>');
  const report = rehearse(loadModelFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
