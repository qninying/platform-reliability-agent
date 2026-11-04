// One manager-access check (A.M., 2026-11-04: manager reachable surface, manager restriction directives and manager
// scoped authorization merge into one check that reports all three). For one agent it answers: who may act on it
// and by which route, whether its accountable manager can reach it, and which directives actually take effect.
// Read-only. Granting a login, a role or a manager is a human decision at every autonomy level.
//
// Platform behaviour this rests on (platform repo, commit cc1ebc5):
// - Two routes to an admin token. A legacy admin_users login carries its row's role. A staff community member with
//   a management role gets a token minted from the enrollment's email, with role super_admin when the management
//   role is owner and admin otherwise (services/access/mgmtBridgeService.ts:97-112).
// - The agent's own pages are gated by requireAgentManagerOrAdmin (middlewares/agentManagerAuthMiddleware.ts:50-91),
//   on 32 routes: super_admin passes; otherwise the token's email must match an org_members row, and the agent must
//   be in that person's downstream. The downstream is the agents reporting to that person, then the agents reporting
//   to those, up to 5 levels (services/workforce/orgChartHierarchyService.ts:90, :110-141). It walks agents only:
//   a person above a manager in the human chart does not pass.
// - Manager directives are rows in manager_directives (models/ManagerDirective.ts). The only runtime reader injects
//   active directive text into a prompt (agentBlueprint/agentSystemPrompt.ts:21-32), and only Dara's and Reese's
//   prompt builders pass the agent id that triggers it (curriculum/daraSystemPrompt.ts:19-26,
//   reese/reeseSystemPrompt.ts:82-96). A directive is text, never a mechanical limit, and a failed lookup drops it.

import type { Citation } from './orchestrationHealthWatch.ts';

export const PINNED_AT = 'cc1ebc5';
export const MAX_DOWNWARD_DEPTH = 5;
// Agents whose prompt builder reads active directives at run time.
export const DIRECTIVE_READERS = ['Dara', 'Reese'];

export interface AgentRow { id: string; agent_name: string; reports_to_type: 'human' | 'agent' | null; reports_to_id: string | null }
export interface OrgMemberRow { id: string; email: string }
export interface AdminUserRow { id: string; email: string; role: string }
// A staff community member with a management role, joined to the enrollment email the minted token carries.
export interface ManagementGrantRow { enrollment_id: string; email: string; mgmt_role: string }
export interface DirectiveRow { id: string; agent_id: string; status: string; created_by_email: string }

export interface AccessSnapshot {
  captured_at: string;
  captured_by: string;
  ai_agents: AgentRow[];
  org_members: OrgMemberRow[];
  admin_users: AdminUserRow[];
  management_grants: ManagementGrantRow[];
  manager_directives: DirectiveRow[];
}

export type Route = 'admin_login' | 'management_role';
export interface Login { email: string; route: Route; role: string; row_id: string }
export interface MayAct { email: string; route: Route; because: 'super_admin' | 'agent_in_their_downstream'; org_member_id: string | null }
export type DirectiveEffect = 'injected_into_prompt' | 'recorded_but_unenforced' | 'revoked';

export interface AccessAnswer {
  pinned_at: string;
  agent: { id: string; agent_name: string } | null;
  // The person the agent reports to, if a person: the accountable manager in the records.
  accountable: {
    org_member_id: string;
    email: string;
    logins_under_this_email: Login[];
    passes_the_gate: boolean;
    statement: string;
  } | null;
  may_act: MayAct[];
  // Logins that reach the admin surface but not this agent's pages, with the reason.
  refused: Array<{ email: string; route: Route; why: string }>;
  directives: Array<{ id: string; status: string; effect: DirectiveEffect; why: string }>;
  cannot_see: string[];
  statement: string;
  citations: Citation[];
}

const tokenRole = (mgmtRole: string) => (mgmtRole === 'owner' ? 'super_admin' : 'admin');

function logins(s: AccessSnapshot): Login[] {
  return [
    ...s.admin_users.map((u): Login => ({ email: u.email, route: 'admin_login', role: u.role, row_id: u.id })),
    ...s.management_grants.map((g): Login => ({ email: g.email, route: 'management_role', role: tokenRole(g.mgmt_role), row_id: g.enrollment_id })),
  ].sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : a.route < b.route ? -1 : 1));
}

// The agents in a person's downstream, walked the way the platform walks it.
export function downstream(s: AccessSnapshot, orgMemberId: string): Set<string> {
  const out = new Set<string>();
  let level = s.ai_agents.filter((a) => a.reports_to_type === 'human' && a.reports_to_id === orgMemberId).map((a) => a.id);
  level.forEach((id) => out.add(id));
  for (let depth = 0; level.length > 0 && depth < MAX_DOWNWARD_DEPTH; depth++) {
    const ids = new Set(level);
    level = s.ai_agents.filter((a) => a.reports_to_type === 'agent' && a.reports_to_id !== null && ids.has(a.reports_to_id)).map((a) => a.id);
    level.forEach((id) => out.add(id));
  }
  return out;
}

