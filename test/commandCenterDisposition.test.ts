import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// A.M., 2026-11-04: "this was built", "this was folded into that one" and "nobody did this" are three states and
// must not render as one. The page's scripts are plain browser files, run here with the same globals.
function page() {
  const win: Record<string, any> = { CC: {} };
  const ctx = createContext({ window: win, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem: () => {} } });
  for (const f of ['ui', 'data']) runInContext(readFileSync(`command-center/${f}.js`, 'utf8'), ctx);
  return win.CC;
}
const PLAN = JSON.parse(readFileSync('.colaberry/plan.json', 'utf8'));
const PROGRESS = JSON.parse(readFileSync('.colaberry/progress.json', 'utf8'));
// Objects made inside the page's context have that context's prototypes, so compare them as plain data.
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
const story = (id: string, state: string, notes: string | null) => ({ id, criteria: [], notes, verification: { state } });

test('built, folded and untouched render as three different states', () => {
  const cc = page();
  const plan = { stories: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const progress = { stories: [story('a', 'verified', null), story('b', 'in_progress', 'Folded into platform.CAP.x (ruling). Detail.'), story('c', 'in_progress', null)] };
  const [a, b, c] = cc.joinStories(plan, progress);
  assert.deepEqual([a.state, b.state, c.state], ['verified', 'folded', 'in_progress']);
  assert.equal(b.disposition.into, 'platform.CAP.x');
  assert.equal(b.platform_state, 'in_progress', 'the platform\'s own state is kept, not overwritten');
});

test('a planned fold, a merge and a hold each say why the story is absent', () => {
  const cc = page();
  assert.deepEqual(plain(cc.disposition('To be folded into platform.CAP.y (ruling). Not built yet.')), { kind: 'fold_planned', into: 'platform.CAP.y' });
  assert.equal(cc.disposition('To be merged with platform.CAP.p and platform.CAP.q into one check').kind, 'fold_planned');
  assert.deepEqual(plain(cc.disposition('Held: waits on the broker')), { kind: 'held', into: null });
  // Only a note that starts with a disposition counts; a mention later in the text does not.
  assert.equal(cc.disposition('Built on its own. Folded into platform.CAP.z was considered and rejected.'), null);
  assert.equal(cc.disposition(null), null);
});

test('a verified story is never relabelled by its notes', () => {
  const cc = page();
  const [s] = cc.joinStories({ stories: [{ id: 'a' }] }, { stories: [story('a', 'verified', 'Folded into platform.CAP.x')] });
  assert.equal(s.state, 'verified');
  assert.equal(s.disposition, null);
});

test('on the real files, every story that is not verified explains itself: seven folded, none planned, two held', () => {
  const cc = page();
  const open = cc.joinStories(PLAN, PROGRESS).filter((s: { platform_state: string }) => s.platform_state !== 'verified');
  const count = (k: string) => open.filter((s: { state: string }) => s.state === k).length;
  assert.equal(count('folded'), 7);
  assert.equal(count('fold_planned'), 0);
  assert.equal(count('held'), 2);
  // A story with no note explains itself only by having every criterion passed: it waits on the platform's check.
  const allPassed = (id: string) => (PROGRESS.stories.find((x: { id: string }) => x.id === id)?.criteria ?? []).every((c: { passed: boolean }) => c.passed);
  const unexplained = open.filter((s: { id: string; disposition: unknown }) => s.disposition === null && !allPassed(s.id));
  assert.deepEqual(unexplained.map((s: { id: string }) => s.id), [], 'no unexplained absence');
});

test('the story page names the story it was folded into, and the platform\'s own state', () => {
  const cc = page();
  const html = cc.ui.storyDetail({ plan: PLAN, progress: PROGRESS }, 'platform.CAP.emergency_stop_and_kill_switch', '#/pm');
  // The platform's state moves (in progress, then submitted) as it syncs; the page must say whichever it is.
  const state = PROGRESS.stories.find((s: { id: string }) => s.id === 'platform.CAP.emergency_stop_and_kill_switch').verification.state.replace('_', ' ');
  assert.ok(html.includes('Folded into <a href="#/pm/platform.CAP.agent_enable_disable_control"><code>platform.CAP.agent_enable_disable_control</code></a>.'));
  assert.ok(html.includes(`The platform still records this story as ${state}.`), state);
  assert.match(html, /<span class="chip folded">folded<\/span>/);
});
