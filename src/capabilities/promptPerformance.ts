// platform.prompt_and_performance_optimization, first release behaviour (R2):
// answers "which prompts cost the most, which are slowest, and which have open change proposals?" from
// recorded runs. Every cost or latency figure carries the ids of the runs it was computed from, and a prompt
// with no recorded runs reports unknown, never zero. Adopting a prompt change is a human decision at every
// autonomy level. Read-only.
//
// Platform behaviour this rests on (platform repo, commit 8c16250):
// - Each call through the instrumented client writes an ai_events row (event_type 'llm.call') with model,
//   tokens, cost_usd and duration_ms, and the prompt version in metadata.prompt_version
//   (services/openaiInstrumented.ts:57-97, services/aiEventService.ts:160-164).
// - A streamed call has no usage, so its cost is null (openaiInstrumented.ts:57-65); a failed call records no
//   cost either. Null cost is "not recorded", never zero.
// - The meta loop's own measurements (agent_performance_metrics) hold no cost at all, and its prompt proposals
//   live only in vector memory (intelligence/meta/promptOptimizationAgent.ts:109), so there is no proposal
//   record to read unless one is exported.

import type { Citation } from './orchestrationHealthWatch.ts';

export interface LlmCall {
  id: string;
  created_at: string;
  outcome: 'success' | 'failure';
  model: string | null;
  prompt_version: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
}

export interface KnownPrompt { prompt: string; source: string }

export interface Proposal {
  id: string;
  prompt: string;
  status: 'open' | 'adopted' | 'rejected';
  recorded_at: string;
  // The measurement the change is judged against. Without one, a change is a guess.
  before: { cost_per_run_usd: number | null; p95_ms: number | null; runs: number } | null;
}

export interface PromptSnapshot {
  captured_at: string;
  captured_by: string;
  window_days: number;
  prompts: KnownPrompt[];
  llm_calls: LlmCall[];
  // null when no proposal record exists or none was exported.
  proposals: Proposal[] | null;
}

export type FigureState = 'measured' | 'partial' | 'unknown';

export interface CostFigure { state: FigureState; total_usd: number | null; per_run_usd: number | null; costed_runs: number; uncosted_runs: number; run_ids: string[]; reason: string }
export interface LatencyFigure { state: FigureState; p50_ms: number | null; p95_ms: number | null; timed_runs: number; untimed_runs: number; run_ids: string[]; reason: string }

export interface PromptReport {
  prompt: string;
  source: string;
  runs: number;
  failures: number;
  cost: CostFigure;
  latency: LatencyFigure;
  open_proposals: Array<{ id: string; measured_before: boolean }> | null;
}

export interface PromptPerformanceReport {
  decided_by: 'a named human';
  window: { start: string; end: string };
  prompts: PromptReport[];
  most_costly: string[];
  slowest: string[];
  not_ranked: string[];
  coverage: { calls: number; tagged: number; untagged: number; untagged_cost_usd: number | null; excluded: number };
  proposals_state: 'recorded' | 'no_record';
  statement: string;
  citations: Citation[];
}

const DAY_MS = 86_400_000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Nearest-rank percentile over sorted values.
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function costOf(calls: LlmCall[]): CostFigure {
  const costed = calls.filter((c) => c.cost_usd !== null && Number.isFinite(c.cost_usd) && c.cost_usd >= 0);
  const uncosted = calls.length - costed.length;
  const run_ids = costed.map((c) => c.id).sort();
  if (calls.length === 0) return { state: 'unknown', total_usd: null, per_run_usd: null, costed_runs: 0, uncosted_runs: 0, run_ids, reason: 'no recorded runs in the window' };
  if (costed.length === 0) return { state: 'unknown', total_usd: null, per_run_usd: null, costed_runs: 0, uncosted_runs: uncosted, run_ids, reason: `none of ${calls.length} recorded run(s) carries a cost` };
  const total = round6(costed.reduce((s, c) => s + c.cost_usd!, 0));
  return {
    state: uncosted ? 'partial' : 'measured', total_usd: total, per_run_usd: round6(total / costed.length),
    costed_runs: costed.length, uncosted_runs: uncosted, run_ids,
    reason: uncosted ? `${uncosted} of ${calls.length} run(s) carry no cost (streamed or failed), so the total is a floor` : `from ${costed.length} costed run(s)`,
  };
}

