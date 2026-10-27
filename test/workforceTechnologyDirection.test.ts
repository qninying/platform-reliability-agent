import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessDirection, type DirectionSnapshot, type Direction, type RegistryAgent, type Rule } from '../src/capabilities/workforceTechnologyDirection.ts';

// Agent names and tiers mirror the platform's registry and grant map at 7c70f0a; the direction is a test input.
const agent = (name: string, tools: string[] | null, over: Partial<RegistryAgent> = {}): RegistryAgent => ({ id: `row-${name}`, agent_name: name, enabled: true, tools_granted: tools, ...over });
const direction = (rules: Rule[], over: Partial<Direction> = {}): Direction => ({ id: 'dir-1', written_by: 'K.D.', approved_by: 'K.D.', approved_at: '2026-10-20T00:00:00Z', rules, ...over });

function snap(dir: Direction | null = null): DirectionSnapshot {
  return {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test',
    direction: dir,
    ai_agents: [
      agent('StrategyArchitectAgent', ['evaluate_department_health', 'llm_strategy_analysis']),
      agent('WorkforceTechnologyDirector', ['flag_agent_health_issue']),
      agent('OpenclawBrowserWorker', ['post_reply']),
    ],
    grant_map: [
      { agent_name: 'WorkforceTechnologyDirector', tier: 'write_with_audit', allowed_tables: ['workforce_tasks'], allowed_operations: ['flag_agent_health_issue'] },
      { agent_name: 'OpenclawBrowserWorker', tier: 'communication', allowed_tables: [], allowed_operations: [] },
    ],
    model_uses: [{ model: 'gpt-4o-mini', ref: 'costEstimationService.ts:24' }, { model: 'gpt-4o', ref: 'x.ts:1' }],
  };
}
const ALLOW_ALL_TOOLS: Rule = { kind: 'allowed_tools', tools: ['evaluate_department_health', 'llm_strategy_analysis', 'flag_agent_health_issue', 'post_reply'] };

test("acceptance: with no written direction on file, the answer is 'unknown', not 'no divergence'", () => {
  const r = assessDirection(snap(null));
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.direction.state, 'none');
  assert.match(r.statement, /unknown, not "no divergence"/);
  assert.ok(r.agents.every((a) => a.state === 'not_assessed' && a.divergences.length === 0));
  assert.equal(r.agents.length, 3, 'the tooling inventory is still reported');
  for (const d of [direction([ALLOW_ALL_TOOLS], { approved_by: null }), direction([ALLOW_ALL_TOOLS], { approved_at: 'not a date' }), direction([])]) {
    assert.equal(assessDirection(snap(d)).verdict, 'unknown');
  }
  assert.equal(assessDirection(snap(direction([]))).direction.state, 'empty');
});

test('acceptance: divergence is reported against a written intended direction', () => {
  const r = assessDirection(snap(direction([{ kind: 'denied_tools', tools: ['post_reply'] }])));
  assert.equal(r.verdict, 'divergent');
  assert.equal(r.direction.state, 'on_file');
  const d = r.agents.find((a) => a.agent_name === 'OpenclawBrowserWorker')!;
  assert.equal(d.state, 'diverges');
  assert.match(d.divergences[0].detail, /rules out: post_reply/);
  assert.match(r.statement, /Against direction dir-1, approved by K.D.: 1 agent\(s\) diverge/);
  assert.equal(r.agents.find((a) => a.agent_name === 'StrategyArchitectAgent')!.state, 'within');
});

test('a tool outside the allowed set is named', () => {
  const r = assessDirection(snap(direction([{ kind: 'allowed_tools', tools: ['flag_agent_health_issue', 'post_reply'] }])));
  assert.match(r.agents.find((a) => a.agent_name === 'StrategyArchitectAgent')!.divergences[0].detail, /outside the intended set: evaluate_department_health, llm_strategy_analysis/);
});

