import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// The page's scripts are plain browser files, so they run here in a context with the same globals.
type Dom = { getElementById: () => null };
function page(sample = false) {
  const win: Record<string, any> = {};
  const ctx = createContext({ window: win, document: { getElementById: () => null } as Dom, localStorage: { getItem: () => (sample ? 'sample' : null), setItem: () => {} } });
  for (const f of ['ui', 'data', 'domainData', 'domainTab']) {
    if (f === 'ui') win.CC = {};
    runInContext(readFileSync(`command-center/${f}.js`, 'utf8'), ctx);
  }
  return win.CC;
}
const REAL = JSON.parse(readFileSync('command-center/domain.json', 'utf8'));
const SNAP = JSON.parse(readFileSync('.colaberry/agent-domain.json', 'utf8'));
const MANIFEST = { generated_at: '2026-11-02T19:28:17.872Z' };
const progress = { stories: [{ id: 'platform.CAP.dead_letter_triage', verification: { state: 'verified' } }] };
const cap = (o: Record<string, unknown> = {}) => ({ capability_id: 'platform.x', name: 'X cap', classification: 'inherited', implementation_state: 'absent', requirement_validation_state: 'draft', starting_autonomy: 'autonomy:R0', max_permitted_autonomy: 'autonomy:R5', max_autonomy_rationale: 'the reason on record', human_decision: false, release_behaviour: [{ autonomy: 'autonomy:R2', behaviour: 'answers it', acceptance_criteria: 'cites rows' }], ...o });
const data = (capabilities: unknown[]) => ({ source: { file: 'capabilities/platform.json', commit: 'abc123def' }, capabilities });
const snap = (o: Record<string, unknown> = {}) => ({ ...SNAP, ...o });
const view = (cc: any, domain: unknown, loading = false, agentDomain: unknown = SNAP, manifest: unknown = MANIFEST) => cc.domainTab.view({ progress, domain, agentDomain, manifest, domainLoading: loading }) as string;
const panels = (html: string) => html.split('<section class="panel dp ').slice(1);
// The owner's wording, from the story. Kept apart from the page's copy so a changed word fails here.
const OWNER_WORDS = [
  'Define the workflow, requirements, risks and human decisions.',
  'Prepare isolated development, fixtures and baseline tests.',
  'Answer questions using approved knowledge and records.',
  'Perform approved, user-initiated sandbox tool operations.',
  'Execute and verify stateful, multi-step sandbox tasks.',
  'Evaluate in shadow mode against approved reference outcomes.',
  'Conduct a separately approved, supervised production pilot.',
  'Automate only explicitly authorized action classes within limits.',
  'Coordinate necessary, authorized handoffs with other agents.',
  'Demonstrate reliable operation, monitoring, recovery and ownership.',
];
const ENDPOINT = /<span class="label">Endpoint<\/span>/;

test('acceptance: all six panels render and each one names the endpoint it read', () => {
  const six = panels(view(page(), REAL));
  assert.equal(six.length, 6);
  for (const p of six) assert.match(p, ENDPOINT);
  assert.match(six[0], /agent-domains-mine/);
  assert.match(six[1], /agent-domains\/platform and \/coverage/);
  assert.match(six[4], /agent-domain-change-requests-mine/);
  for (const i of [0, 4]) assert.match(six[i], /Read instead: <code>\.colaberry\/agent-domain\.json<\/code>/);
});

test('acceptance: a panel with nothing says so in words and differs from one still loading', () => {
  const cc = page();
  const gone = panels(view(cc, REAL, false, null))[0];
  assert.match(gone, /^nothing/);
  assert.match(gone, /Nothing returned/);
  assert.match(gone, /cannot say whether the agent exists/);
  assert.match(gone, /could not be read/);
  const noAgent = panels(view(cc, REAL, false, snap({ agent: { exists: false } })))[0];
  assert.match(noAgent, /^nothing/);
  assert.match(noAgent, /No agent yet/);
  const loading = panels(view(cc, null, true));
  assert.equal(loading.length, 6);
  for (const p of loading) { assert.match(p, /^loading/); assert.match(p, /Still fetching/); assert.doesNotMatch(p, /Nothing returned/); }
  for (const p of panels(view(cc, null, false))) { assert.match(p, /^nothing/); assert.doesNotMatch(p, /Still fetching/); }
  assert.match(panels(view(cc, data([])))[1], /^nothing/);
  assert.match(panels(view(cc, REAL))[4], /^nothing[\s\S]*No change requests and no tool requests have been filed/);
});

