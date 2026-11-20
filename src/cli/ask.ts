// Usage: npm run ask -- "<question>"
// Asks Ellis a question in plain words. The model chooses which read-only checks to run and answers from their
// output. Settings come from the environment (or a git-ignored .env file, see .env.example):
//   ANTHROPIC_API_KEY      the API key (never logged, never passed to the checks)
//   ELLIS_MODEL            default claude-sonnet-5-5
//   ELLIS_PLATFORM_SOURCE  a read-only platform checkout; checks that need it answer "unavailable" without it
//   ELLIS_MAX_STEPS        model calls per question, default 8
// Writes a record of the run to .ellis/runs/. Exit code 0 when answered, 3 when it stopped without an answer
// (step limit, refusal, output cap), 1 for bad input or an API error.
import Anthropic from '@anthropic-ai/sdk';
import { askEllis } from '../agent/loop.ts';
import { writeRun } from '../agent/record.ts';
import { describe } from '../agent/errors.ts';

const question = process.argv.slice(2).join(' ').trim();
if (!question || question.length > 2000) {
  console.error(JSON.stringify({ error_class: 'ValidationError', message: 'ask one question of 1 to 2000 characters: npm run ask -- "is anything broken right now?"' }));
  process.exit(1);
}
// A blank setting in .env means "use the default", not zero.
const maxSteps = Number(process.env.ELLIS_MAX_STEPS || 8);
if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
  console.error(JSON.stringify({ error_class: 'ValidationError', message: 'ELLIS_MAX_STEPS must be a whole number from 1 to 20' }));
  process.exit(1);
}

const anthropic = new Anthropic({ timeout: 120_000, maxRetries: 2 });
const client = { create: (p: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => anthropic.beta.messages.create(p) };

try {
  const run = await askEllis(question, client, {
    model: process.env.ELLIS_MODEL || 'claude-sonnet-5-5',
    maxSteps,
    tools: { repoRoot: process.cwd(), platformSource: process.env.ELLIS_PLATFORM_SOURCE || null, timeoutMs: 60_000 },
  });
  const file = writeRun(run, '.ellis/runs');
  console.log(run.answer ?? `No answer: ${run.outcome}.`);
  console.log('\n---');
  for (const c of run.tool_calls) console.log(`${c.tool}: ${c.decision}${c.exit_code === null ? '' : ` (exit ${c.exit_code})`}, ${c.meaning}`);
  console.log(`model calls ${run.model_calls}, tokens in ${run.usage.input_tokens} (+${run.usage.cache_read_input_tokens} cached) out ${run.usage.output_tokens}, est. $${run.estimated_cost_usd ?? '?'}`);
  console.log(`record: ${file}`);
  process.exitCode = run.outcome === 'answered' ? 0 : 3;
} catch (err) {
  console.error(JSON.stringify(describe(err)));
  process.exit(1);
}
