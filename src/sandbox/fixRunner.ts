import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BaselineInputError } from './baselineRunner.ts';

// Applies a proposed fix to a copy of a prepared sandbox. The pre-fix tree is never edited: the copy is the
// post-fix tree, so both can be run and compared. Edits name plain files inside the copy; nothing is written
// anywhere else. Which files changed is read back from the two trees, never taken from the edit list.

// An edit replaces one exact passage, which must appear once, or writes a whole file.
export type Edit = { file: string; find: string; replace: string } | { file: string; content: string };
export type Change = { file: string; change: 'modified' | 'added' };

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function copyTree(preDir: string): string {
  const dir = realpathSync(mkdtempSync(join(dirname(preDir), 'post-fix-')));
  cpSync(preDir, dir, { recursive: true });
  return dir;
}

// Returns the edit that did not apply, or null when every edit applied.
export function applyFix(dir: string, edits: Edit[]): { edit: number; why: string } | null {
  for (const [i, e] of edits.entries()) {
    if (!SAFE_NAME.test(e.file)) throw new BaselineInputError(`${e.file} must be a plain file name inside the sandbox`);
    const path = join(dir, e.file);
    if ('content' in e) { writeFileSync(path, e.content); continue; }
    if (!existsSync(path)) return { edit: i, why: `${e.file} is not in the sandbox` };
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf(e.find);
    if (at === -1) return { edit: i, why: `the passage to replace is not in ${e.file}` };
    if (text.indexOf(e.find, at + 1) !== -1) return { edit: i, why: `the passage to replace appears more than once in ${e.file}` };
    writeFileSync(path, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
  }
  return null;
}

const hashes = (dir: string) => new Map(readdirSync(dir).map((f) => [f, sha256(readFileSync(join(dir, f), 'utf8'))]));

// The diff between the pre-fix and post-fix trees, by file, taken before any test runs. An edit cannot delete a
// file, so a diff has only modified and added files.
export function treeDiff(preDir: string, postDir: string): Change[] {
  const a = hashes(preDir);
  const out: Change[] = [];
  for (const [f, h] of hashes(postDir)) if (!a.has(f)) out.push({ file: f, change: 'added' }); else if (a.get(f) !== h) out.push({ file: f, change: 'modified' });
  return out.sort((x, y) => x.file.localeCompare(y.file));
}
