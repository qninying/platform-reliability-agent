// Usage: node src/cli/shadowEvaluation.ts --observations <observations.json> [--criteria <shadow-criteria.json>]
// Scores Ellis's recorded verdicts against approved reference outcomes (R5 shadow mode) and judges each tool only
// against the limits K.D. set in governance/shadow-criteria.json. Reads two files; acts on nothing.
// Exit code 0 when every tool meets K.D.'s limits, 4 when any does not, 3 when not judged, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { evaluateShadow, type ShadowCriteria, type ShadowObservation } from '../shadow/shadowEvaluation.ts';

const DEFAULT_CRITERIA = new URL('../../governance/shadow-criteria.json', import.meta.url);
const { values } = parseArgs({ options: { observations: { type: 'string' }, criteria: { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function readJson(path: string | URL): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${String(path)} could not be read: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${String(path)} is not valid JSON: ${(err as Error).message}`);
  }
}

try {
  if (!values.observations) throw new InputError('ContractViolation', 'missing --observations <observations.json>');
  const file = readJson(values.observations) as { observations?: unknown };
  if (!Array.isArray(file.observations)) throw new InputError('ContractViolation', `${values.observations} needs observations[]`);
  const criteria = readJson(values.criteria ?? DEFAULT_CRITERIA) as ShadowCriteria;
  const report = evaluateShadow(file.observations as ShadowObservation[], criteria);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.judgement === 'meets' ? 0 : report.judgement === 'does_not_meet' ? 4 : 3;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
