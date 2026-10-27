// Usage: node src/cli/ticketResolution.ts --fixture <tickets.fixture.json> [--resolver workforce ...]
// Runs the platform's ticket resolvers twice against a sandbox copy of the queue in the fixture and
// prints what closed, what stayed open, and whether every must-not ticket survived. Nothing reaches a
// database. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { verifyResolution } from '../capabilities/agentTicketAutoResolution.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';
import { TicketSandbox, loadTicketFixture } from '../sandbox/ticketSandbox.ts';
import { RESOLVERS, type ResolverName } from '../tickets/resolverRules.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, resolver: { type: 'string', multiple: true } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <tickets.fixture.json>');
  const chosen = values.resolver ?? RESOLVERS;
  const unknown = chosen.filter((r) => !RESOLVERS.includes(r as ResolverName));
  if (unknown.length > 0) throw new SandboxError('ContractViolation', `unknown resolver ${unknown.join(', ')}; choose from ${RESOLVERS.join(', ')}`);
  const report = verifyResolution(new TicketSandbox(loadTicketFixture(values.fixture)), chosen as ResolverName[]);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verified ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
