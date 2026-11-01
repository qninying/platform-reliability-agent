import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, statSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readiness, gitReader, deniedInGrants, policyMatches, GRANTS, DENIED, GIT_READS, LIMITS, NOT_MEASURED, POLICY_FILE, ReadinessError } from '../src/capabilities/deployReadiness.ts';
import { reader } from '../src/cli/checkout.ts';

// Real git in temporary repositories, because what is being measured is what git says. Names are test inputs.
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
function repos() {
  const root = mkdtempSync(join(tmpdir(), 'ready-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  mkdirSync(remote);
  git(remote, 'init', '--template=', '--bare', '-q', '-b', 'main');
  mkdirSync(work);
  git(work, 'init', '--template=', '-q', '-b', 'main');
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'one');
  git(work, 'remote', 'add', 'origin', remote);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { root, remote, work };
}
function otherPushes(remote: string, root: string) {
  const other = join(root, 'other');
  spawnSync('git', ['clone', '--template=', '-q', remote, other]);
  writeFileSync(join(other, 'b.txt'), 'two\n');
  git(other, 'add', 'b.txt');
  git(other, 'commit', '-q', '-m', 'two');
  git(other, 'push', '-q', 'origin', 'main');
}
const ask = (work: string) => readiness(gitReader(work), reader(work));

test('a clean tree on origin/main is facts ready, and says it is not an approval', () => {
  const { work } = repos();
  const a = ask(work);
  assert.equal(a.readiness, 'facts_ready');
  assert.equal(a.tree.clean, true);
  assert.equal(a.head_matches_origin_main, true);
  assert.equal(a.origin_main.read_from, 'remote');
  assert.match(a.statement, /not an approval/);
  assert.equal(a.approval.state, 'unknown');
});

test('tree cleanliness and the HEAD comparison are measured facts, with both commits', () => {
  const { work } = repos();
  const a = ask(work);
  const sha = git(work, 'rev-parse', 'HEAD');
  assert.equal(a.head.sha, sha);
  assert.equal(a.origin_main.sha, sha);
  assert.equal(a.head.branch, 'main');
  assert.equal(a.source_commit, sha.slice(0, 9));
});

test('a modified tracked file is not ready, and is named', () => {
  const { work } = repos();
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  const a = ask(work);
  assert.equal(a.readiness, 'not_ready');
  assert.equal(a.tree.clean, false);
  assert.deepEqual(a.tree.tracked_paths, ['a.txt']);
  assert.match(a.statement, /1 tracked file\(s\) modified/);
});

test('a staged change is not ready either', () => {
  const { work } = repos();
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  git(work, 'add', 'a.txt');
  assert.equal(ask(work).tree.tracked_changes, 1);
});

test('an untracked file is counted and does not fail the check, matching preflight', () => {
  const { work } = repos();
  writeFileSync(join(work, 'note.txt'), 'x\n');
  const a = ask(work);
  assert.equal(a.readiness, 'facts_ready');
  assert.equal(a.tree.untracked, 1);
  assert.equal(a.tree.tracked_changes, 0);
});

test('a local commit not on origin/main is not ready', () => {
  const { work } = repos();
  writeFileSync(join(work, 'c.txt'), 'x\n');
  git(work, 'add', 'c.txt');
  git(work, 'commit', '-q', '-m', 'local');
  const a = ask(work);
  assert.equal(a.readiness, 'not_ready');
  assert.equal(a.head_matches_origin_main, false);
  assert.match(a.statement, /HEAD does not match/);
});

test('a stale local ref does not fool it: the remote moved and the local copy did not', () => {
  const { root, remote, work } = repos();
  otherPushes(remote, root);
  const local = git(work, 'rev-parse', 'origin/main');
  assert.equal(git(work, 'rev-parse', 'HEAD'), local); // what a comparison with the local ref would call a match
  const a = ask(work);
  assert.equal(a.readiness, 'not_ready');
  assert.equal(a.origin_main.local_ref_stale, true);
  assert.notEqual(a.origin_main.sha, a.origin_main.local_ref);
});

test('a remote it cannot read is unknown, never a match against the local copy', () => {
  const { root, remote, work } = repos();
  renameSync(remote, join(root, 'gone.git'));
  const a = ask(work);
  assert.equal(a.readiness, 'unknown');
  assert.equal(a.head_matches_origin_main, null);
  assert.equal(a.origin_main.read_from, 'none');
  assert.equal(a.origin_main.local_ref_stale, null);
  assert.ok(a.origin_main.local_ref);
});

test('a dirty tree outranks an unreadable remote', () => {
  const { root, remote, work } = repos();
  renameSync(remote, join(root, 'gone.git'));
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  assert.equal(ask(work).readiness, 'not_ready');
});

test('a repository with no main on the remote is not a match', () => {
  const { root } = repos();
  const empty = join(root, 'empty.git');
  mkdirSync(empty);
  git(empty, 'init', '--template=', '--bare', '-q', '-b', 'main');
  const { work } = repos();
  git(work, 'remote', 'set-url', 'origin', empty);
  const a = ask(work);
  assert.equal(a.head_matches_origin_main, null);
  assert.equal(a.readiness, 'unknown');
});

test('a detached HEAD has no branch and is still measured', () => {
  const { work } = repos();
  git(work, 'checkout', '-q', '--detach');
  const a = ask(work);
  assert.equal(a.head.branch, null);
  assert.equal(a.readiness, 'facts_ready');
});

test('both failures are stated together', () => {
  const { root, remote, work } = repos();
  otherPushes(remote, root);
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  assert.match(ask(work).statement, /modified, and HEAD does not match/);
});

test('no deploy tool, and nothing denied, is among its grants', () => {
  assert.deepEqual(deniedInGrants(GRANTS), []);
  for (const g of GRANTS) {
    assert.ok(!(DENIED as readonly string[]).includes(g), g);
    assert.doesNotMatch(g, /deploy|merge|push/i);
  }
  assert.deepEqual(ask(repos().work).denied_in_grants, []);
});

test('the grant check would catch a deploy tool or a denied capability', () => {
  assert.deepEqual(deniedInGrants(['production_deploy']), ['production_deploy']);
  assert.deepEqual(deniedInGrants(['run_deploy_script']), ['run_deploy_script']);
  assert.deepEqual(deniedInGrants(['merge_pr']), ['merge_pr']);
  assert.deepEqual(deniedInGrants(['live_email']), ['live_email']);
});

test('it can run no git command that writes, and refuses anything off its list', () => {
  const run = gitReader(repos().work);
  for (const args of [['push', 'origin', 'main'], ['merge', 'x'], ['fetch', 'origin'], ['pull'], ['commit', '-m', 'x'], ['reset', '--hard'], ['status'], ['rev-parse', 'HEAD', 'x']]) {
    assert.throws(() => run(args), ReadinessError, args.join(' '));
  }
  for (const allowed of GIT_READS) assert.doesNotMatch(allowed[0], /^(push|merge|fetch|pull|commit|reset|checkout)$/);
});

test('it leaves the checkout as it found it: no fetch, no index write', () => {
  const { root, remote, work } = repos();
  otherPushes(remote, root);
  const ref = git(work, 'rev-parse', 'origin/main');
  const before = statSync(join(work, '.git/index')).mtimeMs;
  const bytes = readFileSync(join(work, '.git/index'));
  ask(work);
  assert.equal(git(work, 'rev-parse', 'origin/main'), ref);
  assert.equal(statSync(join(work, '.git/index')).mtimeMs, before);
  assert.deepEqual(readFileSync(join(work, '.git/index')), bytes);
});

test('the denied list is checked against the checkout\'s own policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  const write = (names: string[]) => {
    mkdirSync(dirname(join(dir, POLICY_FILE)), { recursive: true });
    writeFileSync(join(dir, POLICY_FILE), `export const DENIED_CAPABILITIES: readonly DeniedCapability[] = [\n${names.map((n) => `  '${n}',`).join('\n')}\n];\n`);
  };
  assert.deepEqual(policyMatches(reader(dir)), { read: false, matches: null });
  write([...DENIED]);
  assert.deepEqual(policyMatches(reader(dir)), { read: true, matches: true });
  write([...DENIED, 'something_new']);
  assert.deepEqual(policyMatches(reader(dir)), { read: true, matches: false });
  write(DENIED.slice(1));
  assert.deepEqual(policyMatches(reader(dir)), { read: true, matches: false });
  write([...DENIED.slice(1), 'something_else']);
  assert.deepEqual(policyMatches(reader(dir)), { read: true, matches: false });
  writeFileSync(join(dir, POLICY_FILE), 'nothing here\n');
  assert.deepEqual(policyMatches(reader(dir)), { read: false, matches: null });
});

