import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, openSync, closeSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// An answer larger than a pipe's buffer (64 KiB) must reach a pipe whole. process.exit() ends the process before
// Node has written the rest of a large answer to a pipe, so a reader such as jq gets the first 64 KiB only. Every
// command sets process.exitCode after its answer instead, and Node exits once the output is written.
// Test inputs are the repository's example exports; not production data.

const BIG: Array<{ cli: string; args: string[]; exit: number }> = [
  { cli: 'src/cli/agentHealth.ts', args: ['--snapshot', 'examples/cron-health.example.json'], exit: 3 },
  { cli: 'src/cli/cronHealth.ts', args: ['--snapshot', 'examples/cron-health.example.json'], exit: 3 },
];

function toFile(cli: string, args: string[]): number {
  const path = join(mkdtempSync(join(tmpdir(), 'piped-')), 'out.json');
  const fd = openSync(path, 'w');
  spawnSync(process.execPath, [cli, ...args], { stdio: ['ignore', fd, 'ignore'] });
  closeSync(fd);
  return statSync(path).size;
}

for (const { cli, args, exit } of BIG) {
  test(`${cli}: a large answer arrives whole through a pipe, with its exit code`, () => {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, exit);
    const bytes = Buffer.byteLength(r.stdout);
    assert.ok(bytes > 64 * 1024, `the example must exceed a pipe buffer to test anything (got ${bytes})`);
    assert.equal(bytes, toFile(cli, args), 'the piped answer is shorter than the same answer written to a file');
    assert.doesNotThrow(() => JSON.parse(r.stdout));
  });
}

test('no command ends with process.exit() after its answer; only error paths exit with 1', () => {
  const offenders: string[] = [];
  for (const f of readdirSync('src/cli').filter((n) => n.endsWith('.ts'))) {
    readFileSync(join('src/cli', f), 'utf8').split('\n').forEach((line, i) => {
      if (/process\.exit\(/.test(line) && !/process\.exit\(1\);/.test(line)) offenders.push(`src/cli/${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
