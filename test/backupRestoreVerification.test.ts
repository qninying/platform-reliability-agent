import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { backupPosition, classify, search, NO_VERIFICATION, SEARCH_INCOMPLETE, RESTORE_RULES, LIMITS, ROOTS, CONTROL, type PositionAnswer } from '../src/capabilities/backupRestoreVerification.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A small platform checkout shaped like the real one at bbde6ef. Names are test inputs.
const FILES: Record<string, string> = {
  'backend/src/services/aiOpsScheduler.ts': 'export const x = 1;\n',
  'backend/src/scripts/cleanup.ts': `/**
 * PRECONDITION: a pg_dump snapshot must exist.
 *   pg_dump -F c prod -f prod.dump
 */
console.log('PRECONDITION: a pg_dump snapshot MUST already exist');
`,
  'backend/src/db/__tests__/thing.test.ts': '// run pg_dump -F c prod on the live database\n',
  [CONTROL.file]: `#!/usr/bin/env bash
#   2. missing TABLES -> schema-only pg_dump
APPLY_SQL+=$(docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PROD_DB" --schema-only --no-owner)
`,
  'scripts/artifacts/tickets/gapData.js': `gap: 'There is no database backup of any kind.',\n+ 'no written restore procedure, RTO or RPO.',\n`,
  'docs/spec/nfrs.md': '| REQ-250 | DR | No formal plan: current recovery is "git history + Postgres snapshots." |\n',
  'docs/guide.md': 'To copy a table, run pg_dump by hand.\n',
  'directives/x.md': 'nothing\n',
  'execution/x.py': 'x = 1\n',
  'nginx/app.conf': 'server {}\n',
  'preview-db-init/x.sql': 'select 1;\n',
  '.github/ci.yml': 'on: push\n',
  'docker-compose.production.yml': 'volumes:\n  - pgdata:/var/lib/postgresql/data\n',
  'package.json': '{}\n',
  'backend/src/services/agentDomain/capabilities/platform.json': '{"x": "pg_restore run nightly"}\n',
  'docs/sessions/s.md': 'pg_restore was run\n',
  'scripts/logo.png': 'pg_restore',
};
const dirsOf = (files: Record<string, string>) => new Set(Object.keys(files).flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
const readerOf = (files: Record<string, string>): Reader => ({
  read(p) { if (files[p] === undefined) throw new Error(`no ${p}`); return files[p]; },
  list(dir) { if (!dirsOf(files).has(dir)) throw new Error(`no ${dir}`); return Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).sort(); },
});
const ask = (extra: Record<string, string> = {}): PositionAnswer => backupPosition(readerOf({ ...FILES, ...extra }), 'abc');
const without = (...paths: string[]) => { const f = { ...FILES }; for (const p of paths) delete f[p]; return f; };

test('with no backup job the answer is the exact unknown, with the search that establishes it', () => {
  const a = ask();
  assert.equal(a.statement, NO_VERIFICATION);
  assert.equal(a.statement, 'unknown, no backup verification exists in this repository');
  assert.equal(a.position, 'unknown');
  assert.equal(a.basis, 'nothing_found');
  assert.deepEqual(a.search.roots_searched, [...ROOTS]);
  assert.ok(a.search.files_read > 10);
  assert.match(a.search.terms, /pg_dump/);
  assert.equal(a.search.control.found, true);
});

test('pg_dump in unrelated scripts is listed as not evidence and never moves the position', () => {
  const a = ask();
  assert.deepEqual(a.search.hit_counts, { schema_only: 1, prose: 5, test: 1, candidate: 0 });
  assert.equal(a.not_evidence.length, 7);
  assert.equal(a.newest_backup_age, null);
  assert.equal(a.restore_last_exercised, null);
});

test('a real data dump is a candidate for a person, and still not a position', () => {
  const a = ask({ 'scripts/nightly.sh': 'docker exec db pg_dump -F c prod -f /b/prod.dump\n' });
  assert.equal(a.position, 'unknown');
  assert.equal(a.basis, 'candidates_need_a_person');
  assert.match(a.statement, /^unknown, 1 line\(s\) may be/);
  assert.notEqual(a.statement, NO_VERIFICATION);
  assert.deepEqual(a.candidates.map((h) => h.where), ['scripts/nightly.sh:1']);
  assert.ok(a.not_evidence.every((h) => h.kind !== 'candidate'));
  assert.equal(a.restore_last_exercised, null);
});

test('a run written as a bare tool name across lines is a candidate, not prose', () => {
  assert.equal(classify('backend/src/scripts/b.ts', "  'pg_dump',"), 'candidate');
  assert.equal(classify('backend/src/scripts/b.ts', "  'run pg_dump first',"), 'prose');
});

test('each kind of hit is told apart', () => {
  const f = 'scripts/x.sh';
  assert.equal(classify(f, 'pg_dump --schema-only prod'), 'schema_only');
  assert.equal(classify(f, 'pg_dump -s prod'), 'schema_only');
  assert.equal(classify(f, 'pg_dump -F c prod'), 'candidate');
  assert.equal(classify(f, '# pg_dump -F c prod'), 'prose');
  assert.equal(classify(f, '  echo "run pg_dump"'), 'prose');
  assert.equal(classify('docs/a.md', 'pg_dump -F c prod'), 'prose');
  assert.equal(classify('a/__tests__/b.ts', 'pg_dump -F c prod'), 'test');
  assert.equal(classify('a/b.test.ts', 'pg_dump -F c prod'), 'test');
});

test('every dump and restore tool is searched for', () => {
  for (const tool of ['pg_dumpall', 'pg_basebackup', 'pg_restore', 'pgbackrest', 'barman', 'wal-g']) {
    assert.equal(ask({ 'scripts/n.sh': `${tool} prod\n` }).basis, 'candidates_need_a_person', tool);
  }
});

