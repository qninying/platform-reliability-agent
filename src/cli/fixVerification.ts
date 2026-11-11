// Usage: node src/cli/fixVerification.ts --fixture <fixture.json> --source <platform checkout> --sandbox <dir>
// Rehearses platform_bug_fix_dispatch R4: confirms the baseline on the pre-fix tree, applies each attempt's fix to
// a copy, and verifies the reproduction test passes with the suite green and the diff inside the named files.
// The checkout is only read. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { loadFixFixture, rehearse } from '../capabilities/fixVerification.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, source: { type: 'string' }, sandbox: { type: 'string' } } });

try {
  if (!values.fixture || !values.source || !values.sandbox) throw Object.assign(new Error('needs --fixture, --source and --sandbox'), { errorClass: 'ContractViolation' });
  const r = rehearse(loadFixFixture(values.fixture), values.source, values.sandbox);
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
