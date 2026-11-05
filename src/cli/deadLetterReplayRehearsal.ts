// Usage: node src/cli/deadLetterReplayRehearsal.ts --fixture <dead-letter-replay.fixture.json>
// Triages dead-lettered publishing entries in a sandbox: each is replayed twice on a throwaway copy first, and
// replayed once on the sandbox queue only if its content ends with one post. Prints each verdict beside a triage that
// replays without the trial. Nothing runs on the platform. Exit code 0 when verified, 3 when not, 1 for bad input.
import { parseArgs } from 'node:util';
import { rehearse, loadReplayFixture } from '../capabilities/deadLetterReplayRehearsal.ts';
import { SandboxError } from '../sandbox/sandboxStore.ts';

const { values } = parseArgs({ options: { fixture: { type: 'string' } } });

try {
  if (!values.fixture) throw new SandboxError('ContractViolation', 'missing --fixture <dead-letter-replay.fixture.json>');
  const report = rehearse(loadReplayFixture(values.fixture));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verified ? 0 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exitCode = 1;
}
