// Usage: node src/cli/retentionSweepRehearsal.ts --fixture <retention-sweep.fixture.json>
// Executes a retention sweep of intelligence_decisions against a sandbox copy seeded either side of the stated
// boundary, with rows other tables reference, and runs the platform's own cycle on the same seed as the control.
// Prints what each run archived, deleted and held, and what the platform's cycle lost. Nothing reaches a
// database. Exit code 0 when verified, 3 when not (including no stated rule), 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadRetentionFixture } from '../capabilities/retentionSweepRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <retention-sweep.fixture.json>');
  const report = rehearse(loadRetentionFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
