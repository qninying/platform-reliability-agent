import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// The page's scripts are plain browser files, so they run here in a context with the same globals.
type Dom = { getElementById: () => null };
function page(sample = false) {
  const win: Record<string, any> = {};
  const ctx = createContext({ window: win, document: { getElementById: () => null } as Dom, localStorage: { getItem: () => (sample ? 'sample' : null), setItem: () => {} } });
  for (const f of ['ui', 'domainData', 'domainTab']) {
    if (f === 'ui') win.CC = {};
    runInContext(readFileSync(`command-center/${f}.js`, 'utf8'), ctx);
  }
  return win.CC;
}
const REAL = JSON.parse(readFileSync('command-center/domain.json', 'utf8'));
const progress = { stories: [{ id: 'platform.CAP.dead_letter_triage', verification: { state: 'verified' } }] };
const cap = (o: Record<string, unknown> = {}) => ({ capability_id: 'platform.x', name: 'X cap', classification: 'inherited', implementation_state: 'absent', requirement_validation_state: 'draft', starting_autonomy: 'autonomy:R0', max_permitted_autonomy: 'autonomy:R5', max_autonomy_rationale: 'the reason on record', human_decision: false, release_behaviour: [{ autonomy: 'autonomy:R2', behaviour: 'answers it', acceptance_criteria: 'cites rows' }], ...o });
const data = (capabilities: unknown[]) => ({ source: { file: 'capabilities/platform.json', commit: 'abc123def' }, capabilities });
const view = (cc: any, domain: unknown, loading = false) => cc.domainTab.view({ progress, domain, domainLoading: loading }) as string;
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
  const html = view(page(), REAL);
  const six = panels(html);
  assert.equal(six.length, 6);
  for (const p of six) assert.match(p, ENDPOINT);
  assert.match(six[0], /agent-domains-mine/);
  assert.match(six[1], /agent-domains\/platform and \/coverage/);
  assert.match(six[4], /agent-domain-change-requests-mine/);
});

test('acceptance: a panel with nothing says so in words and differs from one still loading', () => {
  const cc = page();
  const nothing = panels(view(cc, REAL))[0];
  assert.match(nothing, /^nothing/);
  assert.match(nothing, /Nothing returned/);
  assert.match(nothing, /returned nothing here/);
  const loading = panels(view(cc, null, true));
  assert.equal(loading.length, 6);
  for (const p of loading) { assert.match(p, /^loading/); assert.match(p, /Still fetching/); assert.doesNotMatch(p, /Nothing returned/); }
  const missing = panels(view(cc, null, false));
  for (const p of missing) { assert.match(p, /^nothing/); assert.doesNotMatch(p, /Still fetching/); }
  assert.match(panels(view(cc, data([])))[1], /^nothing/);
});

test('acceptance: all ten rungs are present in the owner\'s words, with each ceiling marked where it stops', () => {
  const cc = page();
  const p = panels(view(cc, data([cap()])))[2];
  assert.equal(cc.domain.RUNGS.length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(cc.domain.RUNGS)).map((r: string[]) => r[1]), OWNER_WORDS);
  for (const [rung, words] of cc.domain.RUNGS) { assert.ok(p.includes(`<strong>${rung.replace('autonomy:', '')}</strong> ${words}`), rung); }
  assert.deepEqual(JSON.parse(JSON.stringify(cc.domain.rungStates(cap()))).map((s: { state: string }) => s.state), ['reachable', 'reachable', 'reachable', 'reachable', 'reachable', 'ceiling', 'unreachable', 'unreachable', 'by_fact', 'unreachable']);
  assert.match(p, /Why it stops at R5: the reason on record/);
  assert.match(p, /Unreachable by fact/);
});

test('acceptance: above R2 with no grants the page shows effectiveAuthority and no_tool_grants, not what the record asks for', () => {
  const p = panels(view(page(), data([cap()])))[1];
  assert.match(p, /<td>R5<\/td><td><strong>R2<\/strong><br><small>no_tool_grants<\/small>/);
});

test('effectiveAuthority keeps every rule of the platform function it copies', () => {
  const { effectiveAuthority: e } = page().domain;
  const base = { capability_id: 'c', approved_autonomy: 'autonomy:R4', max_permitted_autonomy: 'autonomy:R5', granted_tools: ['t'], environment: 'sandbox', human_decision: false };
  const run = (o: object) => { const r = e({ ...base, ...o }); return JSON.parse(JSON.stringify([r.effective_autonomy, ...r.reasons])); };
  assert.deepEqual(run({}), ['autonomy:R4']);
  assert.deepEqual(run({ approved_autonomy: null }), [null, 'no_approved_autonomy']);
  assert.deepEqual(run({ max_permitted_autonomy: 'autonomy:R3' }), ['autonomy:R3', 'capped_by_max_permitted']);
  assert.deepEqual(run({ granted_tools: [] }), ['autonomy:R2', 'no_tool_grants']);
  assert.deepEqual(run({ approved_autonomy: 'autonomy:R2', granted_tools: [] }), ['autonomy:R2']);
  assert.deepEqual(run({ approved_autonomy: 'autonomy:R3', granted_tools: [] }), ['autonomy:R2', 'no_tool_grants']);
  assert.deepEqual(run({ approved_autonomy: 'autonomy:R6', max_permitted_autonomy: 'autonomy:R7', environment: 'production' }), ['autonomy:R6', 'production_requires_separate_pilot_approval']);
  assert.deepEqual(run({ approved_autonomy: 'autonomy:R5', max_permitted_autonomy: 'autonomy:R5', environment: 'production' }), ['autonomy:R5']);
  assert.deepEqual(run({ human_decision: true }), ['autonomy:R4', 'human_decision_required_at_every_level']);
  assert.deepEqual(run({ approved_autonomy: 'autonomy:R7', max_permitted_autonomy: 'autonomy:R7', human_decision: true }), ['autonomy:R5', 'human_decision_required_at_every_level', 'capped_below_automation_because_human_decision']);
});

