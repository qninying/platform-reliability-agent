// Reads a platform checkout for the CLIs that answer from source: file text, a recursive file list, and the
// checkout's commit. Reads only; it never writes to the checkout and runs none of its code.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Reader } from '../capabilities/registryReconciliation.ts';

export class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

export function reader(root: string): Reader {
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
export function commitOf(root: string): string | null {
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

export function requireCheckout(source: string | undefined): string {
  if (!source) throw new InputError('ContractViolation', 'needs --source <platform checkout>');
  if (!existsSync(join(source, 'backend/src/services/aiOpsScheduler.ts'))) throw new InputError('SourceUnavailable', 'the --source folder is not a platform checkout');
  return source;
}
