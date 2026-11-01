import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { judgeRelease, LIMITS, THREE, type Evidence, type CheckName, type ReleaseAnswer } from '../src/capabilities/deployVerificationEvidence.ts';

const SHA = 'abc1234def5678abc1234def5678abc1234def56';
const DIGEST = 'sha256:aaaa';
const APP = JSON.stringify({ status: 'ok', timestamp: '2026-11-01T12:01:00Z' });
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

const good = (): Evidence => ({
  intended_sha: SHA,
  deployed_sha: SHA,
  deployed_at: '2026-11-01T12:00:00Z',
  services: ['backend', 'nginx'],
  changed_routes: ['/api/thing'],
  pinned_digests: { backend: DIGEST, nginx: 'sha256:bbbb' },
  tree: { clean: true, head_is_origin_main: true },
  lock: { held: true },
  containers: [
    { service: 'backend', state: 'running', image: 'ghcr.io/x/accelerator-backend:main', digest: DIGEST },
    { service: 'nginx', state: 'running', image: `ghcr.io/x/accelerator-nginx:sha-${SHA}` },
  ],
  routes: [
    { path: '/health', via: 'edge', status: 200, at: '2026-11-01T12:01:00Z', body: APP },
    { path: '/api/thing', via: 'edge', status: 200, at: '2026-11-01T12:01:00Z', body: '{"items":[]}' },
  ],
});
const ask = (change: (e: Evidence) => void = () => {}): ReleaseAnswer => { const e = good(); change(e); return judgeRelease(e); };
const of = (a: ReleaseAnswer, name: CheckName) => a.checks.find((c) => c.check === name)!;
const health = (e: Evidence) => e.routes!.find((r) => r.path === '/health')!;

