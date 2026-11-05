// Usage: node src/cli/schemaCompareRehearsal.ts --fixture <schema-compare.fixture.json> --sandbox <dir> --operator <name>
// An operator-initiated comparison: builds two sandbox databases from the fixture's DDL, plants each change in the
// compared one, reads both schemas from their catalogs and prints every difference. Changes no schema outside the
// sandbox databases. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadCompareFixture } from '../capabilities/schemaCompareRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, sandbox: { type: 'string' }, operator: { type: 'string' } } });

try {
  if (!values.fixture || !values.sandbox || !values.operator) throw new SandboxError('ContractViolation', 'needs --fixture, --sandbox and --operator: a comparison is started by a named person');
  const report = rehearse(loadCompareFixture(values.fixture), values.sandbox, values.operator);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
