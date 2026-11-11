// Usage: node src/cli/reliabilityReport.ts --source <platform checkout> [--snapshot <health.json>] [--drift-log <log copy>] [--produced-at <ISO date>] [--json]
// Produces the reliability briefing on request, as text a person can read with no login, or as JSON. Composes the
// answers of capabilities already built; the unmeasured section comes first and no percentage appears without its
// record count. Reads only, and sends nothing. Exit code 0 when records were read, 4 when the briefing was produced
// without records, so its run figures are unknown, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { reliabilityBriefing, renderBriefing, type Records } from '../capabilities/reliabilityReport.ts';
import { measure, reconcileAnswer } from '../capabilities/registryReconciliation.ts';
import { agentHealth, type ScoreSnapshot } from '../capabilities/agentHealthScoring.ts';
import { cronHealth, type HealthSnapshot } from '../capabilities/cronHealthAlerting.ts';
import { schemaDriftAnswer } from '../capabilities/schemaDriftDetection.ts';
import { backupPosition } from '../capabilities/backupRestoreVerification.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, snapshot: { type: 'string' }, 'drift-log': { type: 'string' }, 'produced-at': { type: 'string' }, json: { type: 'boolean', default: false } } });

function text(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read: ${(err as Error).message}`);
  }
}

function records(path: string): Records {
  let s: Partial<HealthSnapshot>;
  try {
    s = JSON.parse(text(path));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'timers', 'timer_scope'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  const rows = s.ai_agents as unknown as ScoreSnapshot['ai_agents'];
  if (!rows.every((a) => Number.isInteger(a.run_count) && Number.isInteger(a.error_count))) throw new InputError('ContractViolation', `${path} needs run_count and error_count as whole numbers on every agent`);
  return {
    captured_at: s.captured_at,
    totals: { rows: rows.length, runs: rows.reduce((n, a) => n + a.run_count, 0), failures: rows.reduce((n, a) => n + a.error_count, 0) },
    agents: agentHealth(s as unknown as ScoreSnapshot),
    cron: cronHealth(s as HealthSnapshot),
  };
}

try {
  const source = requireCheckout(values.source);
  const producedAt = values['produced-at'] ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(producedAt))) throw new InputError('ContractViolation', '--produced-at needs a date');
  const r = reader(source);
  const commit = commitOf(source);
  const answer = reliabilityBriefing({
    produced_at: producedAt,
    recon: reconcileAnswer(measure(r, new Date(producedAt), commit)),
    drift: schemaDriftAnswer(r, values['drift-log'] === undefined ? null : text(values['drift-log']), producedAt, { max_age_hours: 26, source_commit: commit }),
    backup: backupPosition(r, commit),
    records: values.snapshot === undefined ? null : records(values.snapshot),
  });
  console.log(values.json ? JSON.stringify(answer, null, 2) : renderBriefing(answer));
  process.exitCode = answer.records_captured_at === null ? 4 : 0;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
