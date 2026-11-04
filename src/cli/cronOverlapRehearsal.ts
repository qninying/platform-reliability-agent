// Usage: node src/cli/cronOverlapRehearsal.ts --fixture <cron-overlap.fixture.json>
// Runs a timer forced to overrun its interval on several sandbox scheduler processes, once with Ellis's shared-claim
// guard and once with the library's per-process guard, and prints every tick's record, the runs, and any overlap
// or silent skip. Time is simulated; nothing runs on the platform. Exit code 0 when verified, 3 when not, 1 for
// bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadOverlapFixture } from '../capabilities/cronOverlapRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <cron-overlap.fixture.json>');
  const report = rehearse(loadOverlapFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
