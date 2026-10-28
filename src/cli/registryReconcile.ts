// Usage: node src/cli/registryReconcile.ts --source <platform checkout> [--no-baseline]
// Measures, from the checkout's source at run time, which timers are untracked, which registry rows are phantom
// and which schedules disagree, and stamps every count with the measurement time and the commit. Compares with
// the platform's frozen baseline (cronRegistryBaseline.ts) only to say what is new and what has healed. Reads
// the checkout only; it never writes to it and runs none of its code. Exit code 0 when nothing differs from
// the baseline, 4 when something new has drifted, 3 when only healed entries differ (shrinking the baseline is
// K.D.'s call), 1 for bad input.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { measure, parseBaseline, reconcileAnswer, type Reader } from '../capabilities/registryReconciliation.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, 'no-baseline': { type: 'boolean', default: false } } });
const BASELINE = 'backend/src/services/__tests__/fixtures/cronRegistryBaseline.ts';

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function reader(root: string): Reader {
  return {
    read(rel) {
      try {
        return readFileSync(join(root, rel), 'utf8');
      } catch (err) {
        throw new InputError('SourceUnavailable', `${rel} could not be read in the checkout: ${(err as Error).message}`);
      }
    },
    list(dir) {
      const out: string[] = [];
      const walk = (abs: string) => {
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          const p = join(abs, e.name);
          if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else out.push(relative(root, p));
        }
      };
      walk(join(root, dir));
      return out.sort();
    },
  };
}

// The checkout's commit, read from .git without running git. Null when it cannot be read.
function commitOf(root: string): string | null {
  try {
    const head = readFileSync(join(root, '.git/HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head.slice(0, 9);
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) return null;
    const loose = join(root, '.git', ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim().slice(0, 9);
    const packed = readFileSync(join(root, '.git/packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
    return packed ? packed.slice(0, 9) : null;
  } catch {
    return null;
  }
}

try {
  if (!values.source) throw new InputError('ContractViolation', 'needs --source <platform checkout>');
  if (!existsSync(join(values.source, 'backend/src/services/aiOpsScheduler.ts'))) throw new InputError('SourceUnavailable', 'the --source folder is not a platform checkout');
  const r = reader(values.source);
  let m;
  try {
    m = measure(r, new Date(), commitOf(values.source));
    if (!values['no-baseline']) m.baseline = parseBaseline(r.read(BASELINE));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('ContractViolation', (err as Error).message);
  }
  const answer = reconcileAnswer(m);
  console.log(JSON.stringify(answer, null, 2));
  process.exit(answer.verdict === 'new_drift' ? 4 : answer.verdict === 'healed_entries' ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
