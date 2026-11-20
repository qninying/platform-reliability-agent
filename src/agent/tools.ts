// The agent's tools. Each one is an existing read-only check, run as its own command over a FIXED input: the model
// chooses which check to run and, for the incident trace only, what to look up, but never which file a check reads.
// A check that needs the platform checkout and has none configured answers "unavailable", never a guess.
//
// Failure modes handled: a check that exits 1 (bad input), a check that times out, output that is not JSON, output
// too long to send back (cut, and marked). Not handled here: a check that hangs past its timeout is killed by Node.
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface ToolContext {
  repoRoot: string;
  platformSource: string | null;
  timeoutMs: number;
}

export interface ToolResult {
  ok: boolean;
  exit_code: number | null;
  meaning: string;
  output: unknown;
  truncated: boolean;
  duration_ms: number;
}

type Input = Record<string, unknown>;

interface Check {
  name: string;
  description: string;
  script: string;
  source: 'required' | 'optional' | 'none';
  exits: Record<number, string>;
  args(ctx: ToolContext, input: Input): string[];
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  validate?(input: Input): string | null;
}

const NO_INPUT = { type: 'object' as const, properties: {}, additionalProperties: false as const };
const ex = (file: string) => join('examples', file);
const src = (ctx: ToolContext) => (ctx.platformSource ? ['--source', ctx.platformSource] : []);
export const MAX_OUTPUT_CHARS = 12_000;

const SELECTORS = ['trace', 'activity', 'error', 'job'] as const;

export const CHECKS: readonly Check[] = [
  {
    name: 'scheduler_liveness',
    description: 'Whether any scheduled timer registers at all: the flag gating the scheduler, its only caller, and whether the public health probe can notice zero timers. Reads the platform source.',
    script: 'src/cli/schedulerLiveness.ts', source: 'required', input_schema: NO_INPUT,
    exits: { 0: 'probe can detect zero timers and no boot fell short', 3: 'probe cannot detect zero timers, or a boot registered fewer timers than the code', 5: 'the gate or caller is not the single one expected' },
    args: (ctx) => src(ctx),
  },
  {
    name: 'cron_health',
    description: 'Which cron jobs the health check would alert on now (error spike or missed runs), which it evaluates only in part, and which it cannot evaluate at all.',
    script: 'src/cli/cronHealth.ts', source: 'optional', input_schema: NO_INPUT,
    exits: { 0: 'no job alerts and every job is fully evaluated', 4: 'at least one job alerts', 3: 'none alerts, but some jobs are evaluated in part or not at all' },
    args: (ctx) => ['--snapshot', ex('cron-health.example.json'), ...src(ctx)],
  },
  {
    name: 'agent_health',
    description: 'Each agent\'s health score as the registry computes it, worst first; a score resting on zero runs is labelled unscored, not 100.',
    script: 'src/cli/agentHealth.ts', source: 'optional', input_schema: NO_INPUT,
    exits: { 0: 'every agent is scored', 4: 'an agent has failures on record behind no score', 3: 'an agent is unscored or has no row' },
    args: (ctx) => ['--snapshot', ex('cron-health.example.json'), ...src(ctx)],
  },
  {
    name: 'incident_trace',
    description: 'The trace behind one failure and its probable cause, in the run\'s own words. Give exactly one of: trace, activity, error (ids) or job (an agent or job name, for its latest failure).',
    script: 'src/cli/incidentTrace.ts', source: 'none',
    input_schema: { type: 'object', properties: Object.fromEntries(SELECTORS.map((k) => [k, { type: 'string', maxLength: 120 }])), additionalProperties: false },
    exits: { 0: 'traced', 3: 'not traceable', 4: 'nothing found, or no failure recorded' },
    validate: (input) => {
      const given = SELECTORS.filter((k) => input[k] !== undefined);
      if (given.length !== 1) return `give exactly one of ${SELECTORS.join(', ')}; got ${given.length}`;
      const v = input[given[0]];
      if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,120}$/.test(v)) return `${given[0]} must be 1 to 120 letters, digits or _ . : -`;
      return null;
    },
    args: (_ctx, input) => {
      const k = SELECTORS.find((s) => input[s] !== undefined)!;
      return ['--snapshot', ex('incident-trace.example.json'), `--${k}`, String(input[k])];
    },
  },
  {
    name: 'dead_letter_triage',
    description: 'Both dead-letter stores as one queue grouped by error class, a proposal per entry, and what could never reach the queue. An empty queue is not a clean bill of health.',
    script: 'src/cli/deadLetterTriage.ts', source: 'required', input_schema: NO_INPUT,
    exits: { 0: 'entries are open', 4: 'the queue is empty (not proof of health)' },
    args: (ctx) => [...src(ctx), '--snapshot', ex('dead-letter-triage.example.json')],
  },
  {
    name: 'error_class_coverage',
    description: 'What share of recorded failures carry a real error class, and every catch site on the cron path that records none.',
    script: 'src/cli/errorClassCoverage.ts', source: 'required', input_schema: NO_INPUT,
    exits: { 0: 'every recorded failure is classified', 3: 'some failures are unclassified', 4: 'none recorded, so coverage is unknown' },
    args: (ctx) => [...src(ctx), '--snapshot', ex('error-class-coverage.example.json')],
  },
  {
    name: 'deploy_readiness',
    description: 'Whether the platform checkout is clean and matches origin/main, asking the remote directly. Never fetches, merges, pushes or deploys.',
    script: 'src/cli/deployReadiness.ts', source: 'required', input_schema: NO_INPUT,
    exits: { 0: 'ready', 3: 'not ready', 4: 'the remote could not be read' },
    args: (ctx) => ['--checkout', ctx.platformSource!],
  },
  {
    name: 'schema_drift',
    description: 'Known schema drift from the latest drift-job run, and the axes nothing measures. No completed run means unknown, never "no drift".',
    script: 'src/cli/schemaDrift.ts', source: 'required', input_schema: NO_INPUT,
    exits: { 0: 'the latest fresh run reported no drift', 3: 'drift reported', 4: 'unknown: no fresh completed run' },
    args: (ctx) => [...src(ctx), '--log', ex('schema-drift.example.log')],
  },
];

