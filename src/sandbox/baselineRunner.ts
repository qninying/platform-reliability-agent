import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTap, type RunResult } from '../capabilities/bugBaseline.ts';
import type { Citation } from '../capabilities/orchestrationHealthWatch.ts';

// Prepares and runs a baseline test in a fresh sandbox directory. The platform checkout is only read: the cited
// lines are copied into the sandbox, never edited in place. The test runs under Node's permission model, so it
// can read and write only its own sandbox, and cannot start processes or open the network.

export interface Excerpt { from: string; lines: [number, number]; to: string; exports: string[] }
export interface BaselineSpec {
  ticket: { id: string; type: string; title: string; description: string };
  reported_reason: { error_name: string; message_includes: string } | null;
  excerpts: Excerpt[];
  test: { file: string; content: string };
}

export class BaselineInputError extends Error {
  readonly errorClass = 'ContractViolation';
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface Prepared { dir: string; testFile: string; citations: Citation[] }

export function prepareSandbox(spec: BaselineSpec, sourceRoot: string, sandboxRoot: string): Prepared {
  const root = resolve(sourceRoot);
  for (const name of [spec.test.file, ...spec.excerpts.map((e) => e.to)]) {
    if (!SAFE_NAME.test(name)) throw new BaselineInputError(`${name} must be a plain file name inside the sandbox`);
  }
  // The real path, because the permission model checks the path a module is loaded from, and a symlinked
  // sandbox root (macOS /var is /private/var) would otherwise refuse the sandbox its own files.
  const dir = realpathSync(mkdtempSync(join(resolve(sandboxRoot), 'baseline-')));
  const citations: Citation[] = [];
  for (const e of spec.excerpts) {
    const src = resolve(root, e.from);
    if (!src.startsWith(root + sep)) throw new BaselineInputError(`${e.from} is outside the platform checkout`);
    const all = readFileSync(src, 'utf8').split('\n');
    const [a, b] = e.lines;
    if (!(a >= 1 && b >= a && b <= all.length)) throw new BaselineInputError(`${e.from} has no lines ${a}-${b}`);
    const text = all.slice(a - 1, b).join('\n');
    const exportLine = e.exports.length ? `\nexport { ${e.exports.join(', ')} };\n` : '\n';
    writeFileSync(join(dir, e.to), `// Copied from ${e.from}:${a}-${b} (read-only source).\n${text}${exportLine}`);
    citations.push({ table: 'platform_source', id: `${e.from}:${a}-${b}`, fields: [`sha256:${sha256(text)}`] });
  }
  writeFileSync(join(dir, spec.test.file), spec.test.content);
  citations.push({ table: 'baseline_test', id: spec.test.file, fields: [`sha256:${sha256(spec.test.content)}`] });
  return { dir, testFile: spec.test.file, citations };
}

export function runBaseline(prepared: Prepared, testTimeoutMs = 5000): RunResult {
  const { dir, testFile } = prepared;
  const r = spawnSync(process.execPath, [
    '--permission', `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`,
    '--test', '--test-isolation=none', `--test-timeout=${testTimeoutMs}`, '--test-reporter=tap', testFile,
  ], { cwd: dir, env: {}, encoding: 'utf8', timeout: testTimeoutMs * 4 });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  return { exit_code: r.status, timed_out: timedOut, outcomes: parseTap(r.stdout ?? '') };
}

// Files the run left in the sandbox, so the record can show nothing was written anywhere else.
export function sandboxFiles(prepared: Prepared): string[] {
  return readdirSync(prepared.dir).sort();
}
