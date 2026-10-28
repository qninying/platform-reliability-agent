// platform.runtime_threat_and_access_watch, first release behaviour (R2):
// answers "who holds which admin section today, and what changed since the last sweep" from the
// access records and the audit log. Detection only: Ellis never grants, removes or creates access.
//
// Why Ellis computes this itself: the platform's AccessControlGuardianAgent never reads access
// state. It statically scans route source for missing requireAdmin, and in production it skips,
// because the image has no source tree (backend/src/services/agents/security/accessControlGuardianAgent.ts:49-73).
//
// Each identity gets one status, because each has a different remedy:
// - no_admin_users_row: cannot sign in to admin at all. Remedy: a person decides whether to create a
//   login. An org member without a login is the known manager-access gap, not drift, and Ellis never
//   resolves it by creating a login.
// - admin_users_row_no_sections: can sign in but reaches no section. Remedy: change the login's role
//   or grant a management role.
// - bridge_only: no admin_users row, but reaches sections through a staff management role.
// - has_sections: reaches at least one section through an admin_users login.

import type { AccessSnapshot, AuditLogRow } from '../access/accessSnapshot.ts';
import { sectionsForAdminUserRole, sectionsForMgmtRole, PINNED_COMMIT, type Section } from '../access/sectionMap.ts';

export type AccessStatus = 'no_admin_users_row' | 'admin_users_row_no_sections' | 'bridge_only' | 'has_sections';

export interface AccessPath {
  via: 'admin_users' | 'mgmt_role_bridge';
  row_id: string;
  role: string;
  sections: Section[];
}

export interface IdentityAccess {
  email: string;
  status: AccessStatus;
  sections: Section[];
  paths: AccessPath[];
  remedy: string;
  notes: string[];
  citations: Array<{ table: 'admin_users' | 'community_members' | 'org_members'; id: string }>;
}

export interface Sweep {
  captured_at: string;
  section_rules_commit: string;
  identities: IdentityAccess[];
}

const REMEDY: Record<AccessStatus, string> = {
  no_admin_users_row: 'No admin login exists. Whether to create one is a human decision; Ellis never creates logins.',
  admin_users_row_no_sections: "A login exists but reaches no section. A person changes the login's role or grants a management role.",
  bridge_only: 'No admin login, but sections are reached through a staff management role. Review whether that role is intended.',
  has_sections: 'None needed unless the sections are wrong; any change is made by a person.',
};

export function accessSweep(snap: AccessSnapshot): Sweep {
  const byEmail = new Map<string, IdentityAccess>();
  const get = (email: string) => {
    const key = email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { email: key, status: 'no_admin_users_row', sections: [], paths: [], remedy: '', notes: [], citations: [] });
    return byEmail.get(key)!;
  };

  for (const u of snap.admin_users) {
    const id = get(u.email);
    id.paths.push({ via: 'admin_users', row_id: u.id, role: u.role, sections: sectionsForAdminUserRole(u.role) });
    id.citations.push({ table: 'admin_users', id: u.id });
  }
  for (const m of snap.community_members) {
    if (!m.mgmt_role) continue;
    const id = get(m.email);
    id.citations.push({ table: 'community_members', id: m.id });
    if (m.role !== 'staff') {
      id.notes.push(`management role '${m.mgmt_role}' is set but the member is '${m.role}', not staff, so it grants nothing today; it returns if they are made staff again`);
      continue;
    }
    const sections = sectionsForMgmtRole(m.mgmt_role);
    if (sections.length === 0) id.notes.push(`management role '${m.mgmt_role}' is not a known role, so it grants nothing`);
    id.paths.push({ via: 'mgmt_role_bridge', row_id: m.id, role: m.mgmt_role, sections });
  }
  for (const o of snap.org_members) {
    const id = get(o.email);
    id.citations.push({ table: 'org_members', id: o.id });
    if (id.paths.length === 0) {
      id.notes.push('org member with no admin login and no management role: the known manager-access gap, not drift');
    }
  }

  const identities = [...byEmail.values()].map(finish).sort((a, b) => (a.email < b.email ? -1 : 1));
  return { captured_at: snap.captured_at, section_rules_commit: PINNED_COMMIT, identities };
}

function finish(id: IdentityAccess): IdentityAccess {
  const sections = [...new Set(id.paths.flatMap((p) => p.sections))].sort() as Section[];
  const hasLogin = id.paths.some((p) => p.via === 'admin_users');
  const status: AccessStatus = !hasLogin
    ? (sections.length > 0 ? 'bridge_only' : 'no_admin_users_row')
    : (sections.length > 0 ? 'has_sections' : 'admin_users_row_no_sections');
  // The route that sets management roles is gated by 'program' only
  // (backend/src/middlewares/mgmtSectionGate.ts:100, backend/src/routes/admin/communityMemberRoutes.ts:93),
  // so a scoped role holding 'program' can raise any staff member's role, its own included, to owner.
  const notes = [...id.notes];
  for (const p of id.paths) {
    if (p.via === 'mgmt_role_bridge' && p.role !== 'owner' && p.sections.includes('program')) {
      notes.push(`management role '${p.role}' holds 'program', which reaches the route that sets management roles: it could raise any staff member, itself included, to owner`);
    }
  }
  return { ...id, status, sections, notes, remedy: REMEDY[status] };
}