test('acceptance: all ten rungs are present in the owner\'s words, with each ceiling marked where it stops', () => {
  const cc = page();
  const p = panels(view(cc, data([cap()]), false, snap({ authority: [{ capability_id: 'platform.x', effective_autonomy: 'autonomy:R0', reasons: [] }] })))[2];
  assert.equal(cc.domain.RUNGS.length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(cc.domain.RUNGS)).map((r: string[]) => r[1]), OWNER_WORDS);
  for (const [rung, words] of cc.domain.RUNGS) { assert.ok(p.includes(`<strong>${rung.replace('autonomy:', '')}</strong> ${words}`), rung); }
  const states = JSON.parse(JSON.stringify(cc.domain.rungStates(cap(), 'autonomy:R0')));
  assert.deepEqual(states.map((s: { state: string }) => s.state), ['reachable', 'reachable', 'reachable', 'reachable', 'reachable', 'ceiling', 'unreachable', 'unreachable', 'by_fact', 'unreachable']);
  assert.deepEqual(states.map((s: { now: boolean }) => s.now), [true, false, false, false, false, false, false, false, false, false]);
  assert.match(p, /Why it stops at R5: the reason on record/);
  assert.match(p, /Unreachable by fact/);
  assert.match(p, /title="R0: reachable, effective authority now">Now</);
  assert.match(p, /title="R5: ceiling">Ceiling</);
});

