// Usage: node src/cli/orchestrationRepair.ts --fixture <file.json> [--runs 2] [--max-repairs 10]
// Runs the repair sequence against a sandbox copy of the fixture, the given number of times, and
// prints each run's report and the journal of changes. Never touches a database.
// Exit code 0 when every run verified, 1 for bad input or a failed run.
import { parseArgs } from 'node:util';
import { loadFixture, SandboxError, SandboxStore } from '../sandbox/sandboxStore.ts';
import { runRepair } from '../capabilities/orchestrationAutoRepair.ts';

const { values } = parseArgs({
  options: { fixture: { type: 'string' }, runs: { type: 'string', default: '2' }, 'max-repairs': { type: 'string' } },
});

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <file.json>');
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new SandboxError('ContractViolation', `--runs must be 1 to 10, got ${values.runs}`);
  const maxRepairs = values['max-repairs'] === undefined ? undefined : Number(values['max-repairs']);

  const fixture = loadFixture(values.fixture);
  const store = new SandboxStore(fixture);
  const reports = [];
  for (let i = 1; i <= runs; i++) {
    reports.push({ run: i, ...runRepair(store, fixture.faults, { maxRepairs }) });
  }
  const journal = store.journal();
  console.log(JSON.stringify({ fixture_id: fixture.fixture_id, runs: reports, journal, total_changes: journal.length }, null, 2));
  process.exit(reports.every((r) => r.verified || r.outcome === 'no_op') && !reports.some((r) => r.error) ? 0 : 1);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
