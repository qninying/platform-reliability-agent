// Runs one monitor on one dated export and returns its output in the shared shape, ready to record for a shadow
// run. Only monitors whose R5 rung is on the board are here, starting with the two whose exports exist as
// examples today; the others are added as their exports arrive. Reads the export only.

import { readFileSync } from 'node:fs';
import { cronHealth, type HealthSnapshot } from '../capabilities/cronHealthAlerting.ts';
import { watchOrchestrationHealth } from '../capabilities/orchestrationHealthWatch.ts';
import { loadSnapshot, snapshotSource } from '../readSource.ts';
import { cronHealthOutput, orchestrationOutput } from '../output/monitorAdapters.ts';
import { ContractViolation, type SeverityTable, type ToolOutput } from '../output/toolOutput.ts';

export type MonitorName = 'cron_health' | 'orchestration_health';
export const MONITORS: ReadonlyArray<MonitorName> = ['cron_health', 'orchestration_health'];

export class SourceUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'SourceUnavailable'; }
}

function readJson(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SourceUnavailable(`${path} could not be read: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new ContractViolation(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

function loadCronSnapshot(path: string): HealthSnapshot {
  const s = readJson(path);
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new ContractViolation(`${path} needs captured_at as a date`);
  for (const t of ['ai_agents', 'ai_agent_activity_logs', 'timers', 'timer_scope']) {
    if (!Array.isArray(s[t])) throw new ContractViolation(`${path} needs ${t}[] (use [] when empty)`);
  }
  return s as unknown as HealthSnapshot;
}

export function recordMonitor(monitor: string, snapshotPath: string, table: SeverityTable): ToolOutput<unknown> {
  if (monitor === 'cron_health') {
    const snap = loadCronSnapshot(snapshotPath);
    return cronHealthOutput(cronHealth(snap), { captured_at: snap.captured_at, captured_by: snap.captured_by }, table);
  }
  if (monitor === 'orchestration_health') {
    const snap = loadSnapshot(snapshotPath);
    const answer = watchOrchestrationHealth(snapshotSource(snap), { now: new Date(snap.captured_at) });
    return orchestrationOutput(answer, { captured_at: snap.captured_at, captured_by: snap.captured_by }, table);
  }
  throw new ContractViolation(`no recorder for monitor ${JSON.stringify(monitor)}; known: ${MONITORS.join(', ')}`);
}
