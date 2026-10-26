// The platform's per-agent write grants, pinned from the platform repo at commit c860274.
// Source: backend/src/services/agentPermissionService.ts:36-97 (AGENT_PERMISSIONS) and :100-105
// (DEFAULT_PERMISSION, which applies to any agent not listed). Generated from that file; a copy can
// drift, so re-check it against the source when the platform changes.

export const GRANTS_COMMIT = 'c860274';

export type Tier = 'read_only' | 'suggest_only' | 'write_with_audit' | 'communication';

export interface Grant {
  tier: Tier;
  tables: string[];
  operations: string[];
}

export const DEFAULT_GRANT: Grant = { tier: 'suggest_only', tables: ['proposed_agent_actions'], operations: [] };

export const AGENT_GRANTS: Record<string, Grant> = {
  CampaignHealthScanner: { tier: 'read_only', tables: [], operations: [] },
  OrchestrationHealthAgent: { tier: 'read_only', tables: [], operations: [] },
  StudentProgressMonitor: { tier: 'read_only', tables: [], operations: [] },
  PromptMonitorAgent: { tier: 'read_only', tables: [], operations: [] },
  ApolloLeadIntelligenceAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteUIVisibilityAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteBrokenLinkAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteConversionFlowAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteUXHeuristicAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteBehaviorAgent: { tier: 'read_only', tables: [], operations: [] },
  WebsiteImprovementStrategist: { tier: 'read_only', tables: [], operations: [] },
  ContentOptimizationAgent: { tier: 'suggest_only', tables: ['proposed_agent_actions'], operations: ['propose_content_rewrite'] },
  ConversationOptimizationAgent: { tier: 'suggest_only', tables: ['proposed_agent_actions'], operations: ['propose_instruction_enhancement'] },
  CampaignRepairAgent: { tier: 'write_with_audit', tables: ['scheduled_emails', 'campaign_errors'], operations: ['retry_failed_send', 'detect_stalled_campaign', 'auto_resolve_errors'] },
  CampaignSelfHealingAgent: { tier: 'write_with_audit', tables: ['scheduled_emails'], operations: ['retry_failed_email', 'post_repair_retest'] },
  CampaignQAAgent: { tier: 'write_with_audit', tables: ['campaign_test_runs', 'campaign_test_steps'], operations: ['run_qa_test'] },
  OrchestrationAutoRepairAgent: { tier: 'write_with_audit', tables: ['prompt_templates', 'mini_sections', 'artifact_definitions'], operations: ['reactivate_prompt', 'null_broken_fk', 'null_broken_artifact_fk'] },
  WebsiteAutoRepairAgent: { tier: 'write_with_audit', tables: ['website_issues'], operations: ['auto_repair'] },
  ExecutionAgent: { tier: 'write_with_audit', tables: ['ai_agents', 'intelligence_decisions'], operations: ['update_agent_config', 'modify_agent_schedule', 'update_campaign_config', 'adjust_lead_scoring', 'launch_ab_test', 'pause_campaign'] },
  CurriculumArchitectAgent: { tier: 'write_with_audit', tables: ['tickets', 'ticket_activities'], operations: ['ticket_dispatch'] },
  ArtifactGenerationAgent: { tier: 'write_with_audit', tables: ['tickets', 'ticket_activities'], operations: ['ticket_dispatch'] },
  CurriculumQAAgent: { tier: 'write_with_audit', tables: ['tickets', 'ticket_activities'], operations: ['ticket_dispatch'] },
  PlatformFixAgent: { tier: 'write_with_audit', tables: ['tickets', 'ticket_activities'], operations: ['ticket_dispatch'] },
  AdmissionsSMSAgent: { tier: 'communication', tables: ['admissions_action_logs', 'communication_logs'], operations: ['send_sms'] },
  AdmissionsSynthflowCallAgent: { tier: 'communication', tables: ['call_contact_logs', 'admissions_action_logs', 'communication_logs'], operations: ['synthflow_call'] },
  AdmissionsEmailAgent: { tier: 'communication', tables: ['admissions_action_logs', 'communication_logs'], operations: ['send_email'] },
  WorkforceStudentSuccessDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_student_success'] },
  WorkforceCurriculumDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_curriculum'] },
  WorkforceCareerDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_career'] },
  WorkforceCertificationDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_certification'] },
  WorkforceFinanceDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_finance'] },
  WorkforceOperationsDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_operations'] },
  WorkforceCommunityDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_community'] },
  WorkforceTechnologyDirector: { tier: 'write_with_audit', tables: ['workforce_tasks'], operations: ['flag_agent_health_issue'] },
  WorkforceResearchDirector: { tier: 'write_with_audit', tables: ['workforce_messages'], operations: ['surface_insight'] },
  WorkforceMarketingDirector: { tier: 'suggest_only', tables: ['proposed_agent_actions'], operations: ['propose_content_idea'] },
};

// The grant that applies to an agent, and whether it is the agent's own or the platform default.
export function grantFor(agentName: string): { grant: Grant; explicit: boolean } {
  const own = AGENT_GRANTS[agentName];
  return own ? { grant: own, explicit: true } : { grant: DEFAULT_GRANT, explicit: false };
}