export function toolDefinitions() {
  // Inputs are validated here (gate.ts), not by the API, so the schemas stay simple.
  return CHECKS.map((c) => ({ name: c.name, description: c.description, input_schema: c.input_schema }));
}

// Keeps every field, so a statement or a "cannot say" list at the end is never lost, and shortens long lists to
// their first `keep` items plus a count of the rest.
export function shorten(value: unknown, keep: number): { value: unknown; shortened: boolean } {
  let shortened = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      if (v.length <= keep) return v.map(walk);
      shortened = true;
      return [...v.slice(0, keep).map(walk), { omitted: v.length - keep, total: v.length }];
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), shortened };
}

// Tries ever shorter lists until the output fits; only then is the text cut.
export function fit(output: unknown): { output: unknown; truncated: boolean } {
  for (const keep of [Infinity, 10, 5, 3, 1]) {
    const { value, shortened } = shorten(output, keep);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= MAX_OUTPUT_CHARS) return { output: value, truncated: shortened };
  }
  const text = typeof output === 'string' ? output : JSON.stringify(shorten(output, 1).value);
  return { output: text.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

function parse(stdout: string): { output: unknown; truncated: boolean } {
  let output: unknown;
  try { output = JSON.parse(stdout); } catch { output = stdout; }
  return fit(output);
}

// Runs one check. The child gets no Anthropic credentials: the checks never need them.
export function runCheck(check: Check, ctx: ToolContext, input: Input): Promise<ToolResult> {
  const started = Date.now();
  if (check.source === 'required' && !ctx.platformSource) {
    return Promise.resolve({ ok: false, exit_code: null, meaning: 'unavailable: no platform checkout configured (set ELLIS_PLATFORM_SOURCE)', output: null, truncated: false, duration_ms: 0 });
  }
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve) => {
    execFile(process.execPath, [check.script, ...check.args(ctx, input)], { cwd: ctx.repoRoot, timeout: ctx.timeoutMs, maxBuffer: 64 * 1024 * 1024, env }, (err, stdout, stderr) => {
      const duration_ms = Date.now() - started;
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
      if (e?.killed) return resolve({ ok: false, exit_code: null, meaning: `timed out after ${ctx.timeoutMs} ms`, output: null, truncated: false, duration_ms });
      const exit_code = e ? (typeof e.code === 'number' ? e.code : null) : 0;
      if (exit_code === null || exit_code === 1) {
        return resolve({ ok: false, exit_code, meaning: `the check could not run: ${(stderr || e?.message || '').trim().slice(0, 500)}`, output: null, truncated: false, duration_ms });
      }
      const { output, truncated } = parse(stdout);
      resolve({ ok: true, exit_code, meaning: check.exits[exit_code] ?? `exit ${exit_code} (no meaning recorded for this code)`, output, truncated, duration_ms });
    });
  });
}
