// The guardrail between the model and the checks (the "Guardrails + Human Approval" box in K.D.'s diagram).
// Every tool call the model makes passes through here. Three outcomes, nothing else:
// - a check on the approved read-only list, with valid input: it runs;
// - request_human_approval: recorded as pending and NOT carried out; Ellis has no tool that changes anything;
// - anything else (an unknown tool, bad input): refused, and the refusal goes back to the model as an error.
import { CHECKS, runCheck, type ToolContext, type ToolResult } from './tools.ts';

export const APPROVAL_TOOL = {
  name: 'request_human_approval',
  description: 'Propose an action a person must decide on (for example: restart a job, disable an agent, fix a record). This never carries the action out; it is recorded as pending human approval. Use it for every change you would recommend.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', maxLength: 300, description: 'What should be done, in one sentence.' },
      reason: { type: 'string', maxLength: 600, description: 'Why, citing the tool output that supports it.' },
    },
    required: ['action', 'reason'],
    additionalProperties: false as const,
  },
};

export interface ApprovalRequest { action: string; reason: string; status: 'pending_human_approval'; executed: false }

export type GateDecision =
  | { kind: 'ran'; tool: string; result: ToolResult }
  | { kind: 'approval'; tool: string; request: ApprovalRequest }
  | { kind: 'refused'; tool: string; reason: string };

export async function decide(name: string, input: unknown, ctx: ToolContext): Promise<GateDecision> {
  const args = (input && typeof input === 'object' && !Array.isArray(input) ? input : null) as Record<string, unknown> | null;
  if (!args) return { kind: 'refused', tool: name, reason: 'tool input must be an object' };

  if (name === APPROVAL_TOOL.name) {
    const { action, reason } = args;
    if (typeof action !== 'string' || !action.trim() || typeof reason !== 'string' || !reason.trim()) {
      return { kind: 'refused', tool: name, reason: 'action and reason are both required' };
    }
    return { kind: 'approval', tool: name, request: { action: action.slice(0, 300), reason: reason.slice(0, 600), status: 'pending_human_approval', executed: false } };
  }

  const check = CHECKS.find((c) => c.name === name);
  if (!check) return { kind: 'refused', tool: name, reason: `${name} is not on the approved read-only list` };
  const allowed = Object.keys(check.input_schema.properties);
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) return { kind: 'refused', tool: name, reason: `unexpected input: ${extra.join(', ')}` };
  const invalid = check.validate?.(args) ?? null;
  if (invalid) return { kind: 'refused', tool: name, reason: invalid };
  return { kind: 'ran', tool: name, result: await runCheck(check, ctx, args) };
}

// What the model is shown for each decision.
export function toModel(d: GateDecision): { content: string; is_error: boolean } {
  if (d.kind === 'refused') return { content: `REFUSED by the guardrail: ${d.reason}`, is_error: true };
  if (d.kind === 'approval') return { content: JSON.stringify({ status: d.request.status, executed: false, note: 'Recorded for a person to decide. Nothing was changed.' }), is_error: false };
  const r = d.result;
  return { content: JSON.stringify({ exit_code: r.exit_code, meaning: r.meaning, truncated: r.truncated, output: r.output }), is_error: !r.ok };
}