test('acceptance: the employee\'s level is never drawn as a rung, because it is on a different scale', () => {
  const p = panels(view(page(), REAL))[2];
  assert.match(p, /Your employee's current rung: none\. Its <code>autonomy_level<\/code> is <code>observe<\/code>, on the agent's own scale\. These are different scales/);
  assert.match(panels(view(page(), REAL))[0], /<code>observe<\/code> <small>on the agent's own scale[^<]*, not a ladder rung/);
});

test('acceptance: authority shows effectiveAuthority, not the record, and names no_tool_grants with the count it constrains, in words at zero', () => {
  const s = snap({ authority: [{ capability_id: 'platform.x', effective_autonomy: 'autonomy:R2', reasons: ['no_tool_grants'] }], authority_rule: { approved_above_r2: 1, binds_nothing: false } });
  const p = panels(view(page(), data([cap({ starting_autonomy: 'autonomy:R4' })]), false, s))[1];
  assert.match(p, /<td>R4<\/td><td>R5<\/td><td><strong>R2<\/strong><br><small>no_tool_grants<\/small>/);
  assert.match(p, /<code>no_tool_grants<\/code> rule constrains 1 capability today\./);
  const two = snap({ authority: ['a', 'b', 'c'].map((x, i) => ({ capability_id: `platform.${x}`, effective_autonomy: 'autonomy:R2', reasons: i < 2 ? ['no_tool_grants'] : [] })), authority_rule: { approved_above_r2: 3, binds_nothing: false } });
  assert.match(panels(view(page(), data([cap()]), false, two))[1], /rule constrains 2 capabilities today\./);
  const real = panels(view(page(), REAL))[1];
  assert.match(real, /<code>no_tool_grants<\/code> rule constrains 0 capabilities today\.<\/strong> 0 capabilities in this domain are approved above R2, and none is forced down to R2 by it\./);
  assert.equal(real.split('<strong>R0</strong>').length - 1, 48);
  assert.match(panels(view(page(), data([cap({ capability_id: 'platform.unknown' })])))[1], /Not available: the snapshot carries no answer for it/);
  assert.match(panels(view(page(), data([cap()]), false, null))[1], /Not available: \.colaberry\/agent-domain\.json could not be read/);
  assert.doesNotMatch(panels(view(page(), data([cap()]), false, snap({ authority_rule: undefined })))[1], /rule constrains/);
});

test('acceptance: nothing on the governance panel states or implies that filing a tool request granted anything', () => {
  const none = panels(view(page(), REAL))[4];
  assert.match(none, /Filing one grants nothing/);
  const s = snap({ governance: { ...SNAP.governance, requests: [
    { id: '1', kind: 'tool', title: 'Tool ask', status: 'pending', requested_at: '2026-10-31', approved_at: null, declined_reason: null },
    { id: '2', kind: 'change', title: 'Change ask', status: 'declined', requested_at: '2026-10-30', approved_at: null, declined_reason: 'not now' },
    { id: '3', title: 'Kindless ask', status: 'pending', requested_at: '2026-10-29', approved_at: null, declined_reason: null },
  ] } });
  const p = panels(view(page(), REAL, false, s))[4];
  assert.match(p, /^ready/);
  assert.match(p, /Filing one grants nothing/);
  assert.ok(p.indexOf('Change ask') < p.indexOf('<h3>Tool requests') && p.indexOf('Tool ask') > p.indexOf('<h3>Tool requests'));
  assert.doesNotMatch(p.replace('Filing one grants nothing', ''), /grant/i);
  assert.match(p, /Nobody yet/);
  assert.match(p, /not now/);
  assert.equal(p.split('Tool ask').length, 2);
  assert.ok(p.indexOf('Kindless ask') < p.indexOf('<h3>Tool requests'), 'a request with no kind is a change request');
  assert.equal(p.split('Kindless ask').length, 2);
});

test('acceptance: trust: no panel shows a number, grant or rung this domain has not produced', () => {
  const html = view(page(), REAL);
  assert.deepEqual([...new Set(REAL.capabilities.map((c: { requirement_validation_state: string }) => c.requirement_validation_state))], ['draft']);
  assert.match(html, /48 of 48 capabilities are draft/);
  assert.doesNotMatch(html, /\bapproved by\b/i);
  assert.equal((view(page(true), REAL)).includes('capability inventory'), false);
  assert.match(html, /Story verified, not authority/);
  assert.equal(panels(html)[1].split('Human decision</span>').length - 1, REAL.capabilities.filter((c: { human_decision: boolean }) => c.human_decision).length);
  assert.equal(panels(html)[1].match(/<tr>/g)!.length, 49);
  const emp = panels(html)[0];
  // Named on the portal on 2026-11-03; the unnamed case is still shown in words, never as a blank.
  assert.match(emp, /<td>agent_name<\/td><td>Ellis<\/td>/);
  assert.match(panels(view(page(), REAL, false, snap({ agent: { ...SNAP.agent, display_name: null } })))[0], /Not named on the platform yet <small>\(this repository calls it Ellis; naming it on the portal is pending/);
  assert.match(panels(view(page(), REAL, false, snap({ agent: { ...SNAP.agent, display_name: 'Named' } })))[0], /<td>agent_name<\/td><td>Named<\/td>/);
  assert.match(emp, /<td>enabled<\/td><td>No<\/td>/);
  assert.match(emp, /<td>Tools granted<\/td><td>0<\/td>/);
  assert.match(emp, /set automatically, not chosen by a person/);
  assert.match(emp, /Set by whom<\/td><td><span class="blank">Not available: The platform does not store who set/);
  assert.match(panels(html)[5], /agent\.autonomy_level_set_by<\/code> is not recorded by the platform/);
});

test('the snapshot\'s age is shown as when it last changed, and an unknown age is said', () => {
  assert.match(view(page(), REAL), /agent-domain\.json<\/code> last changed 2 November 2026/);
  assert.match(view(page(), REAL, false, SNAP, {}), /last changed is unknown/);
});

test('gaps name draft records and capabilities with no defined next rung', () => {
  const p = panels(view(page(), data([cap(), cap({ name: 'Empty one', release_behaviour: [], requirement_validation_state: 'confirmed' })])))[5];
  assert.match(p, /1 of 2 capabilities are draft/);
  assert.match(p, /No defined next rung:<\/strong> Empty one/);
  assert.match(p, /unreachable by fact/);
  assert.match(p, /promotionCriteria\.ts:46-51/);
  assert.match(panels(view(page(), REAL, false, null))[5], /The agent, its authority and its governance queue<\/strong> are unavailable/);
  assert.doesNotMatch(panels(view(page(), REAL))[5], /are unavailable/);
});

test('text from a record is escaped, and an email is hidden', () => {
  assert.doesNotMatch(view(page(), data([cap({ name: '<img src=x>' })])), /<img/);
  const s = snap({ governance: { requests: [{ id: '1', kind: 'change', title: 'ask someone@example.com', status: 's', requested_at: null, approved_at: null, declined_reason: null }] } });
  assert.doesNotMatch(view(page(), REAL, false, s), /someone@example/);
});

test('the capability file is complete, uses initials and carries only the fields the page renders', () => {
  assert.equal(REAL.capabilities.length, 48);
  assert.match(REAL.source.commit, /^[0-9a-f]{9}$/);
  const text = JSON.stringify(REAL);
  assert.doesNotMatch(text, /Kesetebirhan|Delele|@/);
  assert.deepEqual(Object.keys(REAL.capabilities[0]).sort(), ['capability_id', 'classification', 'human_decision', 'implementation_state', 'max_autonomy_rationale', 'max_permitted_autonomy', 'name', 'release_behaviour', 'requirement_validation_state', 'starting_autonomy']);
});
