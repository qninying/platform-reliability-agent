// Usage: node scripts/checkReadme.ts
// Fails when the README's headline numbers drift from the repository: the test count must equal the number
// of tests that pass now, and the verified count may never exceed what the platform has verified in
// .colaberry/progress.json. A README that undercounts (the platform verified something after the last README
// edit) is reported but does not fail, because it claims less than is true, never more.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

interface Story { id: string; verification?: { state?: string } }

const readme = readFileSync('README.md', 'utf8');
const problems: string[] = [];

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/**/*.test.ts'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const pass = Number(run.stdout.match(/^# pass (\d+)$/m)?.[1] ?? NaN);
const fail = Number(run.stdout.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
if (Number.isNaN(pass) || Number.isNaN(fail)) problems.push('could not read the test totals from the tap output');
else if (fail > 0) problems.push(`${fail} test(s) fail`);
else if (!readme.includes(`${pass} passing`)) problems.push(`README does not say "${pass} passing" (${pass} tests pass now)`);

const caps = (JSON.parse(readFileSync('.colaberry/progress.json', 'utf8')).stories as Story[]).filter((s) => s.id.startsWith('platform.CAP.'));
const verified = caps.filter((s) => s.verification?.state === 'verified').length;
const claimed = Number(readme.match(/(\d+) of (\d+) verified/)?.[1] ?? NaN);
const total = Number(readme.match(/(\d+) of (\d+) verified/)?.[2] ?? NaN);
if (Number.isNaN(claimed)) problems.push('README has no "N of M verified" figure');
else {
  if (claimed > verified) problems.push(`README claims ${claimed} verified; the platform has verified ${verified}`);
  if (claimed < verified) console.log(`note: the platform has verified ${verified}; README still says ${claimed}`);
  if (total !== caps.length) problems.push(`README says "of ${total}"; the build plan has ${caps.length} capabilities`);
}

if (problems.length) {
  for (const p of problems) console.error(`README check: ${p}`);
  process.exit(1);
}
console.log(`README check: ${pass} passing and ${claimed} of ${total} verified match the repository`);
