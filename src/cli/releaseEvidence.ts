// Usage: node src/cli/releaseEvidence.ts --evidence <record.json>
// Judges one release's evidence: do the deployed commit, the running image and the live routes agree? Reads only;
// a person collects the record. Exit code 0 when the evidence agrees, 3 when it disagrees with the intent, 4 when
// it is unverified, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { judgeRelease, type Evidence } from '../capabilities/deployVerificationEvidence.ts';
import { InputError } from './checkout.ts';

const { values } = parseArgs({ options: { evidence: { type: 'string' } } });

function load(path: string | undefined): Evidence {
  if (!path) throw new InputError('ContractViolation', 'needs --evidence <record.json>');
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new InputError('ContractViolation', `${path} needs one release record as an object`);
  return record as Evidence;
}

try {
  const answer = judgeRelease(load(values.evidence));
  console.log(JSON.stringify(answer, null, 2));
  process.exitCode = { evidence_agrees: 0, disagrees: 3, unverified: 4 }[answer.verdict];
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