export function managerAccess(s: AccessSnapshot, agentName: string): AccessAnswer {
  const cannot_see = [
    'Whether a section gate also applies: these routes are checked by role and reporting chain here, not by the sections a management role grants',
    'Whether a login is in use or its password works: a row is a route, not proof anyone has signed in',
    'Who a person is beyond the email: the gate joins on email, so two addresses for one person are two people to it',
  ];
  const matches = s.ai_agents.filter((a) => a.agent_name === agentName);
  if (matches.length !== 1) {
    return { pinned_at: PINNED_AT, agent: null, accountable: null, may_act: [], refused: [], directives: [], cannot_see,
      statement: matches.length === 0 ? `No ai_agents row is named ${agentName}, so nobody can be authorised for it.` : `${matches.length} rows are named ${agentName}; Ellis does not pick one.`,
      citations: matches.map((a) => ({ table: 'ai_agents' as const, id: a.id, fields: ['agent_name'] })) };
  }
  const agent = matches[0];
  const all = logins(s);
  const may_act: MayAct[] = [];
  const refused: AccessAnswer['refused'] = [];
  for (const l of all) {
    const member = s.org_members.find((m) => m.email === l.email);
    if (l.role === 'super_admin') { may_act.push({ email: l.email, route: l.route, because: 'super_admin', org_member_id: member?.id ?? null }); continue; }
    if (!member) { refused.push({ email: l.email, route: l.route, why: 'no org_members row carries this email, so the gate cannot resolve a management relationship' }); continue; }
    if (downstream(s, member.id).has(agent.id)) may_act.push({ email: l.email, route: l.route, because: 'agent_in_their_downstream', org_member_id: member.id });
    else refused.push({ email: l.email, route: l.route, why: `org member ${member.id} does not have this agent in their downstream` });
  }

  let accountable: AccessAnswer['accountable'] = null;
  if (agent.reports_to_type === 'human' && agent.reports_to_id) {
    const m = s.org_members.find((x) => x.id === agent.reports_to_id);
    if (m) {
      const own = all.filter((l) => l.email === m.email);
      const passes = may_act.some((x) => x.email === m.email);
      accountable = {
        org_member_id: m.id, email: m.email, logins_under_this_email: own, passes_the_gate: passes,
        statement: own.length === 0
          ? `The accountable manager has org_members row ${m.id}. Separately, no admin_users row and no management role carries ${m.email}, so no login reaches this agent as them. A login under another address does not count: the gate joins on email.`
          : passes ? `The accountable manager has org_members row ${m.id} and a login under ${m.email} (${own.map((l) => l.route).join(', ')}) that passes the gate.`
          : `The accountable manager has org_members row ${m.id} and a login under ${m.email}, but it does not pass the gate.`,
      };
    }
  }

  const directives = s.manager_directives.filter((d) => d.agent_id === agent.id).sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => {
    if (d.status !== 'active') return { id: d.id, status: d.status, effect: 'revoked' as const, why: 'not active, so nothing reads it' };
    return DIRECTIVE_READERS.includes(agent.agent_name)
      ? { id: d.id, status: d.status, effect: 'injected_into_prompt' as const, why: 'its text is added to this agent\'s prompt on each call; it limits nothing mechanically, and a failed lookup drops it' }
      : { id: d.id, status: d.status, effect: 'recorded_but_unenforced' as const, why: 'no runtime path reads directives for this agent: only Dara\'s and Reese\'s prompt builders do' };
  });

  const unenforced = directives.filter((d) => d.effect === 'recorded_but_unenforced').length;
  const statement = `${may_act.length} login(s) may act on ${agentName}: ${may_act.filter((x) => x.because === 'super_admin').length} as super admin and ${may_act.filter((x) => x.because === 'agent_in_their_downstream').length} through the reporting chain. `
    + (accountable ? (accountable.passes_the_gate ? 'Its accountable manager is among them. ' : 'Its accountable manager is not. ') : 'It reports to no person, so no manager is accountable in the records. ')
    + `${directives.length} directive(s)${unenforced ? `, ${unenforced} recorded but enforced nowhere` : ''}.`;
  const citations: Citation[] = [
    { table: 'ai_agents', id: agent.id, fields: ['agent_name', 'reports_to_type', 'reports_to_id'] },
    ...(accountable ? [{ table: 'org_members' as Citation['table'], id: accountable.org_member_id, fields: ['email'] }] : []),
    ...all.map((l) => ({ table: (l.route === 'admin_login' ? 'admin_users' : 'community_members') as Citation['table'], id: l.row_id, fields: ['email', 'role'] })),
    ...directives.map((d) => ({ table: 'manager_directives' as Citation['table'], id: d.id, fields: ['agent_id', 'status'] })),
  ];
  return { pinned_at: PINNED_AT, agent: { id: agent.id, agent_name: agent.agent_name }, accountable, may_act, refused, directives, cannot_see, statement, citations };
}
