// platform.capability_autonomy_authority_resolution, first release behaviour (R2):
// answers what a capability's effective authority is today and which constraint is binding, from recorded approvals
// and grants. Absence of approval is not a low approval: it resolves to null, never a defaulted rung. Read-only, and
// R2 is the ceiling: an agent that could raise its own approved level would make the ladder decorative.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - effectiveAuthority takes one capability and never consults another
//   (backend/src/services/agentDomain/autonomyLadder.ts:185-223). This is a copy of those rules, because Ellis runs no
//   platform code, and every run checks the checkout's module still holds them.
// - A bare R3 is never a valid stage: in the risk vocabulary it means schema, security or external side effects.
// - Three autonomy-shaped vocabularies coexist, and nothing reconciles them (ensureAiAgentAutonomyLevelSchema.ts:39).

import type { Reader } from './registryReconciliation.ts';

export const CAPABILITIES_FILE = 'backend/src/services/agentDomain/capabilities/platform.json';
export const LADDER_FILE = 'backend/src/services/agentDomain/autonomyLadder.ts';

const STAGES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'].map((r) => `autonomy:${r}`);
const index = (s: string) => STAGES.indexOf(s);
const isStage = (v: unknown): v is string => typeof v === 'string' && STAGES.includes(v);
const TOOLLESS = 'autonomy:R2';
const PILOT = 'autonomy:R6';
const HUMAN_CAP = 'autonomy:R5';

// The lines that carry each rule in the platform's module. If one is gone, this copy may no longer match.
export const RULE_LINES: readonly string[] = [
  "reasons.push('no_approved_autonomy');",
  "reasons.push('capped_by_max_permitted');",
  "if (input.environment === 'production' && autonomyIndex(level) >= autonomyIndex('autonomy:R6')) {",
  "reasons.push('production_requires_separate_pilot_approval');",
  "if (input.granted_tools.length === 0 && autonomyIndex(level) > autonomyIndex('autonomy:R2')) {",
  "reasons.push('no_tool_grants');",
  "reasons.push('human_decision_required_at_every_level');",
  "if (autonomyIndex(level) > autonomyIndex('autonomy:R5')) {",
  "reasons.push('capped_below_automation_because_human_decision');",
];

export type Environment = 'sandbox' | 'production';
export type Binding = 'no_approved_autonomy' | 'approved_level' | 'capped_by_max_permitted' | 'no_tool_grants' | 'capped_below_automation_because_human_decision';

export interface AuthorityInput {
  capability_id: string;
  approved_autonomy: unknown;
  max_permitted_autonomy: unknown;
  granted_tools: readonly string[];
  environment: Environment;
  human_decision: boolean;
}
export interface Authority {
  capability_id: string;
  environment: Environment;
  effective_autonomy: string | null;
  binding_constraint: Binding;
  reasons: string[];
  approved_autonomy: unknown;
  ceiling: unknown;
  granted_tools: string[];
  human_decision: boolean;
  statement: string;
}

// Mirrors effectiveAuthority, and adds which step set the final level.
export function resolve(input: AuthorityInput): Authority {
  const reasons: string[] = [];
  const answer = (effective_autonomy: string | null, binding_constraint: Binding): Authority => ({
    capability_id: input.capability_id,
    environment: input.environment,
    effective_autonomy,
    binding_constraint,
    reasons,
    approved_autonomy: input.approved_autonomy ?? null,
    ceiling: input.max_permitted_autonomy,
    granted_tools: [...input.granted_tools],
    human_decision: input.human_decision,
    statement: effective_autonomy
      ? `${input.capability_id} resolves to ${effective_autonomy} in ${input.environment}, bound by ${binding_constraint}`
      : `${input.capability_id} has no effective authority in ${input.environment}: no_approved_autonomy`,
  });
  if (!isStage(input.approved_autonomy)) {
    reasons.push('no_approved_autonomy');
    return answer(null, 'no_approved_autonomy');
  }
  let level = input.approved_autonomy;
  let binding: Binding = 'approved_level';
  if (isStage(input.max_permitted_autonomy) && index(input.max_permitted_autonomy) < index(level)) {
    level = input.max_permitted_autonomy;
    binding = 'capped_by_max_permitted';
    reasons.push('capped_by_max_permitted');
  }
  if (input.environment === 'production' && index(level) >= index(PILOT)) reasons.push('production_requires_separate_pilot_approval');
  if (input.granted_tools.length === 0 && index(level) > index(TOOLLESS)) {
    level = TOOLLESS;
    binding = 'no_tool_grants';
    reasons.push('no_tool_grants');
  }
  if (input.human_decision) {
    reasons.push('human_decision_required_at_every_level');
    if (index(level) > index(HUMAN_CAP)) {
      level = HUMAN_CAP;
      binding = 'capped_below_automation_because_human_decision';
      reasons.push('capped_below_automation_because_human_decision');
    }
  }
  return answer(level, binding);
}

