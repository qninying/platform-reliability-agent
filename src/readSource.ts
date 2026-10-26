import { readFileSync } from 'node:fs';
import type { ActivityLogRow, AiAgentRow } from './records.ts';

// Read-only access to platform records. There is deliberately no write method: a capability that
// is handed a ReadSource has no way to change the platform.
export interface ReadSource {
  // Returns every ai_agents row with this exact agent_name. The platform makes agent_name unique,
  // so more than one row is a contract violation the caller must report, not resolve.
  findAgentsByName(agentName: string): AiAgentRow[];
  // Activity rows for one agent id, newest first, at most `limit` rows.
  recentActivity(agentId: string, limit: number): ActivityLogRow[];
}

// A dated export of the two tables, as a person with admin access would pull them from
// GET /api/admin/ai-ops/registry and GET /api/admin/ai-ops/activity?agent_id=...
export interface Snapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: AiAgentRow[];
  ai_agent_activity_logs: ActivityLogRow[];
}

export class SnapshotSourceError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: 'SourceUnavailable' | 'ContractViolation', message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

export function loadSnapshot(path: string): Snapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SnapshotSourceError('SourceUnavailable', `snapshot ${path} could not be read: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SnapshotSourceError('ContractViolation', `snapshot ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const s = parsed as Partial<Snapshot>;
  if (typeof s.captured_at !== 'string' || !Array.isArray(s.ai_agents) || !Array.isArray(s.ai_agent_activity_logs)) {
    throw new SnapshotSourceError('ContractViolation', `snapshot ${path} needs captured_at, ai_agents[] and ai_agent_activity_logs[]`);
  }
  return s as Snapshot;
}

export function snapshotSource(snapshot: Snapshot): ReadSource {
  return {
    findAgentsByName: (agentName) => snapshot.ai_agents.filter((a) => a.agent_name === agentName),
    recentActivity: (agentId, limit) =>
      snapshot.ai_agent_activity_logs
        .filter((r) => r.agent_id === agentId)
        .sort(newestFirst)
        .slice(0, limit),
  };
}

// Newest first; ties broken by id so the same input always gives the same order.
export function newestFirst(a: ActivityLogRow, b: ActivityLogRow): number {
  const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
  return byTime !== 0 ? byTime : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}
