import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPrompts, type PromptSnapshot, type LlmCall } from '../src/capabilities/promptPerformance.ts';

// Prompt versions mirror the platform's instrumented call sites at 8c16250; runs are test inputs, not production data.
const call = (id: string, prompt: string | null, over: Partial<LlmCall> = {}): LlmCall => ({
  id, created_at: '2026-10-27T10:00:00Z', outcome: 'success', model: 'gpt-4o-mini', prompt_version: prompt, cost_usd: 0.002, duration_ms: 1000, ...over,
});

function snap(): PromptSnapshot {
  return {
    captured_at: '2026-10-27T12:00:00Z', captured_by: 'test', window_days: 7,
    prompts: [
      { prompt: 'maya-chat-v1', source: 'chatService.ts:32' },
      { prompt: 'strategy-brief-v1', source: 'strategyBriefService.ts:210' },
      { prompt: 'landing-page-name-v1', source: 'landingPageNameService.ts:82' },
    ],
    llm_calls: [
      call('e1', 'maya-chat-v1', { cost_usd: 0.001, duration_ms: 800 }),
      call('e2', 'maya-chat-v1', { cost_usd: 0.003, duration_ms: 1200 }),
      call('e3', 'strategy-brief-v1', { cost_usd: 0.05, duration_ms: 9000 }),
      call('e4', null, { cost_usd: 0.01 }),
    ],
    proposals: [],
  };
}
const find = (r: ReturnType<typeof assessPrompts>, p: string) => r.prompts.find((x) => x.prompt === p)!;

test('acceptance: every cost or latency figure traces to recorded runs; a prompt with no recorded runs reports unknown rather than zero', () => {
  const r = assessPrompts(snap());
  const maya = find(r, 'maya-chat-v1');
  assert.deepEqual([maya.cost.total_usd, maya.cost.per_run_usd, maya.cost.run_ids], [0.004, 0.002, ['e1', 'e2']]);
  assert.deepEqual([maya.latency.p50_ms, maya.latency.p95_ms, maya.latency.run_ids], [800, 1200, ['e1', 'e2']]);
  const none = find(r, 'landing-page-name-v1');
  assert.equal(none.runs, 0);
  assert.equal(none.cost.state, 'unknown');
  assert.equal(none.cost.total_usd, null);
  assert.equal(none.latency.p95_ms, null);
  assert.match(none.cost.reason, /no recorded runs/);
  assert.deepEqual(r.not_ranked, ['landing-page-name-v1']);
  assert.ok(!r.most_costly.includes('landing-page-name-v1'), 'an unmeasured prompt is never ranked as the cheapest');
  assert.match(r.statement, /landing-page-name-v1/);
  assert.match(r.statement, /unknown, not zero/);
  assert.deepEqual(r.citations.filter((c) => c.table === 'ai_events').map((c) => c.id), ['e1', 'e2', 'e3']);
});

test('ranks by total cost and by p95 latency', () => {
  const r = assessPrompts(snap());
  assert.deepEqual(r.most_costly, ['strategy-brief-v1', 'maya-chat-v1']);
  assert.deepEqual(r.slowest, ['strategy-brief-v1', 'maya-chat-v1']);
  assert.match(r.statement, /Most costly: strategy-brief-v1\. Slowest at p95: strategy-brief-v1\./);
});

test('runs with no recorded cost or duration make the figure partial, and all-uncosted runs are unknown, never zero', () => {
  const s = snap();
  s.llm_calls.push(call('e5', 'maya-chat-v1', { cost_usd: null, duration_ms: null }));
  const maya = find(assessPrompts(s), 'maya-chat-v1');
  assert.deepEqual([maya.cost.state, maya.cost.total_usd, maya.cost.uncosted_runs], ['partial', 0.004, 1]);
  assert.match(maya.cost.reason, /total is a floor/);
  assert.deepEqual([maya.latency.state, maya.latency.untimed_runs], ['partial', 1]);
  assert.deepEqual(maya.cost.run_ids, ['e1', 'e2'], 'a figure lists only the runs it was computed from');
  const neg = snap();
  neg.llm_calls = [call('n1', 'maya-chat-v1', { cost_usd: -1 })];
  assert.equal(find(assessPrompts(neg), 'maya-chat-v1').cost.state, 'unknown', 'a negative cost is not a measurement');
  const t = snap();
  t.llm_calls = [call('s1', 'maya-chat-v1', { cost_usd: null, duration_ms: null })];
  const only = find(assessPrompts(t), 'maya-chat-v1');
  assert.deepEqual([only.cost.state, only.cost.total_usd, only.latency.p95_ms], ['unknown', null, null]);
  assert.match(only.cost.reason, /none of 1 recorded run\(s\) carries a cost/);
});