function latencyOf(calls: LlmCall[]): LatencyFigure {
  const timed = calls.filter((c) => c.duration_ms !== null && Number.isFinite(c.duration_ms) && c.duration_ms >= 0);
  const untimed = calls.length - timed.length;
  const run_ids = timed.map((c) => c.id).sort();
  if (calls.length === 0) return { state: 'unknown', p50_ms: null, p95_ms: null, timed_runs: 0, untimed_runs: 0, run_ids, reason: 'no recorded runs in the window' };
  if (timed.length === 0) return { state: 'unknown', p50_ms: null, p95_ms: null, timed_runs: 0, untimed_runs: untimed, run_ids, reason: `none of ${calls.length} recorded run(s) carries a duration` };
  const sorted = timed.map((c) => c.duration_ms!).sort((a, b) => a - b);
  return {
    state: untimed ? 'partial' : 'measured', p50_ms: percentile(sorted, 0.5), p95_ms: percentile(sorted, 0.95),
    timed_runs: timed.length, untimed_runs: untimed, run_ids,
    reason: untimed ? `${untimed} of ${calls.length} run(s) carry no duration` : `from ${timed.length} timed run(s)`,
  };
}

export function assessPrompts(snap: PromptSnapshot): PromptPerformanceReport {
  const end = Date.parse(snap.captured_at);
  const start = end - snap.window_days * DAY_MS;
  const seen = new Set<string>();
  let excluded = 0;
  const calls: LlmCall[] = [];
  for (const c of [...snap.llm_calls].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const at = Date.parse(c.created_at);
    // Duplicates, unreadable times and runs outside the window (including the future) are not evidence.
    if (seen.has(c.id) || Number.isNaN(at) || at < start || at > end) { excluded++; continue; }
    seen.add(c.id);
    calls.push(c);
  }

  const known = new Map(snap.prompts.map((p) => [p.prompt, p.source]));
  for (const c of calls) if (c.prompt_version && !known.has(c.prompt_version)) known.set(c.prompt_version, 'found in recorded runs only');

  const prompts: PromptReport[] = [...known.keys()].sort().map((prompt) => {
    const mine = calls.filter((c) => c.prompt_version === prompt);
    const open = snap.proposals === null ? null
      : snap.proposals.filter((p) => p.prompt === prompt && p.status === 'open').sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => ({ id: p.id, measured_before: p.before !== null && p.before.runs > 0 }));
    return { prompt, source: known.get(prompt)!, runs: mine.length, failures: mine.filter((c) => c.outcome === 'failure').length, cost: costOf(mine), latency: latencyOf(mine), open_proposals: open };
  });

  const rank = (key: (p: PromptReport) => number | null) => prompts
    .filter((p) => key(p) !== null)
    .sort((a, b) => key(b)! - key(a)! || (a.prompt < b.prompt ? -1 : 1))
    .map((p) => p.prompt);
  const most_costly = rank((p) => p.cost.total_usd);
  const slowest = rank((p) => p.latency.p95_ms);
  const not_ranked = prompts.filter((p) => p.cost.state === 'unknown' && p.latency.state === 'unknown').map((p) => p.prompt);

  const untagged = calls.filter((c) => !c.prompt_version);
  const untaggedCosted = untagged.filter((c) => c.cost_usd !== null && Number.isFinite(c.cost_usd));
  const coverage = {
    calls: calls.length, tagged: calls.length - untagged.length, untagged: untagged.length,
    untagged_cost_usd: untaggedCosted.length ? round6(untaggedCosted.reduce((s, c) => s + c.cost_usd!, 0)) : null,
    excluded,
  };

  const parts = [
    most_costly.length ? `Most costly: ${most_costly[0]}${prompts.find((p) => p.prompt === most_costly[0])!.cost.state === 'partial' ? ' (a floor: some runs carry no cost)' : ''}.` : 'No prompt has a recorded cost.',
    slowest.length ? `Slowest at p95: ${slowest[0]}.` : '',
    not_ranked.length ? `${not_ranked.length} prompt(s) have no recorded runs and are unknown, not zero: ${not_ranked.join(', ')}.` : '',
    coverage.untagged ? `${coverage.untagged} of ${coverage.calls} recorded call(s) name no prompt, so their cost cannot be attributed.` : '',
    snap.proposals === null ? 'Open proposals are unknown: no proposal record exists.' : '',
  ].filter(Boolean);

  const used = calls.filter((c) => c.prompt_version && known.has(c.prompt_version));
  return {
    decided_by: 'a named human',
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    prompts, most_costly, slowest, not_ranked, coverage,
    proposals_state: snap.proposals === null ? 'no_record' : 'recorded',
    statement: parts.join(' '),
    citations: [
      ...used.map((c) => ({ table: 'ai_events' as const, id: c.id, fields: ['metadata.prompt_version', 'cost_usd', 'duration_ms', 'outcome'] })),
      ...(snap.proposals ?? []).filter((p) => known.has(p.prompt)).sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => ({ table: 'prompt_change_proposals' as const, id: p.id, fields: ['prompt', 'status', 'before'] })),
    ],
  };
}
