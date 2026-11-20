// The record of one agent run: every tool call with its exit code, every approval request, the tokens used and
// an estimated cost. Written to .ellis/runs/ (git-ignored) so a run can be checked after the fact.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApprovalRequest } from './gate.ts';

export interface ToolCallRecord { step: number; tool: string; input: unknown; decision: 'ran' | 'approval' | 'refused'; exit_code: number | null; meaning: string; duration_ms: number }
export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export interface AgentRun {
  question: string;
  model: string;
  outcome: 'answered' | 'step_limit' | 'refused' | 'max_tokens';
  answer: string | null;
  model_calls: number;
  tool_calls: ToolCallRecord[];
  approvals_requested: ApprovalRequest[];
  usage: Usage;
  estimated_cost_usd: number | null;
  started_at: string;
  finished_at: string;
  data_note: string;
}

// US dollars per million tokens. An unknown model has no estimate rather than a wrong one.
const PRICES: Record<string, { input: number; output: number; cache_read: number; cache_write: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
};

export function estimateCost(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const usd = (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cache_read + u.cache_creation_input_tokens * p.cache_write) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

export function addUsage(total: Usage, u: { [K in keyof Usage]?: number | null } | null | undefined): Usage {
  return {
    input_tokens: total.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: total.output_tokens + (u?.output_tokens ?? 0),
    cache_read_input_tokens: total.cache_read_input_tokens + (u?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: total.cache_creation_input_tokens + (u?.cache_creation_input_tokens ?? 0),
  };
}

export const ZERO_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

export function writeRun(run: AgentRun, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${run.started_at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  return file;
}
