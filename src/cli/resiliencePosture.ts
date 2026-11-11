// Usage: node src/cli/resiliencePosture.ts --snapshot <resilience.json> [--now <ISO time>]
// Prints the resilience posture: each subsystem's state and the age of its last signal. Reads only.
// --now defaults to the snapshot's captured_at. Exit code 0 when healthy, 3 when any subsystem is
// unknown, 4 when degraded with no unknowns, 1 for bad input.
// --health-full <export.json> adds the platform's own probes (an export of GET /health/full) and what they cannot
// see. With it, an unknown or partly unknown probe also gives 3, and a probe problem gives 4 when nothing is unknown.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resiliencePosture, type ResilienceSnapshot } from '../capabilities/systemResilienceSupervision.ts';
import { probeHealth, type HealthFullExport } from '../capabilities/platformHealthProbe.ts';

const { values } = parseArgs({ options: { snapshot: { type: 'string' }, now: { type: 'string' }, 'health-full': { type: 'string' } } });

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function load(path: string): ResilienceSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  let s: Partial<ResilienceSnapshot>;
  try {
    s = JSON.parse(text);
  } catch (err) {
    throw new InputError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string') throw new InputError('ContractViolation', `${path} needs captured_at`);
  for (const t of ['ai_agents', 'department_reports'] as const) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty)`);
  }
  if (s.circuit_status === undefined) throw new InputError('ContractViolation', `${path} needs circuit_status (use null when no export was taken)`);
  if (s.circuit_status !== null && (typeof s.circuit_status.captured_at !== 'string' || !Array.isArray(s.circuit_status.statuses))) {
    throw new InputError('ContractViolation', `${path} circuit_status needs captured_at and statuses[]`);
  }
  return s as ResilienceSnapshot;
}

function loadHealth(path: string): HealthFullExport {
  let e: Partial<HealthFullExport>;
  try {
    e = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('SourceUnavailable', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof e.captured_at !== 'string' || e.report === undefined) throw new InputError('ContractViolation', `${path} needs captured_at and report (use null when the call failed)`);
  if (e.report !== null && (typeof e.report.timestamp !== 'string' || !Array.isArray(e.report.checks))) throw new InputError('ContractViolation', `${path} report needs timestamp and checks[]`);
  return e as HealthFullExport;
}

try {
  if (!values.snapshot) throw new InputError('ContractViolation', 'missing --snapshot <resilience.json>');
  const snap = load(values.snapshot);
  const now = values.now ?? snap.captured_at;
  if (!Number.isFinite(Date.parse(now))) throw new InputError('ContractViolation', `--now '${now}' is not a readable time`);
  const report = resiliencePosture(snap, { now });
  const probes = values['health-full'] ? probeHealth(loadHealth(values['health-full']), now) : null;
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, now, ...report, ...(probes ? { platform_probes: probes } : {}) }, null, 2));
  const unknown = report.verdict === 'unknown' || (probes !== null && (probes.verdict === 'unknown' || probes.verdict === 'partly_unknown'));
  const problem = report.verdict === 'degraded' || probes?.verdict === 'problem';
  process.exitCode = unknown ? 3 : problem ? 4 : 0;
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
