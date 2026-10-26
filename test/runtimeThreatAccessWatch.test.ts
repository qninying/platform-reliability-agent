import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAccessSnapshot, type AccessSnapshot } from '../src/access/accessSnapshot.ts';
import { sectionsForMgmtRole, ALL_SECTIONS } from '../src/access/sectionMap.ts';
import { accessReport, accessSweep } from '../src/capabilities/runtimeThreatAccessWatch.ts';

// Test inputs shaped like the platform's tables; addresses use the reserved example.invalid domain.
function snap(over: Partial<AccessSnapshot> = {}, at = '2026-10-26T05:00:00Z'): AccessSnapshot {
  return { captured_at: at, captured_by: 'test', admin_users: [], community_members: [], org_members: [], audit_logs: [], ...over };
}

function who(s: AccessSnapshot, email: string) {
  const i = accessSweep(s).identities.find((x) => x.email === email);
  assert.ok(i, `${email} should be in the sweep`);
  return i;
}

test("acceptance: 'no admin_users row' and 'admin_users row with no sections' are different answers with different remedies", () => {
  const s = snap({
    admin_users: [{ id: 'au-1', email: 'login@example.invalid', role: 'participant' }],
    org_members: [{ id: 'om-1', email: 'nologin@example.invalid', role: 'manager' }],
  });
  const noRow = who(s, 'nologin@example.invalid');
  const noSections = who(s, 'login@example.invalid');
  assert.equal(noRow.status, 'no_admin_users_row');
  assert.equal(noSections.status, 'admin_users_row_no_sections');
  assert.notEqual(noRow.remedy, noSections.remedy);
  assert.match(noRow.remedy, /never creates logins/);
  assert.match(noSections.remedy, /changes the login's role/);
  assert.deepEqual(noRow.citations, [{ table: 'org_members', id: 'om-1' }]);
  assert.deepEqual(noSections.citations, [{ table: 'admin_users', id: 'au-1' }]);
});

test('the manager-access gap is named as a known gap, not drift', () => {
  const i = who(snap({ org_members: [{ id: 'om-1', email: 'Manager@Example.invalid', role: 'manager' }] }), 'manager@example.invalid');
  assert.ok(i.notes.some((n) => /known manager-access gap, not drift/.test(n)));
});

test('sections follow the platform rules: super_admin all, sales leads only, mgmt admin everything except inbox_content', () => {
  const s = snap({
    admin_users: [{ id: 'au-1', email: 'a@example.invalid', role: 'super_admin' }, { id: 'au-2', email: 'b@example.invalid', role: 'sales' }],
    community_members: [{ id: 'cm-1', enrollment_id: 'e1', email: 'c@example.invalid', role: 'staff', mgmt_role: 'admin' }],
  });
  assert.equal(who(s, 'a@example.invalid').sections.length, ALL_SECTIONS.length);
  assert.deepEqual(who(s, 'b@example.invalid').sections, ['leads']);
  const c = who(s, 'c@example.invalid');
  assert.equal(c.status, 'bridge_only');
  assert.equal(c.sections.includes('inbox_content'), false);
  assert.equal(c.sections.length, ALL_SECTIONS.length - 1);
});

test('the pinned map matches the platform test that anticipates the manager as mgmt admin (mgmtRbac.test.ts:30-34)', () => {
  assert.ok(sectionsForMgmtRole('admin').includes('revenue'));
  assert.ok(sectionsForMgmtRole('admin').includes('program'));
  assert.equal(sectionsForMgmtRole('admin').includes('inbox_content'), false);
  assert.deepEqual([...sectionsForMgmtRole('curriculum')].sort(), ['dashboard', 'program']);
  assert.deepEqual(sectionsForMgmtRole('support'), ['students']);
  assert.deepEqual(sectionsForMgmtRole('not_a_role'), []);
});

test('a management role on a member who is no longer staff grants nothing, and is reported', () => {
  const i = who(snap({ community_members: [{ id: 'cm-1', enrollment_id: 'e1', email: 'x@example.invalid', role: 'member', mgmt_role: 'owner' }] }), 'x@example.invalid');
  assert.equal(i.status, 'no_admin_users_row');
  assert.deepEqual(i.sections, []);
  assert.ok(i.notes.some((n) => /not staff/.test(n)));
});

test("a scoped role holding 'program' is flagged as able to raise a role to owner", () => {
  const i = who(snap({ community_members: [{ id: 'cm-1', enrollment_id: 'e1', email: 'cur@example.invalid', role: 'staff', mgmt_role: 'curriculum' }] }), 'cur@example.invalid');
  assert.ok(i.notes.some((n) => /raise any staff member, itself included, to owner/.test(n)));
  const rev = who(snap({ community_members: [{ id: 'cm-2', enrollment_id: 'e2', email: 'rev@example.invalid', role: 'staff', mgmt_role: 'revenue' }] }), 'rev@example.invalid');
  assert.equal(rev.notes.length, 0);
});

test("without a previous sweep, what changed is 'unknown', not 'nothing'", () => {
  const r = accessReport(snap(), null);
  assert.equal(r.changes, null);
  assert.ok(r.notes.some((n) => /unknown, not "nothing"/.test(n)));
});

test('changes since the last sweep: added, removed, sections gained and lost, status changed', () => {
  const before = accessSweep(snap({
    admin_users: [{ id: 'au-1', email: 'a@example.invalid', role: 'sales' }, { id: 'au-2', email: 'gone@example.invalid', role: 'admin' }],
  }, '2026-10-25T05:00:00Z'));
  const now = snap({
    admin_users: [{ id: 'au-1', email: 'a@example.invalid', role: 'participant' }],
    community_members: [{ id: 'cm-1', enrollment_id: 'e1', email: 'new@example.invalid', role: 'staff', mgmt_role: 'platform' }],
    audit_logs: [
      { id: 'al-old', admin_user_id: 'x', action: 'update', entity_type: 'members', entity_id: 'cm-1', new_values: { mgmt_role: 'support' }, created_at: '2026-10-24T00:00:00Z' },
      { id: 'al-new', admin_user_id: 'x', action: 'update', entity_type: 'members', entity_id: 'cm-1', new_values: { mgmt_role: 'platform' }, created_at: '2026-10-25T12:00:00Z' },
      { id: 'al-other', admin_user_id: 'x', action: 'update', entity_type: 'campaigns', entity_id: null, new_values: { name: 'x' }, created_at: '2026-10-25T12:00:00Z' },
    ],
  });
  const r = accessReport(now, before);
  const kinds = r.changes!.map((c) => `${c.email}:${c.kind}`);
  assert.deepEqual(kinds, [
    'a@example.invalid:sections_lost',
    'a@example.invalid:status_changed',
    'gone@example.invalid:removed',
    'new@example.invalid:added',
  ]);
  assert.deepEqual(r.access_audit_rows.map((a) => a.id), ['al-new']);
});

test('a snapshot that carries a credential column is refused, so it is never read or repeated', () => {
  const raw = snap({ admin_users: [{ id: 'au-1', email: 'a@example.invalid', role: 'admin', ...{ password_hash: 'not-a-real-hash' } } as never] });
  assert.throws(() => validateAccessSnapshot(raw), /credential columns must not be exported/);
});

test('bad input is refused with a contract error', () => {
  assert.throws(() => validateAccessSnapshot({ captured_at: 'yesterday' }), /captured_at/);
  assert.throws(() => validateAccessSnapshot({ captured_at: '2026-10-26T00:00:00Z' }), /admin_users\[\]/);
});

test('idempotent: the same records in any order give the same sweep', () => {
  const rows = { admin_users: [{ id: 'au-1', email: 'b@example.invalid', role: 'admin' }, { id: 'au-2', email: 'a@example.invalid', role: 'sales' }] };
  assert.deepEqual(accessSweep(snap(rows)), accessSweep(snap({ admin_users: [...rows.admin_users].reverse() })));
});