test('full evidence agrees, and the answer leaves the decision to a person', () => {
  const a = ask();
  assert.equal(a.verdict, 'evidence_agrees');
  assert.ok(a.checks.every((c) => c.status === 'agrees'));
  assert.match(a.statement, /a person's call/);
  assert.equal(a.human_decision.whether_the_release_stands, 'person_only');
});

test('missing any of the three is unverified, never deployed', () => {
  const removers: Record<string, (e: Evidence) => void> = {
    deployed_sha: (e) => { delete e.deployed_sha; },
    running_image: (e) => { delete e.containers; },
    application_started: (e) => { e.routes = e.routes!.filter((r) => r.path !== '/health'); },
  };
  assert.deepEqual(Object.keys(removers), [...THREE]);
  for (const [name, remove] of Object.entries(removers)) {
    const a = ask(remove);
    assert.equal(a.verdict, 'unverified', name);
    assert.equal(of(a, name as CheckName).status, 'missing', name);
    assert.doesNotMatch(a.statement, /deployed\b/i, name);
    assert.match(a.statement, new RegExp(name));
  }
});

test('an empty record is unverified on every check', () => {
  const a = judgeRelease({});
  assert.equal(a.verdict, 'unverified');
  assert.ok(a.checks.every((c) => c.status === 'missing'));
  assert.equal(a.intended_sha, null);
});

test('an edge 200 alone is never proof the application started', () => {
  for (const body of [undefined, null, '', SHELL, 'OK']) {
    const a = ask((e) => { health(e).body = body; });
    assert.equal(of(a, 'application_started').status, 'missing', String(body));
    assert.equal(a.verdict, 'unverified', String(body));
    assert.match(of(a, 'application_started').detail, /not proof/);
  }
});

test('no health probe at all says so, and a non-200 cannot pass on its body', () => {
  assert.match(of(ask((e) => { e.routes = []; }), 'application_started').detail, /No probe/);
  assert.notEqual(of(ask((e) => { health(e).status = 404; }), 'application_started').status, 'agrees');
});

test('the 2026-08-28 case: site 200, backend created, is a failed verification', () => {
  const a = ask((e) => {
    e.containers![0].state = 'created';
    health(e).body = SHELL;
  });
  assert.equal(a.verdict, 'disagrees');
  assert.match(of(a, 'running_image').detail, /backend is created/);
});

test('the application reporting trouble disagrees', () => {
  assert.equal(of(ask((e) => { health(e).status = 502; health(e).body = 'Bad Gateway'; }), 'application_started').status, 'disagrees');
  assert.equal(of(ask((e) => { health(e).status = 503; health(e).body = '{"status":"error"}'; }), 'application_started').status, 'disagrees');
  assert.equal(of(ask((e) => { health(e).body = '{"status":"error"}'; }), 'application_started').status, 'disagrees');
});

test('/health/full counts, but critical does not', () => {
  const full = (overall: string, status: number) => (e: Evidence) => { Object.assign(health(e), { path: '/health/full', status, body: JSON.stringify({ overall_status: overall }) }); };
  assert.equal(of(ask(full('ok', 200)), 'application_started').status, 'agrees');
  assert.equal(of(ask(full('warning', 200)), 'application_started').status, 'agrees');
  assert.equal(of(ask(full('critical', 503)), 'application_started').status, 'disagrees');
});

test('any good health probe is enough when another was bare', () => {
  const a = ask((e) => { e.routes!.unshift({ path: '/health', via: 'container', status: 200, at: '2026-11-01T12:01:00Z' }); });
  assert.equal(of(a, 'application_started').status, 'agrees');
});

test('a 404 from the health path, as the script\'s poll can see, proves nothing', () => {
  const a = ask((e) => { Object.assign(health(e), { via: 'container', status: 404, body: '{"error":"not found"}' }); });
  assert.equal(of(a, 'application_started').status, 'missing');
});

test('a probe from before the deploy does not count', () => {
  const a = ask((e) => { e.routes!.forEach((r) => { r.at = '2026-11-01T11:59:59Z'; }); });
  assert.equal(of(a, 'application_started').status, 'missing');
  assert.equal(of(a, 'changed_routes').status, 'missing');
});

test('a probe at the deploy time counts, and one with no time does not', () => {
  assert.equal(of(ask((e) => { health(e).at = e.deployed_at!; }), 'application_started').status, 'agrees');
  assert.equal(of(ask((e) => { health(e).at = 'soon'; }), 'application_started').status, 'missing');
});

test('a different commit disagrees; a short form of the same one agrees', () => {
  assert.equal(of(ask((e) => { e.deployed_sha = 'ffff999'; }), 'deployed_sha').status, 'disagrees');
  assert.equal(of(ask((e) => { e.deployed_sha = SHA.slice(0, 8); }), 'deployed_sha').status, 'agrees');
  assert.equal(of(ask((e) => { e.deployed_sha = SHA.toUpperCase(); }), 'deployed_sha').status, 'agrees');
});

test('a sha too short or not a sha is missing, not a match', () => {
  for (const bad of ['abc', 'main', '', '   ']) assert.equal(of(ask((e) => { e.deployed_sha = bad; }), 'deployed_sha').status, 'missing', bad);
  assert.equal(of(ask((e) => { e.intended_sha = 'latest'; }), 'deployed_sha').status, 'missing');
});

test('no deploy time leaves the commit check missing', () => {
  assert.equal(of(ask((e) => { delete e.deployed_at; }), 'deployed_sha').status, 'missing');
});

test('the moving :main tag proves no commit', () => {
  const a = ask((e) => { delete e.containers![0].digest; });
  assert.equal(of(a, 'running_image').status, 'missing');
  assert.match(of(a, 'running_image').detail, /:main names no commit/);
  assert.equal(of(ask((e) => { delete e.pinned_digests; }), 'running_image').status, 'missing');
});

test('a digest that differs from the commit\'s image disagrees', () => {
  assert.equal(of(ask((e) => { e.containers![0].digest = 'sha256:cccc'; }), 'running_image').status, 'disagrees');
});

test('an image tagged for another commit disagrees', () => {
  assert.equal(of(ask((e) => { e.containers![1].image = 'ghcr.io/x/n:sha-ffff9999'; }), 'running_image').status, 'disagrees');
});

test('a service with no container row, or no services named, is missing', () => {
  const a = ask((e) => { e.containers!.pop(); });
  assert.equal(of(a, 'running_image').status, 'missing');
  assert.match(of(a, 'running_image').detail, /nginx has no container row/);
  assert.equal(of(ask((e) => { e.services = []; }), 'running_image').status, 'missing');
});

test('a changed route must answer, and must be proven', () => {
  assert.equal(of(ask((e) => { e.changed_routes = ['/api/other']; }), 'changed_routes').status, 'missing');
  assert.equal(of(ask((e) => { e.changed_routes = []; }), 'changed_routes').status, 'missing');
  assert.equal(of(ask((e) => { e.routes![1].status = 500; }), 'changed_routes').status, 'disagrees');
  assert.equal(of(ask((e) => { e.routes![1].status = 404; }), 'changed_routes').status, 'disagrees');
});

test('the page shell or a bare status does not prove a changed route, unless it is a page', () => {
  assert.equal(of(ask((e) => { e.routes![1].body = SHELL; }), 'changed_routes').status, 'missing');
  assert.equal(of(ask((e) => { e.routes![1].body = null; }), 'changed_routes').status, 'missing');
  assert.equal(of(ask((e) => { Object.assign(e.routes![1], { body: SHELL, page: true }); }), 'changed_routes').status, 'agrees');
});

test('tree state is evidence: dirty or off main disagrees, unstated is missing', () => {
  assert.equal(of(ask((e) => { e.tree!.clean = false; }), 'tree_state').status, 'disagrees');
  assert.equal(of(ask((e) => { e.tree!.head_is_origin_main = false; }), 'tree_state').status, 'disagrees');
  assert.equal(ask((e) => { e.tree!.clean = false; }).verdict, 'disagrees');
  assert.equal(of(ask((e) => { delete e.tree; }), 'tree_state').status, 'missing');
  assert.equal(of(ask((e) => { delete e.tree!.clean; }), 'tree_state').status, 'missing');
});

test('without a lock the evidence is about an indeterminate state', () => {
  for (const change of [(e: Evidence) => { delete e.lock; }, (e: Evidence) => { e.lock!.held = false; }]) {
    const a = ask(change);
    assert.equal(a.verdict, 'unverified');
    assert.match(of(a, 'deploy_lock').detail, /indeterminate/);
  }
});

test('a disagreement outranks anything missing', () => {
  assert.equal(ask((e) => { e.deployed_sha = 'ffff999'; delete e.lock; }).verdict, 'disagrees');
});

test('malformed fields are missing, not a crash', () => {
  const a = judgeRelease({ services: 'backend', containers: 'x', routes: 'y', tree: 1, lock: 'yes', changed_routes: 7 } as unknown as Evidence);
  assert.equal(a.verdict, 'unverified');
});

test('the limits travel with every answer, and the same record gives the same answer', () => {
  assert.deepEqual(ask().limits, [...LIMITS]);
  assert.deepEqual(judgeRelease({}).limits, [...LIMITS]);
  assert.deepEqual(ask(), ask());
});

const cli = (...args: string[]) => spawnSync(process.execPath, ['src/cli/releaseEvidence.ts', ...args], { encoding: 'utf8' });
const file = (body: string) => { const p = join(mkdtempSync(join(tmpdir(), 'release-')), 'r.json'); writeFileSync(p, body); return p; };

test('the CLI gives each verdict its exit code', () => {
  assert.equal(cli('--evidence', file(JSON.stringify(good()))).status, 0);
  assert.equal(cli('--evidence', file(JSON.stringify({ ...good(), deployed_sha: 'ffff999' }))).status, 3);
  assert.equal(cli('--evidence', file('{}')).status, 4);
});

test('the CLI refuses bad input', () => {
  assert.equal(cli().status, 1);
  assert.equal(cli('--evidence', join(tmpdir(), 'no-such-record.json')).status, 1);
  assert.equal(cli('--evidence', file('not json')).status, 1);
  assert.equal(cli('--evidence', file('[]')).status, 1);
});

test('the example record is a real shape: it judges as unverified, and says what it lacks', () => {
  const a = judgeRelease(JSON.parse(readFileSync('examples/release-evidence.example.json', 'utf8')));
  assert.equal(a.verdict, 'unverified');
  assert.equal(of(a, 'running_image').status, 'missing');
});
