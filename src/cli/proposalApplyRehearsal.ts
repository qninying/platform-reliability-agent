// Usage: node src/cli/proposalApplyRehearsal.ts --fixture <timer-proposal.fixture.json> --sandbox <dir> --operator <name>
// On an operator's request: generates the proposed registry rows for every untracked timer in a sandbox checkout,
// validates them, applies them to a sandbox registry and ticks each timer's gate. Creates no production row.
// Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadProposalFixture } from '../capabilities/proposalApplyRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, sandbox: { type: 'string' }, operator: { type: 'string' } } });

try {
  if (!values.fixture || !values.sandbox || !values.operator) throw new SandboxError('ContractViolation', 'needs --fixture, --sandbox and --operator: a proposal run is started by a named person');
  const report = rehearse(loadProposalFixture(values.fixture), values.sandbox, values.operator);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