test('a restore check with no tool name still needs a person', () => {
  const a = ask({ 'scripts/n.sh': 'run restore drill on target\n' });
  assert.equal(a.basis, 'candidates_need_a_person');
  assert.equal(a.verifying_hits[0].where, 'scripts/n.sh:1');
});

test('a restore mentioned only in prose does not change the answer but is shown', () => {
  const a = ask({ 'docs/q.md': 'Ask for the date of the last restore test.\n' });
  assert.equal(a.statement, NO_VERIFICATION);
  assert.equal(a.verifying_hits.length, 1);
});

test('a job in a compose file or package.json at the root is found', () => {
  assert.equal(ask({ 'docker-compose.production.yml': '  command: pg_dump -F c prod\n' }).basis, 'candidates_need_a_person');
  assert.equal(ask({ 'package.json': '{"backup": "pg_dump -F c prod"}\n' }).basis, 'candidates_need_a_person');
});

test('the story text, session notes and binaries are not searched, and the exclusions are stated', () => {
  const r = search(readerOf(FILES));
  assert.ok(r.hits.every((h) => !/agentDomain\/capabilities|docs\/sessions/.test(h.where)));
  assert.ok(r.verifying.every((h) => !h.where.endsWith('.png:1')));
  assert.ok(ask().search.excluded.includes('docs/sessions/'));
});

test('a claim in the repo is listed where it stands, on both sides, and decides nothing', () => {
  const a = ask();
  assert.deepEqual(a.claims_in_the_repo.map((c) => c.where).sort(), ['docs/spec/nfrs.md:1', 'scripts/artifacts/tickets/gapData.js:1', 'scripts/artifacts/tickets/gapData.js:2']);
  assert.equal(a.statement, NO_VERIFICATION);
});

test('a claim is found at the start of a sentence too', () => {
  assert.equal(ask({ 'docs/a.md': 'No database backup was taken.\n' }).claims_in_the_repo.length, 4);
});

test('a claim in a test is not a claim', () => {
  assert.equal(ask({ 'backend/src/x.test.ts': "'there is no database backup'\n" }).claims_in_the_repo.length, 3);
});

test('without the known pg_dump the search proves nothing, so it does not claim an absence', () => {
  const a = backupPosition(readerOf(without(CONTROL.file)), null);
  assert.equal(a.basis, 'search_incomplete');
  assert.equal(a.statement, SEARCH_INCOMPLETE);
  assert.equal(a.search.control.found, false);
  assert.equal(ask({ [CONTROL.file]: '# pg_dump only in a comment\n' }).basis, 'search_incomplete');
});

test('a missing root makes the search incomplete and is named', () => {
  const a = backupPosition(readerOf(without('nginx/app.conf')), null);
  assert.equal(a.basis, 'search_incomplete');
  assert.deepEqual(a.search.roots_not_found, ['nginx']);
});

test('a listed file that cannot be read makes the search incomplete and is named', () => {
  const base = readerOf(FILES);
  const a = backupPosition({ ...base, read: (p) => { if (p === 'docs/guide.md') throw new Error('denied'); return base.read(p); } }, null);
  assert.equal(a.basis, 'search_incomplete');
  assert.deepEqual(a.search.files_not_read, ['docs/guide.md']);
});

test('a missing root file is not a failed read', () => {
  assert.equal(backupPosition(readerOf(without('docker-compose.production.yml')), null).basis, 'nothing_found');
});

test('an incomplete search outranks candidates', () => {
  const f = { ...without(CONTROL.file), 'scripts/n.sh': 'pg_dump -F c prod\n' };
  assert.equal(backupPosition(readerOf(f), null).basis, 'search_incomplete');
});

test('the policy is undefined and belongs to K.D. and A.M.', () => {
  const p = ask().policy;
  assert.deepEqual([p.recovery_objective, p.destination, p.cadence], [null, null, null]);
  assert.deepEqual(p.agreed_by, []);
  assert.deepEqual(p.to_agree, ['K.D.', 'A.M.']);
});

test('the restore rules, human decision and limits travel with every answer', () => {
  for (const a of [ask(), ask({ 'scripts/n.sh': 'pg_dump -F c x\n' }), backupPosition(readerOf(without(CONTROL.file)), null)]) {
    assert.deepEqual(a.a_restore_counts_only_if, [...RESTORE_RULES]);
    assert.deepEqual(a.limits, [...LIMITS]);
    assert.equal(a.human_decision.taking_reading_or_restoring_a_production_backup, 'person_only');
  }
  assert.ok(RESTORE_RULES.some((r) => /isolated/.test(r)) && RESTORE_RULES.some((r) => /master key/.test(r)));
});

test('the same checkout gives the same answer', () => {
  assert.deepEqual(ask(), ask());
});

function checkout(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'backup-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}
const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli/backupPosition.ts', ...args], { encoding: 'utf8' });

test('the CLI gives each answer its exit code', () => {
  const clean = cli('--source', checkout(FILES));
  assert.equal(clean.status, 4);
  assert.equal(JSON.parse(clean.stdout).statement, NO_VERIFICATION);
  assert.equal(cli('--source', checkout({ ...FILES, 'scripts/n.sh': 'pg_dump -F c x\n' })).status, 3);
  assert.equal(cli('--source', checkout(without(CONTROL.file))).status, 5);
});

test('the CLI refuses bad input', () => {
  assert.equal(cli().status, 1);
  assert.equal(cli('--source', join(tmpdir(), 'nowhere-at-all')).status, 1);
});