test('what it does not measure, what it never does, and its limits travel with every answer', () => {
  const a = ask(repos().work);
  assert.deepEqual(a.not_measured, [...NOT_MEASURED]);
  assert.deepEqual(a.never_does, ['merge', 'push', 'deploy']);
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.equal(a.human_decision.merging_and_deploying, 'person_only');
  assert.match(a.isolation, /capability 16/);
});

test('the same checkout gives the same answer', () => {
  const { work } = repos();
  assert.deepEqual(ask(work), ask(work));
});

test('something that is not a repository is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plain-'));
  assert.throws(() => ask(dir), (e: ReadinessError) => e.errorClass === 'NotARepository');
});

const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli/deployReadiness.ts', ...args], { encoding: 'utf8' });

test('the CLI gives each answer its exit code', () => {
  const { root, remote, work } = repos();
  assert.equal(cli('--checkout', work).status, 0);
  writeFileSync(join(work, 'a.txt'), 'changed\n');
  assert.equal(cli('--checkout', work).status, 3);
  git(work, 'checkout', '-q', '--', 'a.txt');
  renameSync(remote, join(root, 'gone.git'));
  assert.equal(cli('--checkout', work).status, 4);
});

test('the CLI refuses bad input', () => {
  assert.equal(cli().status, 1);
  assert.equal(cli('--checkout', join(tmpdir(), 'nowhere-at-all')).status, 1);
  assert.equal(cli('--checkout', mkdtempSync(join(tmpdir(), 'plain-'))).status, 1);
});
