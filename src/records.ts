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
}

// backend/src/models/AiAgentActivityLog.ts:4 (result values), table 'ai_agent_activity_logs' (:119)
export type ActivityResult = 'success' | 'failed' | 'skipped' | 'pending';

export interface ActivityLogRow {
  id: string;
  agent_id: string;
  action: string;
  result: ActivityResult | null;
  created_at: string;
  details?: { actions?: Array<{ action?: string }>; errors?: string[] } | null;
}
