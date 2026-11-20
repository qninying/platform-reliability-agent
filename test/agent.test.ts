import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askEllis, SYSTEM_PROMPT, type ModelClient } from '../src/agent/loop.ts';
import { fit, MAX_OUTPUT_CHARS, CHECKS } from '../src/agent/tools.ts';
import { estimateCost } from '../src/agent/record.ts';

// A scripted model: each call returns the next reply and records the request it was sent. No network, no cost.
type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
function fakeModel(replies: Array<{ stop: string; content: Block[] }>) {
  const requests: any[] = [];
  const client: ModelClient = {
    async create(params) {
      requests.push(structuredClone(params));
      const r = replies[Math.min(requests.length - 1, replies.length - 1)];
      return { id: `m${requests.length}`, type: 'message', role: 'assistant', model: params.model, content: r.content, stop_reason: r.stop, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: null } } as any;
    },
  };
  return { client, requests };
}
const use = (id: string, name: string, input: unknown = {}): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
const opts = (maxSteps = 8) => ({ model: 'claude-sonnet-5-5', maxSteps, tools: { repoRoot: process.cwd(), platformSource: null, timeoutMs: 30_000 }, now: () => new Date('2026-11-20T12:00:00Z') });
const lastResults = (req: any) => req.messages.at(-1).content as any[];

test('the model calls a real check, reads its exit code and answers', async () => {
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('t1', 'cron_health')] }, { stop: 'end_turn', content: [say('Answer: no job alerts.')] }]);
  const run = await askEllis('is anything broken?', client, opts());
  assert.equal(run.outcome, 'answered');
  assert.equal(run.answer, 'Answer: no job alerts.');
  assert.deepEqual(run.tool_calls.map((c) => [c.tool, c.decision, c.exit_code]), [['cron_health', 'ran', 3]]);
  const [result] = lastResults(requests[1]);
  assert.equal(result.tool_use_id, 't1');
  assert.equal(result.is_error, false);
  assert.equal(JSON.parse(result.content).exit_code, 3, 'the check really ran on the example snapshot');
  assert.deepEqual(run.usage, { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
  assert.equal(run.estimated_cost_usd, 0.0081);
});

test('independent checks run together and their results go back in one message', async () => {
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('a', 'cron_health'), use('b', 'agent_health')] }, { stop: 'end_turn', content: [say('done')] }]);
  await askEllis('health?', client, opts());
  assert.deepEqual(lastResults(requests[1]).map((r) => r.tool_use_id), ['a', 'b']);
});

test('a tool that is not on the approved list is refused and nothing runs', async () => {
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('x', 'restart_agent', { agent: 'MetaAgentLoop' })] }, { stop: 'end_turn', content: [say('cannot')] }]);
  const run = await askEllis('restart it', client, opts());
  assert.equal(run.tool_calls[0].decision, 'refused');
  const [result] = lastResults(requests[1]);
  assert.equal(result.is_error, true);
  assert.match(result.content, /not on the approved read-only list/);
});

test('a proposed change is recorded for a person and never carried out', async () => {
  const proposal = { action: 'Re-enable MetaAgentLoop', reason: 'agent_health exit 3: unscored' };
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('p', 'request_human_approval', proposal)] }, { stop: 'end_turn', content: [say('Needs a human: re-enable it')] }]);
  const run = await askEllis('fix it', client, opts());
  assert.deepEqual(run.approvals_requested, [{ ...proposal, status: 'pending_human_approval', executed: false }]);
  assert.equal(JSON.parse(lastResults(requests[1])[0].content).executed, false);
});

test('the incident trace takes exactly one safe selector; anything else is refused before it runs', async () => {
  const bad = [{ job: 'A', trace: 'B' }, {}, { job: 'x; rm -rf /' }, { job: 'A', path: '/etc/passwd' }];
  const { client } = fakeModel([{ stop: 'tool_use', content: bad.map((b, i) => use(`i${i}`, 'incident_trace', b)) }, { stop: 'end_turn', content: [say('ok')] }]);
  const run = await askEllis('why did it fail?', client, opts());
  assert.deepEqual(run.tool_calls.map((c) => c.decision), ['refused', 'refused', 'refused', 'refused']);
});

test('a check that needs the platform checkout says unavailable when none is configured, never a verdict', async () => {
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('s', 'schema_drift')] }, { stop: 'end_turn', content: [say('unknown')] }]);
  const run = await askEllis('safe to deploy?', client, opts());
  assert.equal(run.tool_calls[0].exit_code, null);
  assert.match(run.tool_calls[0].meaning, /^unavailable/);
  assert.equal(lastResults(requests[1])[0].is_error, true);
});

test('the step limit stops a model that never stops calling tools', async () => {
  const { client } = fakeModel([{ stop: 'tool_use', content: [use('t', 'incident_trace', { job: 'MetaAgentLoop' })] }]);
  const run = await askEllis('loop', client, opts(3));
  assert.equal(run.outcome, 'step_limit');
  assert.equal(run.model_calls, 3);
  assert.equal(run.answer, null);
});

test('an answer written before a tool call is kept, not replaced by the closing note', async () => {
  const { client } = fakeModel([
    { stop: 'tool_use', content: [say('Answer: not safe to deploy. Evidence: deploy_readiness exit 3.'), use('p', 'request_human_approval', { action: 'Hold the deploy', reason: 'exit 3' })] },
    { stop: 'end_turn', content: [say('I recorded the hold request.')] },
  ]);
  const run = await askEllis('safe to deploy?', client, opts());
  assert.equal(run.answer, 'Answer: not safe to deploy. Evidence: deploy_readiness exit 3.\n\nI recorded the hold request.');
});

test('a refusal ends the run as refused, not as an answer', async () => {
  const { client } = fakeModel([{ stop: 'refusal', content: [] }]);
  const run = await askEllis('q', client, opts());
  assert.equal(run.outcome, 'refused');
});

test('every request carries the rules, the same tool list in the same order, caching, effort and the refusal fallback', async () => {
  const { client, requests } = fakeModel([{ stop: 'tool_use', content: [use('t', 'cron_health')] }, { stop: 'end_turn', content: [say('x')] }]);
  await askEllis('q', client, opts());
  const names = requests.map((r) => r.tools.map((t: { name: string }) => t.name));
  assert.deepEqual(names[0], [...CHECKS.map((c) => c.name), 'request_human_approval']);
  assert.deepEqual(names[0], names[1], 'a stable tool list keeps the prompt cache valid');
  for (const r of requests) {
    assert.equal(r.system, SYSTEM_PROMPT);
    assert.deepEqual([r.cache_control, r.output_config, r.fallbacks], [{ type: 'ephemeral' }, { effort: 'medium' }, 'default']);
  }
  assert.match(SYSTEM_PROMPT, /never "healthy"/);
  assert.match(SYSTEM_PROMPT, /not live production data/);
});

test('a long check output keeps its closing fields and stays valid JSON', () => {
  const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ id: i, note: 'x'.repeat(40) })), statement: 'the summary at the end' };
  const { output, truncated } = fit(big);
  assert.equal(truncated, true);
  assert.equal((output as { statement: string }).statement, 'the summary at the end');
  assert.ok(JSON.stringify(output).length <= MAX_OUTPUT_CHARS);
  assert.deepEqual(fit({ a: 1 }), { output: { a: 1 }, truncated: false });
});

test('cost is estimated only for a model with a known price', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(estimateCost('claude-sonnet-5-5', u), 3);
  assert.equal(estimateCost('some-other-model', u), null);
});
