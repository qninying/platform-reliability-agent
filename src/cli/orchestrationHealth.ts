// Usage: node src/cli/orchestrationHealth.ts --snapshot <file.json> [--agent <name>] [--now <ISO time>]
// Prints the answer as JSON. Exit code 0 for an answer, 2 for a refusal, 1 for bad input.
import { parseArgs } from 'node:util';
import { loadSnapshot, snapshotSource, SnapshotSourceError } from '../readSource.ts';
import { watchOrchestrationHealth } from '../capabilities/orchestrationHealthWatch.ts';

const { values } = parseArgs({
  options: { snapshot: { type: 'string' }, agent: { type: 'string' }, now: { type: 'string' } },
});

if (!values.snapshot) {
  console.error('missing --snapshot <file.json>');
  process.exit(1);
}

try {
  const snapshot = loadSnapshot(values.snapshot);
  // Default "now" is the snapshot's capture time, so an old export is judged as of when it was taken.
  const now = new Date(values.now ?? snapshot.captured_at);
  if (Number.isNaN(now.getTime())) throw new SnapshotSourceError('ContractViolation', `not a valid time: ${values.now ?? snapshot.captured_at}`);
  const answer = watchOrchestrationHealth(snapshotSource(snapshot), { now, agentName: values.agent });
  console.log(JSON.stringify({ snapshot: { captured_at: snapshot.captured_at, captured_by: snapshot.captured_by }, ...answer }, null, 2));
  process.exit(answer.kind === 'answer' ? 0 : 2);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
