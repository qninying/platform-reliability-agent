import { readFileSync } from 'node:fs';

// A dated export of the records that decide admin access, as a person with admin access would pull
// them. Column names follow the platform's models (platform repo, commit 13cb098):
// admin_users (backend/src/models/AdminUser.ts), community_members (CommunityMember.ts),
// org_members (OrgMember.ts), audit_logs (AuditLog.ts).

export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  display_name?: string | null;
  is_ai_operated?: boolean;
}

// Staff members, with the email of their enrollment joined in, since the bridge identifies them by it.
export interface CommunityMemberRow {
  id: string;
  enrollment_id: string;
  email: string;
  role: string;
  mgmt_role: string | null;
}

export interface OrgMemberRow {
  id: string;
  email: string;
  role: string;
}

export interface AuditLogRow {
  id: string;
  admin_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export interface AccessSnapshot {
  captured_at: string;
  captured_by: string;
  admin_users: AdminUserRow[];
  community_members: CommunityMemberRow[];
  org_members: OrgMemberRow[];
  audit_logs: AuditLogRow[];
}

export class AccessSnapshotError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: AccessSnapshotError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

// Credential columns must never be exported. A snapshot that carries one is refused outright, so it
// is not read, kept or repeated.
const FORBIDDEN_COLUMNS = ['password_hash', 'password', 'token', 'secret'];

export function validateAccessSnapshot(raw: unknown, label = 'snapshot'): AccessSnapshot {
  const s = raw as Partial<AccessSnapshot>;
  if (typeof s?.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) {
    throw new AccessSnapshotError('ContractViolation', `${label} needs a valid captured_at`);
  }
  for (const table of ['admin_users', 'community_members', 'org_members', 'audit_logs'] as const) {
    if (!Array.isArray(s[table])) throw new AccessSnapshotError('ContractViolation', `${label} needs ${table}[] (use [] when empty)`);
  }
  for (const row of s.admin_users as unknown as Array<Record<string, unknown>>) {
    const bad = FORBIDDEN_COLUMNS.filter((c) => c in row);
    if (bad.length > 0) {
      throw new AccessSnapshotError('ContractViolation', `${label} admin_users row ${String(row.id)} carries ${bad.join(', ')}; credential columns must not be exported`);
    }
  }
  return s as AccessSnapshot;
}

export function loadAccessSnapshot(path: string): AccessSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new AccessSnapshotError('SourceUnavailable', `${path} could not be read: ${(err as Error).message}`);
  }
  try {
    return validateAccessSnapshot(JSON.parse(text), path);
  } catch (err) {
    if (err instanceof AccessSnapshotError) throw err;
    throw new AccessSnapshotError('ContractViolation', `${path} is not valid JSON: ${(err as Error).message}`);
  }
}