export interface AccessChange {
  email: string;
  kind: 'added' | 'removed' | 'status_changed' | 'sections_gained' | 'sections_lost';
  detail: string;
}

export interface AccessReport {
  sweep: Sweep;
  since: string | null;
  changes: AccessChange[] | null;
  access_audit_rows: Array<{ id: string; actor: string | null; entity_id: string | null; new_values: Record<string, unknown> | null; created_at: string }>;
  notes: string[];
  limits: string[];
}

// Two platform limits stated in every answer, as K.D. asked on 2026-10-28; fixing either is A.M.'s call.
// Cited at platform commit 4443087.
export const LIMITS: readonly string[] = [
  'A removed management role can keep working for up to 12 hours. The staff admin token carries the role and lasts 12 hours (services/access/mgmtBridgeService.ts:92), and the section gate reads the role from the token, not the database (middlewares/mgmtSectionGate.ts:248-256). A section reported here as lost may still open until that token expires.',
  'Failed admin logins are not recorded, so this report cannot show them. A wrong password returns a 401 (services/adminService.ts:12, :17) that the error handler sends back without logging or storing it (middlewares/errorHandler.ts:10-12). Only a bad or expired token is recorded, as an admin_auth_failed event (middlewares/authMiddleware.ts:75), which this watch does not read.',
];

// Compares this sweep with the previous one. Without a previous sweep, "what changed" is unknown
// and said so, rather than reported as "nothing changed".
export function accessReport(snap: AccessSnapshot, previous: Sweep | null): AccessReport {
  const sweep = accessSweep(snap);
  const notes: string[] = [];
  if (!previous) notes.push('no previous sweep was given, so what changed is unknown, not "nothing"');
  if (previous && previous.section_rules_commit !== sweep.section_rules_commit) {
    notes.push(`section rules changed from ${previous.section_rules_commit} to ${sweep.section_rules_commit}; some section changes may come from the rules, not from people`);
  }
  const since = previous?.captured_at ?? null;
  return {
    sweep,
    since,
    changes: previous ? diff(previous, sweep) : null,
    access_audit_rows: accessAuditRows(snap.audit_logs, since),
    notes,
    limits: [...LIMITS],
  };
}

function diff(before: Sweep, after: Sweep): AccessChange[] {
  const prev = new Map(before.identities.map((i) => [i.email, i]));
  const next = new Map(after.identities.map((i) => [i.email, i]));
  const out: AccessChange[] = [];
  for (const [email, now] of next) {
    const was = prev.get(email);
    if (!was) {
      out.push({ email, kind: 'added', detail: `${now.status}, sections: ${now.sections.join(', ') || 'none'}` });
      continue;
    }
    if (was.status !== now.status) out.push({ email, kind: 'status_changed', detail: `${was.status} -> ${now.status}` });
    const gained = now.sections.filter((s) => !was.sections.includes(s));
    const lost = was.sections.filter((s) => !now.sections.includes(s));
    if (gained.length) out.push({ email, kind: 'sections_gained', detail: gained.join(', ') });
    if (lost.length) out.push({ email, kind: 'sections_lost', detail: lost.join(', ') });
  }
  for (const [email, was] of prev) {
    if (!next.has(email)) out.push({ email, kind: 'removed', detail: `was ${was.status}, sections: ${was.sections.join(', ') || 'none'}` });
  }
  return out.sort((a, b) => (a.email === b.email ? (a.kind < b.kind ? -1 : 1) : a.email < b.email ? -1 : 1));
}

// Audit rows that changed a management role. The audit middleware records only the new value, with
// old_values always null (backend/src/middlewares/auditMiddleware.ts:77-85), so the "before" side of
// a change comes from the previous sweep, not the audit log.
function accessAuditRows(rows: AuditLogRow[], since: string | null): AccessReport['access_audit_rows'] {
  return rows
    .filter((r) => r.new_values !== null && 'mgmt_role' in r.new_values)
    .filter((r) => since === null || Date.parse(r.created_at) > Date.parse(since))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
    .map((r) => ({ id: r.id, actor: r.admin_user_id, entity_id: r.entity_id, new_values: { mgmt_role: r.new_values!.mgmt_role }, created_at: r.created_at }));
}
