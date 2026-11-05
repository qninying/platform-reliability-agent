// Usage: node src/cli/errorClassRehearsal.ts --fixture <error-class.fixture.json>
// Runs seeded failures through a sandbox cron wrapper that classifies each and persists the class beside its message,
// once with Ellis's classifier and once with the platform's rule, and prints each seed's class and the coverage.
// Nothing runs on the platform. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadClassFixture } from '../capabilities/errorClassRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <error-class.fixture.json>');
  const report = rehearse(loadClassFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