export class AuthorityInputError extends Error {
  readonly errorClass = 'ContractViolation';
}

interface CapabilityRow {
  capability_id: string;
  approved_autonomy?: unknown;
  current_approved_autonomy?: unknown;
  max_permitted_autonomy: unknown;
  human_decision: boolean;
  permissions_by_environment?: Partial<Record<Environment, { agent?: string[] }>>;
}

export interface AuthorityAnswer {
  source_commit: string | null;
  rules_match: boolean;
  rule_lines_missing: string[];
  statement: string;
  counts: { capabilities: number; no_authority: number; resolved: number };
  authorities: Authority[];
  human_decision: { granting_or_raising_a_level: 'person_only'; ellis_may: 'report' };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'The approved level and tool grants come from the platform\'s capability record in the commit read, not from the running system.',
  'Tool grants are the agent tools listed for that environment. Nothing here shows a tool was actually issued.',
  'This is the ladder only. The R0-R5 delivery risk tiers and ai_agents.autonomy_level are separate vocabularies, and nothing reconciles them. A value from one means nothing in another.',
  'A bare R3 is not a stage, so it resolves to no authority rather than being read as autonomy:R3.',
  'A production level at R6 or above is flagged, not lowered. The separate pilot approval is not read here, because no record of one exists.',
  'Each capability is resolved alone. No figure here describes an agent overall.',
];

export function authorityReport(r: Reader, source_commit: string | null, environment: Environment, capability_id?: string): AuthorityAnswer {
  let rows: CapabilityRow[];
  try {
    rows = (JSON.parse(r.read(CAPABILITIES_FILE)) as { capabilities: CapabilityRow[] }).capabilities;
  } catch (err) {
    throw new AuthorityInputError(`${CAPABILITIES_FILE} could not be read as JSON: ${(err as Error).message}`);
  }
  if (capability_id) rows = rows.filter((c) => c.capability_id === capability_id);
  if (!rows.length) throw new AuthorityInputError(`${capability_id} is not in ${CAPABILITIES_FILE}`);

  let ladder = '';
  try {
    ladder = r.read(LADDER_FILE);
  } catch {
    // an unreadable module fails every line below, so the copy is reported as unconfirmed
  }
  const rule_lines_missing = RULE_LINES.filter((l) => !ladder.includes(l));
  const rules_match = rule_lines_missing.length === 0;

  const authorities = rows.map((c) => resolve({
    capability_id: c.capability_id,
    approved_autonomy: c.approved_autonomy ?? c.current_approved_autonomy ?? null,
    max_permitted_autonomy: c.max_permitted_autonomy,
    granted_tools: c.permissions_by_environment?.[environment]?.agent ?? [],
    environment,
    human_decision: c.human_decision,
  }));
  const none = authorities.filter((a) => a.effective_autonomy === null).length;
  const statement = !rules_match ? `unconfirmed: ${rule_lines_missing.length} of ${RULE_LINES.length} rule lines were not found in the platform's module, so this copy may not match`
    : authorities.length === 1 ? authorities[0].statement
      : `${none} of ${authorities.length} capabilities have no effective authority in ${environment}`;
  return {
    source_commit, rules_match, rule_lines_missing, statement,
    counts: { capabilities: authorities.length, no_authority: none, resolved: authorities.length - none },
    authorities,
    human_decision: { granting_or_raising_a_level: 'person_only', ellis_may: 'report' },
    limits: [...LIMITS],
  };
}
