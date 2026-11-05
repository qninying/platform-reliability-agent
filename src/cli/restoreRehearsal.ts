// Usage: node src/cli/restoreRehearsal.ts --fixture <restore.fixture.json> --sandbox <dir> --operator <name>
// On an operator's request: proves a sandbox target isolated, restores the fixture's backup into it, and asserts it
// answers the known queries; then does the same with two truncated copies, which must fail. Takes and reads no
// production backup. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadRestoreFixture } from '../capabilities/restoreRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, sandbox: { type: 'string' }, operator: { type: 'string' } } });

try {
  if (!values.fixture || !values.sandbox || !values.operator) throw new SandboxError('ContractViolation', 'needs --fixture, --sandbox and --operator: a restore is started by a named person');
  const report = rehearse(loadRestoreFixture(values.fixture), values.fixture, values.sandbox, values.operator);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