test('acceptance: nothing on the governance panel states or implies that filing a tool request granted anything', () => {
  const cc = page();
  const none = panels(view(cc, REAL))[4];
  assert.match(none, /Filing one grants nothing/);
  cc.domainTab.held.requests = { change_requests: [
    { kind: 'tool', title: 'Tool ask', status: 'pending', requested_by_identity: 'me', requested_at: '2026-10-31', approved_by_identity: null, approved_at: null },
    { kind: 'change', title: 'Change ask', status: 'approved', requested_by_identity: 'me', requested_at: '2026-10-30', approved_by_identity: 'K.D.', approved_at: '2026-10-31' },
  ] };
  const p = panels(view(cc, REAL))[4];
  assert.match(p, /^ready/);
  assert.match(p, /Filing one grants nothing/);
  assert.ok(p.indexOf('Change ask') < p.indexOf('<h3>Tool requests') && p.indexOf('Tool ask') > p.indexOf('<h3>Tool requests'));
  assert.doesNotMatch(p.replace('Filing one grants nothing', ''), /grant/i);
  assert.match(p, /Nobody yet/);
  assert.equal(p.split('Tool ask').length, 2);
  assert.equal(p.split('Change ask').length, 2);
});

test('acceptance: trust: no panel shows a number, grant or rung this domain has not produced', () => {
  const html = view(page(), REAL);
  assert.deepEqual([...new Set(REAL.capabilities.map((c: { requirement_validation_state: string }) => c.requirement_validation_state))], ['draft']);
  assert.match(html, /48 of 48 capabilities are draft/);
  assert.doesNotMatch(html, /\bapproved by\b/i);
  assert.match(html, /Your employee's current rung: <span class="blank">Not available/);
  assert.equal((view(page(true), REAL)).includes('capability inventory'), false);
  assert.match(html, /Story verified, not authority/);
  assert.equal(panels(html)[1].split('Human decision</span>').length - 1, REAL.capabilities.filter((c: { human_decision: boolean }) => c.human_decision).length);
  assert.equal(panels(html)[1].match(/<tr>/g)!.length, 49);
});

test('an agent the response omits is said in words; fields the endpoint lacks stay blank', () => {
  const cc = page();
  cc.domainTab.held.mine = { resolved_identities: 1, domains: [{ domain_key: 'other', agent_id: 'x' }] };
  assert.match(panels(view(cc, REAL))[0], /No agent appears for this domain/);
  cc.domainTab.held.mine = { resolved_identities: 1, domains: [{ domain_key: 'platform', agent_id: 'a1', agent_display_name: 'Ellis' }] };
  const p = panels(view(cc, REAL))[0];
  assert.match(p, /^ready/);
  assert.match(p, /Ellis/);
  assert.equal(p.match(/Not available: this endpoint does not return it/g)!.length, 4);
});

test('gaps name draft records and capabilities with no defined next rung', () => {
  const p = panels(view(page(), data([cap(), cap({ name: 'Empty one', release_behaviour: [], requirement_validation_state: 'confirmed' })])))[5];
  assert.match(p, /1 of 2 capabilities are draft/);
  assert.match(p, /No defined next rung:<\/strong> Empty one/);
  assert.match(p, /unreachable by fact/);
  assert.match(p, /promotionCriteria\.ts:46-51/);
});

test('a loaded response is recognised by shape; anything else is refused', () => {
  const { classify } = page().domain;
  assert.equal(classify({ domains: [], resolved_identities: 0 }), 'mine');
  assert.equal(classify({ change_requests: [] }), 'requests');
  for (const bad of [null, 7, {}, { domains: [] }]) assert.equal(classify(bad), null);
});

test('text from a record is escaped, and an email in a loaded response is hidden', () => {
  const cc = page();
  assert.doesNotMatch(view(cc, data([cap({ name: '<img src=x>' })])), /<img/);
  cc.domainTab.held.requests = { change_requests: [{ kind: 'change', title: 't', status: 's', requested_by_identity: 'someone@example.com' }] };
  assert.doesNotMatch(view(cc, REAL), /someone@example/);
});

test('the snapshot is complete, uses initials and carries only the fields the page renders', () => {
  assert.equal(REAL.capabilities.length, 48);
  assert.match(REAL.source.commit, /^[0-9a-f]{9}$/);
  const text = JSON.stringify(REAL);
  assert.doesNotMatch(text, /Kesetebirhan|Delele|@/);
  assert.deepEqual(Object.keys(REAL.capabilities[0]).sort(), ['capability_id', 'classification', 'human_decision', 'implementation_state', 'max_autonomy_rationale', 'max_permitted_autonomy', 'name', 'release_behaviour', 'requirement_validation_state', 'starting_autonomy']);
});
