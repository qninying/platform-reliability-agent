// platform.agent_behavior_safety_watch, first release behaviour (R2):
// answers "which agents acted outside their grants recently" from the activity log and grant
// records. Every finding names the specific grant that was missing; a finding with no named grant
// is not emitted. Read-only: stopping an agent stays a human decision.
//
// Why Ellis does the comparison itself (platform repo, commit c860274):
// - Neither platform watcher compares actions with grants. AgentBehaviorMonitorAgent looks for stuck
//   agents, error spikes and slow runs (backend/src/services/agents/security/agentBehaviorMonitorAgent.ts:32-90);
//   AISafetyMonitorAgent scans visitor chat for prompt injection (aiSafetyMonitorAgent.ts:55-80).
// - The grant records are AGENT_PERMISSIONS in agentPermissionService.ts:36-97 (pinned in
//   src/grants/agentGrants.ts). validateAgentWrite checks tier and table but never the operation
//   allowlist (agentPermissionService.ts:125-169), and only the workforce runtime calls it
//   (backend/src/services/workforce/workforceAgentRuntime.ts:160).
// - The autonomy-level gate records each verdict as an 'agent.authorization' ai_events row
//   (agentAuthorizationService.ts:261-281); 'level_forbids:<category>' names what the level lacks.
//
// Three sources, each checked against the grant that applies:
// - agent_write_audits rows: operation and table are both known.
// - activity rows that record a state change (before_state and after_state set): operation is known.
// - ai_events agent.authorization rows whose reason is level_forbids:<category>.

import type { AiAgentRow, ActivityLogRow } from '../records.ts';
import { grantFor, GRANTS_COMMIT, type Grant } from '../grants/agentGrants.ts';

export interface WriteAuditRow {
  id: string;
  agent_id: string;
  agent_name: string;
  operation: string;
  target_table: string;
  was_allowed: boolean;
  blocked_reason: string | null;
  created_at: string;
}

export interface AiEventRow {
  id: string;
  event_type: string;
  agent_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface BehaviorSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: AiAgentRow[];
  agent_write_audits: WriteAuditRow[];
  ai_agent_activity_logs: ActivityLogRow[];
  ai_events: AiEventRow[];
}

export interface MissingGrant {
  kind: 'tier' | 'table' | 'operation' | 'autonomy_level';
  name: string;
  held: string;
}

export interface Finding {
  agent_name: string;
  agent_id: string;
  action: string;
  missing_grant: MissingGrant;
  grant_source: 'agent_grant' | 'platform_default' | 'autonomy_gate';
  platform_verdict: 'allowed' | 'blocked' | 'shadow_would_deny' | 'not_checked';
  at: string;
  citation: { table: 'agent_write_audits' | 'ai_agent_activity_logs' | 'ai_events'; id: string };
}

export interface BehaviorReport {
  as_of: string;
  window_hours: number;
  grants_commit: string;
  findings: Finding[];
  unattributable: Array<{ source: string; row_id: string; agent_ref: string; reason: string }>;
  not_emitted: Array<{ source: string; row_id: string; reason: string }>;
  excluded_self: number;
  rows_examined: { write_audits: number; state_changes: number; authorization_events: number };
}

export const DEFAULT_WATCHERS = ['AgentBehaviorMonitorAgent', 'AISafetyMonitorAgent', 'Ellis'];

export interface WatchOptions {
  now: Date;
  windowHours?: number;
  watchers?: string[];
}

// The grants a write needs that the agent does not hold, each named.
export function missingGrants(grant: Grant, operation: string, table: string | null): MissingGrant[] {
  if (grant.tier === 'read_only') return [{ kind: 'tier', name: 'write access (any tier above read_only)', held: 'read_only' }];
  const out: MissingGrant[] = [];
  if (table !== null && !grant.tables.includes(table)) {
    out.push({ kind: 'table', name: table, held: grant.tables.join(', ') || 'none' });
  }
  if (!grant.operations.includes(operation)) {
    out.push({ kind: 'operation', name: operation, held: grant.operations.join(', ') || 'none' });
  }
  return out;
}