test('a partial figure leading the cost ranking is called a floor', () => {
  const s = snap();
  s.llm_calls.push(call('e6', 'strategy-brief-v1', { cost_usd: null }));
  assert.match(assessPrompts(s).statement, /Most costly: strategy-brief-v1 \(a floor/);
});

test('a recorded zero cost is a measurement, not a missing one', () => {
  const s = snap();
  s.llm_calls = [call('z1', 'maya-chat-v1', { cost_usd: 0 })];
  const maya = find(assessPrompts(s), 'maya-chat-v1');
  assert.deepEqual([maya.cost.state, maya.cost.total_usd], ['measured', 0]);
});

test('duplicates, unreadable times and runs outside the window are excluded, and counted', () => {
  const s = snap();
  s.llm_calls.push(
    call('e1', 'maya-chat-v1', { cost_usd: 9 }),
    call('old', 'maya-chat-v1', { created_at: '2026-10-01T00:00:00Z' }),
    call('future', 'maya-chat-v1', { created_at: '2026-10-28T00:00:00Z' }),
    call('bad', 'maya-chat-v1', { created_at: 'yesterday' }),
  );
  const r = assessPrompts(s);
  assert.equal(r.coverage.excluded, 4);
  assert.equal(find(r, 'maya-chat-v1').cost.total_usd, 0.004);
});

test('calls that name no prompt are counted with their cost, and a prompt seen only in runs is reported', () => {
  const s = snap();
  s.llm_calls.push(call('e7', 'composer-draft-v1'));
  const r = assessPrompts(s);
  assert.deepEqual([r.coverage.calls, r.coverage.tagged, r.coverage.untagged, r.coverage.untagged_cost_usd], [5, 4, 1, 0.01]);
  assert.match(r.statement, /1 of 5 recorded call\(s\) name no prompt/);
  assert.equal(find(r, 'composer-draft-v1').source, 'found in recorded runs only');
});

test('failures are counted per prompt', () => {
  const s = snap();
  s.llm_calls.push(call('f1', 'maya-chat-v1', { outcome: 'failure', cost_usd: null }));
  assert.equal(find(assessPrompts(s), 'maya-chat-v1').failures, 1);
});

test('with no proposal record, open proposals are unknown; a proposal with no before-measurement is flagged', () => {
  const s = snap();
  s.proposals = null;
  const r = assessPrompts(s);
  assert.equal(r.proposals_state, 'no_record');
  assert.equal(find(r, 'maya-chat-v1').open_proposals, null);
  assert.match(r.statement, /Open proposals are unknown: no proposal record exists/);
  const t = snap();
  t.proposals = [
    { id: 'p2', prompt: 'maya-chat-v1', status: 'open', recorded_at: '2026-10-26T00:00:00Z', before: null },
    { id: 'p1', prompt: 'maya-chat-v1', status: 'open', recorded_at: '2026-10-26T00:00:00Z', before: { cost_per_run_usd: 0.002, p95_ms: 1200, runs: 2 } },
    { id: 'p3', prompt: 'maya-chat-v1', status: 'adopted', recorded_at: '2026-10-26T00:00:00Z', before: null },
    { id: 'p4', prompt: 'strategy-brief-v1', status: 'open', recorded_at: '2026-10-26T00:00:00Z', before: { cost_per_run_usd: null, p95_ms: null, runs: 0 } },
  ];
  const u = assessPrompts(t);
  assert.deepEqual(find(u, 'maya-chat-v1').open_proposals, [{ id: 'p1', measured_before: true }, { id: 'p2', measured_before: false }]);
  assert.deepEqual(find(u, 'strategy-brief-v1').open_proposals, [{ id: 'p4', measured_before: false }], 'a before-measurement over no runs is no measurement');
  assert.deepEqual(find(u, 'landing-page-name-v1').open_proposals, []);
  assert.deepEqual(u.citations.filter((c) => c.table === 'prompt_change_proposals').map((c) => c.id), ['p1', 'p2', 'p3', 'p4']);
});

test('the decision is a human one', () => {
  assert.equal(assessPrompts(snap()).decided_by, 'a named human');
});

test('idempotent: the same records in any order give the same report', () => {
  const s = snap();
  s.proposals = [{ id: 'p1', prompt: 'maya-chat-v1', status: 'open', recorded_at: '2026-10-26T00:00:00Z', before: null }];
  const reversed: PromptSnapshot = { ...s, prompts: [...s.prompts].reverse(), llm_calls: [...s.llm_calls].reverse(), proposals: [...s.proposals].reverse() };
  assert.deepEqual(assessPrompts(s), assessPrompts(reversed));
});
