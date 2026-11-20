// The agent loop: the model reads the question, chooses checks, reads their answers and replies. Every tool call
// passes the guardrail (gate.ts). The loop stops at the first of: an answer, a refusal, the output cap, or the step
// limit. It never retries a model call itself; the SDK client does (capped), and the caller sets its timeout.
import type Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, type ToolContext } from './tools.ts';
import { APPROVAL_TOOL, decide, toModel } from './gate.ts';
import { addUsage, estimateCost, ZERO_USAGE, type AgentRun, type ToolCallRecord } from './record.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;

// The one seam to the model, so tests use a fake and spend nothing.
export interface ModelClient { create(params: Params): Promise<Message> }

// Progress as it happens, for a live view. Optional; a listener that throws does not stop the run.
export type AgentEvent =
  | { type: 'thinking'; model_call: number }
  | { type: 'tool_started'; model_call: number; tool: string; input: unknown }
  | { type: 'tool_finished'; call: ToolCallRecord };

export interface AgentOptions { model: string; maxSteps: number; tools: ToolContext; now?: () => Date; onEvent?: (e: AgentEvent) => void }

export const SYSTEM_PROMPT = `You are Ellis, the platform reliability agent for the Colaberry platform.
You answer operators' questions about platform health using ONLY the read-only checks given to you as tools.

How to work:
- Choose the checks that answer the question. Run several at once when they are independent.
- Base every statement on tool output. Name the check and its exit meaning for each claim, and quote the names, ids or rows it reported.
- Missing or unavailable input means "unknown", never "healthy". An empty queue or zero failures is not proof of health.
- Each check reads a saved example snapshot (see its captured_at and captured_by), not live production data. Say so once in your answer.
- You cannot change anything. If something should be done, call request_human_approval with the action and the evidence. Never claim an action was taken.
- If no check can answer the question, say so plainly instead of guessing.

Answer in plain words, short, under these headings: Answer, Evidence, Blind spots, Needs a human (write "nothing" when empty).
Record any approval requests first, then write the full answer as your final message.`;

const DATA_NOTE = 'Checks read the example snapshots in examples/ and, when configured, a read-only platform checkout. Not live production data.';

export async function askEllis(question: string, client: ModelClient, opts: AgentOptions): Promise<AgentRun> {
  const now = opts.now ?? (() => new Date());
  const started_at = now().toISOString();
  const messages: MessageParam[] = [{ role: 'user', content: question }];
  const tool_calls: ToolCallRecord[] = [];
  const approvals_requested: AgentRun['approvals_requested'] = [];
  let usage = ZERO_USAGE;
  let model_calls = 0;
  const written: string[] = [];
  const emit = (e: AgentEvent) => {
    try { opts.onEvent?.(e); } catch (err) { console.error(JSON.stringify({ event: 'agent_listener_failed', error_class: (err as Error).name, message: (err as Error).message })); }
  };

  const finish = (outcome: AgentRun['outcome'], answer: string | null): AgentRun => ({
    question, model: opts.model, outcome, answer, model_calls, tool_calls, approvals_requested, usage,
    estimated_cost_usd: estimateCost(opts.model, usage), started_at, finished_at: now().toISOString(), data_note: DATA_NOTE,
  });

  while (model_calls < opts.maxSteps) {
    emit({ type: 'thinking', model_call: model_calls + 1 });
    const response = await client.create({
      model: opts.model,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      tools: [...toolDefinitions(), APPROVAL_TOOL],
      messages,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    model_calls += 1;
    usage = addUsage(usage, response.usage);
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    // The model may write its answer and then record an approval request, so the answer is everything it wrote
    // in the run, not only its last message (found on the first live run, 20 Nov).
    if (text) written.push(text);
    const answer = written.join('\n\n') || null;

    if (response.stop_reason === 'refusal') return finish('refused', answer);
    if (response.stop_reason === 'max_tokens') return finish('max_tokens', answer);
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') return finish('answered', answer ?? '');

    const uses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    const step = model_calls;
    const done = await Promise.all(uses.map(async (u) => {
      emit({ type: 'tool_started', model_call: step, tool: u.name, input: u.input });
      const d = await decide(u.name, u.input, opts.tools);
      const r = d.kind === 'ran' ? d.result : null;
      const call: ToolCallRecord = { step, tool: d.tool, input: u.input, decision: d.kind, exit_code: r?.exit_code ?? null, meaning: r?.meaning ?? (d.kind === 'refused' ? d.reason : 'recorded, not carried out'), duration_ms: r?.duration_ms ?? 0 };
      emit({ type: 'tool_finished', call });
      return { d, call };
    }));
    const results: ToolResultBlock[] = done.map(({ d, call }, i) => {
      tool_calls.push(call);
      if (d.kind === 'approval') approvals_requested.push(d.request);
      const { content, is_error } = toModel(d);
      return { type: 'tool_result', tool_use_id: uses[i].id, content, is_error };
    });
    // All results go back in ONE user message, so the model keeps making independent calls in parallel.
    messages.push({ role: 'user', content: results });
  }
  return finish('step_limit', null);
}
