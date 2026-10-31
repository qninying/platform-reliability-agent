// Usage: node scripts/buildCommandCenterDomain.ts --source <platform checkout> --commit <sha>
// Writes command-center/domain.json from the capability file the platform's admin routes serve, read with
// `git show`, so the checkout is never changed. Only the fields the page renders leave the file, and the
// accountable human is written by initials because this repository is public. Same inputs, same bytes.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const FILE = 'backend/src/services/agentDomain/capabilities/platform.json';
const FIELDS = ['capability_id', 'name', 'classification', 'implementation_state', 'requirement_validation_state', 'starting_autonomy', 'max_permitted_autonomy', 'max_autonomy_rationale', 'human_decision', 'release_behaviour'] as const;

const { values } = parseArgs({ options: { source: { type: 'string' }, commit: { type: 'string' }, out: { type: 'string' } } });
if (!values.source || !values.commit) {
  console.error(JSON.stringify({ error_class: 'ContractViolation', message: 'needs --source and --commit' }));
  process.exit(1);
}
const git = (...args: string[]) => execFileSync('git', ['-C', values.source!, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
const commit = git('rev-parse', '--short=9', values.commit).trim();
const matrix = JSON.parse(git('show', `${commit}:${FILE}`)) as { capabilities: Array<Record<string, unknown>> };
const capabilities = matrix.capabilities.map((c) => Object.fromEntries(FIELDS.map((f) => [f, c[f]])));
const text = JSON.stringify({ source: { file: FILE, commit }, capabilities }, null, 1).replaceAll('Kesetebirhan Delele', 'K.D.');
writeFileSync(values.out ?? 'command-center/domain.json', `${text}\n`);
