// Usage: node src/cli/replayVerdicts.ts --fixture <replay-audit.fixture.json>
// Runs each listed platform job model once, twice in a row and twice at once in a sandbox, and prints a verdict per
// job (safe, unsafe or untestable in a sandbox) with its reason, beside the deliberately unsafe control. Nothing
// runs on the platform. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadAuditFixture } from '../capabilities/replayVerdicts.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <replay-audit.fixture.json>');
  const report = await rehearse(loadAuditFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
