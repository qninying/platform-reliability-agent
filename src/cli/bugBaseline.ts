// Usage: node src/cli/bugBaseline.ts --spec <spec.json> --source <platform checkout> --sandbox <dir> [--runs 2]
// Prepares an isolated reproduction for a bug ticket (the cited platform lines copied into a fresh sandbox,
// the checkout only read), runs the baseline test under Node's permission model, and prints whether it fails
// for the reported reason on every run. Changes nothing outside the sandbox. Exit code 0 when the baseline is
// confirmed, 3 when it is not (passes, fails for another reason, did not run, inconsistent or refused), 1 for
// bad input.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { classifyBaseline } from '../capabilities/bugBaseline.ts';
import { prepareSandbox, runBaseline, sandboxFiles, type BaselineSpec } from '../sandbox/baselineRunner.ts';

const { values } = parseArgs({ options: { spec: { type: 'string' }, source: { type: 'string' }, sandbox: { type: 'string' }, runs: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): BaselineSpec {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (!raw.ticket?.id || typeof raw.ticket.type !== 'string') throw new InputError('ContractViolation', `${path} needs ticket.id and ticket.type`);
  if (!('reported_reason' in raw)) throw new InputError('ContractViolation', `${path} needs reported_reason (null when none was stated)`);
  if (!Array.isArray(raw.excerpts)) throw new InputError('ContractViolation', `${path} needs excerpts[] (use [] when none)`);
  if (!raw.test?.file || !raw.test?.path) throw new InputError('ContractViolation', `${path} needs test.file and test.path`);
  let content: string;
  try {
    content = readFileSync(join(dirname(path), raw.test.path), 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `test ${raw.test.path} could not be read: ${(err as Error).message}`);
  }
  return { ...raw, test: { file: raw.test.file, content } };
}

try {
  if (!values.spec || !values.source || !values.sandbox) throw new InputError('ContractViolation', 'needs --spec, --source and --sandbox');
  const runsWanted = values.runs ? Number(values.runs) : 2;
  if (!Number.isInteger(runsWanted) || runsWanted < 1 || runsWanted > 10) throw new InputError('ContractViolation', '--runs must be 1 to 10');
  const spec = load(values.spec);
  let record;
  let files: string[] = [];
  if (spec.ticket.type !== 'bug' || !spec.reported_reason) {
    record = classifyBaseline(spec.ticket, spec.reported_reason, []);
  } else {
    const prepared = prepareSandbox(spec, values.source, values.sandbox);
    const runs = Array.from({ length: runsWanted }, () => runBaseline(prepared));
    record = classifyBaseline(spec.ticket, spec.reported_reason, runs, prepared.citations);
    files = sandboxFiles(prepared);
  }
  console.log(JSON.stringify({ record, sandbox_files: files }, null, 2));
  process.exit(record.accepted ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