test('a tier above the intended maximum diverges, and an unlisted agent is judged on the default grant', () => {
  const r = assessDirection(snap(direction([{ kind: 'max_tier', tier: 'suggest_only' }])));
  const names = r.agents.filter((a) => a.state === 'diverges').map((a) => a.agent_name);
  assert.deepEqual(names, ['OpenclawBrowserWorker', 'WorkforceTechnologyDirector']);
  const s = r.agents.find((a) => a.agent_name === 'StrategyArchitectAgent')!;
  assert.equal(s.tier_source, 'default');
  assert.equal(s.state, 'within');
  const tight = assessDirection(snap(direction([{ kind: 'max_tier', tier: 'read_only' }])));
  assert.match(tight.agents.find((a) => a.agent_name === 'StrategyArchitectAgent')!.divergences[0].detail, /default for an unlisted agent/);
});

test('an agent with no tool record, or the column default [], is not recorded and keeps the answer unknown', () => {
  const s = snap(direction([ALLOW_ALL_TOOLS]));
  s.ai_agents.push(agent('NeverFilledIn', []), agent('NullTools', null));
  const r = assessDirection(s);
  assert.deepEqual(r.agents.filter((a) => a.state === 'not_recorded').map((a) => a.agent_name), ['NeverFilledIn', 'NullTools']);
  assert.equal(r.verdict, 'unknown');
  assert.match(r.statement, /2 agent\(s\) have no tool record/);
  assert.equal(r.coverage.tools_recorded, 3);
});

test('no divergence is reachable when every agent is recorded and within the direction', () => {
  const r = assessDirection(snap(direction([ALLOW_ALL_TOOLS, { kind: 'max_tier', tier: 'communication' }])));
  assert.equal(r.verdict, 'no_divergence');
  assert.ok(r.agents.every((a) => a.state === 'within'));
});

test('a model outside the direction is an escalation for a human, and missing model use is unknown', () => {
  const r = assessDirection(snap(direction([{ kind: 'allowed_models', models: ['gpt-4o-mini'] }])));
  assert.equal(r.verdict, 'divergent');
  assert.equal(r.fleet.divergences[0].escalation, true);
  assert.match(r.escalations[0], /gpt-4o\. A model class change is an escalation under CLAUDE\.md for a named human, never a director action/);
  const s = snap(direction([{ kind: 'allowed_models', models: ['gpt-4o-mini', 'gpt-4o'] }]));
  s.model_uses = null;
  const u = assessDirection(s);
  assert.equal(u.verdict, 'unknown');
  assert.match(u.statement, /model use has no export/);
});

test('a direction dated after the snapshot is not trusted', () => {
  const r = assessDirection(snap(direction([ALLOW_ALL_TOOLS], { approved_at: '2026-11-01T00:00:00Z' })));
  assert.equal(r.direction.state, 'unapproved');
  assert.equal(r.verdict, 'unknown');
});

test('disabled agents are left out of the fleet', () => {
  const s = snap(direction([{ kind: 'denied_tools', tools: ['post_reply'] }]));
  s.ai_agents[2] = agent('OpenclawBrowserWorker', ['post_reply'], { enabled: false });
  const r = assessDirection(s);
  assert.equal(r.coverage.enabled_agents, 2);
  assert.equal(r.verdict, 'no_divergence');
});

test('the decision is always a human one, and the report cites what it read', () => {
  const r = assessDirection(snap(direction([ALLOW_ALL_TOOLS])));
  assert.equal(r.decided_by, 'a named human');
  assert.deepEqual(r.citations.map((c) => c.table), ['technology_direction', 'ai_agents', 'ai_agents', 'ai_agents', 'grant_map', 'model_usage_export']);
  assert.deepEqual(assessDirection(snap(null)).citations.map((c) => c.table)[0], 'ai_agents');
});

test('idempotent: the same records in any order give the same report', () => {
  const s = snap(direction([{ kind: 'denied_tools', tools: ['post_reply'] }, { kind: 'max_tier', tier: 'write_with_audit' }]));
  const reversed: DirectionSnapshot = { ...s, ai_agents: [...s.ai_agents].reverse(), grant_map: [...s.grant_map].reverse(), model_uses: [...s.model_uses!].reverse() };
  assert.deepEqual(assessDirection(s), assessDirection(reversed));
  assert.deepEqual(assessDirection(s).agents.map((a) => a.agent_name), ['OpenclawBrowserWorker', 'StrategyArchitectAgent', 'WorkforceTechnologyDirector']);
});