export function behaviorWatch(snap: BehaviorSnapshot, opts: WatchOptions): BehaviorReport {
  const windowHours = opts.windowHours ?? 24;
  const since = opts.now.getTime() - windowHours * 3_600_000;
  const watchers = new Set(opts.watchers ?? DEFAULT_WATCHERS);
  const inWindow = (at: string) => Date.parse(at) >= since && Date.parse(at) <= opts.now.getTime();
  const report: BehaviorReport = {
    as_of: opts.now.toISOString(), window_hours: windowHours, grants_commit: GRANTS_COMMIT,
    findings: [], unattributable: [], not_emitted: [], excluded_self: 0,
    rows_examined: { write_audits: 0, state_changes: 0, authorization_events: 0 },
  };
  const resolve = attribution(snap.ai_agents);

  for (const row of snap.agent_write_audits.filter((r) => inWindow(r.created_at))) {
    report.rows_examined.write_audits++;
    const agent = resolve(row.agent_id, row.agent_name);
    if (!take(report, watchers, agent, 'agent_write_audits', row.id, row.agent_name || row.agent_id)) continue;
    const { grant, explicit } = grantFor(agent!.agent_name);
    const verdict = row.was_allowed ? 'allowed' : 'blocked';
    emit(report, 'agent_write_audits', row.id, missingGrants(grant, row.operation, row.target_table), (g) => ({
      agent_name: agent!.agent_name, agent_id: agent!.id, action: `${row.operation} on ${row.target_table}`, missing_grant: g,
      grant_source: explicit ? 'agent_grant' : 'platform_default', platform_verdict: verdict, at: row.created_at,
      citation: { table: 'agent_write_audits', id: row.id },
    }));
  }

  for (const row of snap.ai_agent_activity_logs.filter((r) => inWindow(r.created_at) && isStateChange(r))) {
    report.rows_examined.state_changes++;
    const agent = resolve(row.agent_id, null);
    if (!take(report, watchers, agent, 'ai_agent_activity_logs', row.id, row.agent_id)) continue;
    const { grant, explicit } = grantFor(agent!.agent_name);
    emit(report, 'ai_agent_activity_logs', row.id, missingGrants(grant, row.action, null), (g) => ({
      agent_name: agent!.agent_name, agent_id: agent!.id, action: row.action, missing_grant: g,
      grant_source: explicit ? 'agent_grant' : 'platform_default', platform_verdict: 'not_checked', at: row.created_at,
      citation: { table: 'ai_agent_activity_logs', id: row.id },
    }));
  }

  for (const row of snap.ai_events.filter((r) => r.event_type === 'agent.authorization' && inWindow(r.created_at))) {
    report.rows_examined.authorization_events++;
    const meta = row.metadata ?? {};
    const name = typeof meta.agent_name === 'string' ? meta.agent_name : '';
    const agent = resolve(row.agent_id ?? '', name || null);
    if (!take(report, watchers, agent, 'ai_events', row.id, name || row.agent_id || '(none)')) continue;
    const reason = String(meta.reason ?? '');
    const missing: MissingGrant[] = reason.startsWith('level_forbids:')
      ? [{ kind: 'autonomy_level', name: `autonomy level permitting '${reason.slice('level_forbids:'.length)}' actions`, held: String(meta.level ?? 'unknown') }]
      : [];
    if (missing.length === 0) {
      report.not_emitted.push({ source: 'ai_events', row_id: row.id, reason: `verdict reason '${reason || 'none'}' does not name a missing grant` });
      continue;
    }
    report.findings.push({
      agent_name: agent!.agent_name, agent_id: agent!.id, action: String(meta.action ?? 'unknown action'), missing_grant: missing[0],
      grant_source: 'autonomy_gate', platform_verdict: meta.enforced === true ? 'blocked' : 'shadow_would_deny', at: row.created_at,
      citation: { table: 'ai_events', id: row.id },
    });
  }

  report.findings.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.citation.id < b.citation.id ? -1 : 1));
  return report;
}

function isStateChange(r: ActivityLogRow): boolean {
  return isObject(r.before_state) && isObject(r.after_state);
}

function isObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Finds the ai_agents row for a reference that may be an id or, as some callers pass, a name.
function attribution(agents: AiAgentRow[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const byName = new Map(agents.map((a) => [a.agent_name, a]));
  return (id: string, name: string | null): AiAgentRow | undefined => byId.get(id) ?? (name ? byName.get(name) : undefined) ?? byName.get(id);
}

// Returns false when the row must not become a finding: its agent cannot be attributed (reported,
// not dropped) or it is one of the watchers' own actions (excluded, so they never police themselves).
function take(report: BehaviorReport, watchers: Set<string>, agent: AiAgentRow | undefined, source: string, rowId: string, ref: string): boolean {
  if (!agent) {
    report.unattributable.push({ source, row_id: rowId, agent_ref: ref, reason: 'no ai_agents row matches this agent, so the action cannot be attributed' });
    return false;
  }
  if (watchers.has(agent.agent_name)) {
    report.excluded_self++;
    return false;
  }
  return true;
}

function emit(report: BehaviorReport, source: string, rowId: string, missing: MissingGrant[], build: (g: MissingGrant) => Finding): void {
  for (const g of missing) {
    if (!g.name) {
      report.not_emitted.push({ source, row_id: rowId, reason: 'the missing grant could not be named' });
      continue;
    }
    report.findings.push(build(g));
  }
}
