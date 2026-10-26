// The platform's admin-section rules, pinned from the platform repo at commit 13cb098.
// A copy can drift from the source, so the commit is named here and the doc says how to re-check it.
//
// - Section keys: backend/src/services/access/mgmtRoles.ts:15-43
// - Management roles and their sections: mgmtRoles.ts:64-162
// - Which sections a login reaches: backend/src/middlewares/authMiddleware.ts:40-45
// - A management role only counts for a 'staff' community member:
//   backend/src/services/access/mgmtBridgeService.ts:26

export const PINNED_COMMIT = '13cb098';

export const ALL_SECTIONS = [
  'dashboard', 'trust', 'war_room', 'revenue', 'campaigns', 'lead_ingestion', 'inbox_content',
  'program', 'intelligence', 'system', 'students', 'leads', 'career_review', 'internship', 'brands',
] as const;
export type Section = typeof ALL_SECTIONS[number];

const ADMIN_EXCEPT_INBOX: Section[] = ALL_SECTIONS.filter((s) => s !== 'inbox_content');

export const MGMT_ROLE_SECTIONS: Record<string, Section[]> = {
  owner: [...ALL_SECTIONS],
  admin: ADMIN_EXCEPT_INBOX,
  curriculum: ['dashboard', 'program'],
  revenue: ['dashboard', 'revenue', 'leads'],
  admissions: ['dashboard', 'lead_ingestion', 'internship'],
  support: ['students'],
  mentor: ['dashboard', 'career_review'],
  community_organizer: ['dashboard'],
  marketing: ['dashboard', 'campaigns', 'brands'],
  platform: ['dashboard', 'system'],
  executive: ['dashboard', 'trust', 'war_room'],
  lead_intake: ['dashboard', 'lead_ingestion'],
  internship_review: ['dashboard', 'internship'],
  product_experience: ['dashboard', 'brands'],
};

// Sections reached by a legacy admin_users login (its token carries no mgmt_role).
export function sectionsForAdminUserRole(role: string): Section[] {
  if (role === 'super_admin' || role === 'admin') return [...ALL_SECTIONS];
  if (role === 'sales') return ['leads'];
  return [];
}

// Sections reached through the staff bridge. An unknown role reaches nothing.
export function sectionsForMgmtRole(mgmtRole: string): Section[] {
  return MGMT_ROLE_SECTIONS[mgmtRole] ? [...MGMT_ROLE_SECTIONS[mgmtRole]] : [];
}
