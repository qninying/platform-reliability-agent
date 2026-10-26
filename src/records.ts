// Row shapes Ellis reads from the platform. Mirrors the platform's Sequelize models at commit c99021d;
// only the columns Ellis reads are listed. Ellis never writes either table.

// backend/src/models/AiAgent.ts:204 (status values), :371-374 (agent_name is unique), table 'ai_agents' (:568)
export type AiAgentStatus = 'idle' | 'running' | 'paused' | 'error';

export interface AiAgentRow {
  id: string;
  agent_name: string;
  status: AiAgentStatus;
  enabled: boolean;
  schedule: string | null;
  last_run_at: string | null;
  updated_at: string | null;
  // Free text shown in the admin registry; some cleanup rows state their retention window here.
  description?: string | null;
}

// backend/src/models/AiAgentActivityLog.ts:4 (result values), table 'ai_agent_activity_logs' (:119)
export type ActivityResult = 'success' | 'failed' | 'skipped' | 'pending';

export interface ActivityLogRow {
  id: string;
  agent_id: string;
  action: string;
  result: ActivityResult | null;
  created_at: string;
  // Set when the row records a state change, e.g. a repair (logAgentActivity callers).
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  // runAgent stores the run's actions here (backend/src/services/aiOrchestrator.ts:247-251).
  details?: { actions?: Array<{ action?: string; result?: string; after_state?: Record<string, unknown> | null }>; errors?: string[] } | null;
}

// backend/src/models/DepartmentEvent.ts, table 'department_events' (:71). The security scanners
// store each scan here with metadata.agent set to their agent name.
export interface DepartmentEventRow {
  id: string;
  department_id: string;
  event_type: string;
  title: string;
  description?: string | null;
  severity?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}
