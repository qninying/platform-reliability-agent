import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolve, authorityReport, RULE_LINES, LIMITS, CAPABILITIES_FILE, LADDER_FILE, type AuthorityInput } from '../src/capabilities/autonomyAuthority.ts';
import type { Reader } from '../src/capabilities/registryReconciliation.ts';

// A capability record and ladder module shaped like the real ones at bbde6ef. Names are test inputs.
const base: AuthorityInput = { capability_id: 'platform.a', approved_autonomy: 'autonomy:R4', max_permitted_autonomy: 'autonomy:R9', granted_tools: ['read'], environment: 'sandbox', human_decision: false };
const go = (o: Partial<AuthorityInput> = {}) => resolve({ ...base, ...o });
const row = (capability_id: string, o: Record<string, unknown> = {}) => ({ capability_id, human_decision: false, max_permitted_autonomy: 'autonomy:R5', permissions_by_environment: { sandbox: { agent: ['read'] }, production: { agent: [] } }, ...o });
const CAPS = [row('platform.none'), row('platform.high', { approved_autonomy: 'autonomy:R4' }), row('platform.old', { current_approved_autonomy: 'autonomy:R1' })];
const files = (capabilities: unknown[] = CAPS, ladder = RULE_LINES.join('\n')): Record<string, string> => ({ [CAPABILITIES_FILE]: JSON.stringify({ capabilities }), [LADDER_FILE]: ladder });
const readerOf = (f: Record<string, string>): Reader => ({
  read(p) { if (f[p] === undefined) throw new Error(`no ${p}`); return f[p]; },
  list() { return Object.keys(f); },
});

test('a capability with no recorded approval returns null with reason no_approved_autonomy, never a defaulted rung', () => {
  for (const approved_autonomy of [null, undefined, '', 'observe', 'R3', 'autonomy:R10', { not_applicable: true, reason: 'x' }]) {
    const a = go({ approved_autonomy });
    assert.equal(a.effective_autonomy, null, String(approved_autonomy));
    assert.deepEqual(a.reasons, ['no_approved_autonomy']);
    assert.equal(a.binding_constraint, 'no_approved_autonomy');
  }
  assert.equal(go({ approved_autonomy: null }).statement, 'platform.a has no effective authority in sandbox: no_approved_autonomy');
});

test('a human_decision capability never resolves above autonomy:R5', () => {
  for (const approved_autonomy of ['autonomy:R6', 'autonomy:R7', 'autonomy:R8', 'autonomy:R9']) {
    const a = go({ approved_autonomy, human_decision: true });
    assert.equal(a.effective_autonomy, 'autonomy:R5');
    assert.equal(a.binding_constraint, 'capped_below_automation_because_human_decision');
  }
  const r5 = go({ approved_autonomy: 'autonomy:R5', human_decision: true });
  assert.equal(r5.effective_autonomy, 'autonomy:R5');
  assert.deepEqual(r5.reasons, ['human_decision_required_at_every_level']);
  assert.equal(r5.binding_constraint, 'approved_level');
});

test('the approved level binds when nothing lowers it', () => {
  const a = go();
  assert.deepEqual([a.effective_autonomy, a.binding_constraint, a.reasons], ['autonomy:R4', 'approved_level', []]);
  assert.equal(a.statement, 'platform.a resolves to autonomy:R4 in sandbox, bound by approved_level');
});

test('a ceiling lowers and never raises', () => {
  const low = go({ max_permitted_autonomy: 'autonomy:R3' });
  assert.deepEqual([low.effective_autonomy, low.binding_constraint], ['autonomy:R3', 'capped_by_max_permitted']);
  const high = go({ max_permitted_autonomy: 'autonomy:R9', approved_autonomy: 'autonomy:R1' });
  assert.equal(high.effective_autonomy, 'autonomy:R1');
  const equal = go({ max_permitted_autonomy: 'autonomy:R4' });
  assert.deepEqual([equal.binding_constraint, equal.reasons], ['approved_level', []]);
});

test('no tool grants stops at R2, and R2 itself needs none', () => {
  const a = go({ granted_tools: [] });
  assert.deepEqual([a.effective_autonomy, a.binding_constraint, a.reasons], ['autonomy:R2', 'no_tool_grants', ['no_tool_grants']]);
  const r2 = go({ granted_tools: [], approved_autonomy: 'autonomy:R2' });
  assert.deepEqual([r2.binding_constraint, r2.reasons], ['approved_level', []]);
});

test('the last step to lower the level is the binding one', () => {
  const a = go({ approved_autonomy: 'autonomy:R8', max_permitted_autonomy: 'autonomy:R7', granted_tools: [], human_decision: true });
  assert.deepEqual([a.effective_autonomy, a.binding_constraint], ['autonomy:R2', 'no_tool_grants']);
  assert.deepEqual(a.reasons, ['capped_by_max_permitted', 'no_tool_grants', 'human_decision_required_at_every_level']);
});

test('production at R6 or above is flagged and only production is', () => {
  assert.deepEqual(go({ approved_autonomy: 'autonomy:R6', environment: 'production' }).reasons, ['production_requires_separate_pilot_approval']);
  assert.equal(go({ approved_autonomy: 'autonomy:R6', environment: 'production' }).effective_autonomy, 'autonomy:R6');
  assert.deepEqual(go({ approved_autonomy: 'autonomy:R6' }).reasons, []);
  assert.deepEqual(go({ approved_autonomy: 'autonomy:R5', environment: 'production' }).reasons, []);
});

test('one capability reaching a high level does not lift another', () => {
  const a = authorityReport(readerOf(files()), 'abc', 'sandbox');
  assert.deepEqual(a.authorities.map((x) => x.effective_autonomy), [null, 'autonomy:R4', 'autonomy:R1']);
  assert.deepEqual(a.counts, { capabilities: 3, no_authority: 1, resolved: 2 });
  assert.equal(a.statement, '1 of 3 capabilities have no effective authority in sandbox');
});

test('grants come from the asked environment, so production without grants stops at R2', () => {
  const a = authorityReport(readerOf(files()), 'abc', 'production', 'platform.high');
  assert.deepEqual([a.authorities[0].effective_autonomy, a.authorities[0].granted_tools], ['autonomy:R2', []]);
  assert.equal(a.statement, 'platform.high resolves to autonomy:R2 in production, bound by no_tool_grants');
  assert.deepEqual(authorityReport(readerOf(files()), 'abc', 'sandbox', 'platform.high').authorities[0].granted_tools, ['read']);
  const noGrants = authorityReport(readerOf(files([row('platform.x', { approved_autonomy: 'autonomy:R4', permissions_by_environment: undefined })])), 'abc', 'sandbox');
  assert.equal(noGrants.authorities[0].effective_autonomy, 'autonomy:R2');
});

test('a changed rule line in the platform module marks the answer unconfirmed', () => {
  for (const missing of RULE_LINES) {
    const a = authorityReport(readerOf(files(CAPS, RULE_LINES.filter((l) => l !== missing).join('\n'))), 'abc', 'sandbox');
    assert.equal(a.rules_match, false);
    assert.deepEqual(a.rule_lines_missing, [missing]);
    assert.match(a.statement, /^unconfirmed: 1 of 9 rule lines/);
  }
  const f = files();
  delete f[LADDER_FILE];
  assert.equal(authorityReport(readerOf(f), 'abc', 'sandbox').rule_lines_missing.length, RULE_LINES.length);
  assert.equal(authorityReport(readerOf(files()), 'abc', 'sandbox').rules_match, true);
});

test('bad questions are refused', () => {
  assert.throws(() => authorityReport(readerOf(files()), 'abc', 'sandbox', 'platform.nope'), /is not in/);
  assert.throws(() => authorityReport(readerOf({}), 'abc', 'sandbox'), /could not be read/);
});

test('the decision stays a person\'s, and the limits are stated every time', () => {
  const a = authorityReport(readerOf(files()), 'abc', 'sandbox');
  assert.deepEqual(a.human_decision, { granting_or_raising_a_level: 'person_only', ellis_may: 'report' });
  assert.deepEqual(a.limits, [...LIMITS]);
  assert.equal(a.source_commit, 'abc');
});

const run = (...a: string[]) => spawnSync(process.execPath, ['src/cli/autonomyAuthority.ts', ...a], { encoding: 'utf8' });
function checkout(f: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'authority-'));
  for (const [p, text] of Object.entries({ ...f, 'backend/src/services/aiOpsScheduler.ts': 'x' })) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

test('the CLI exits 4 for no authority, 0 when resolved, 5 when unconfirmed and 1 for bad input', () => {
  const src = checkout(files());
  assert.equal(run('--source', src, '--environment', 'sandbox').status, 4);
  assert.equal(run('--source', src, '--environment', 'sandbox', '--capability', 'platform.high').status, 0);
  assert.equal(run('--source', checkout(files(CAPS, 'changed')), '--environment', 'sandbox').status, 5);
  assert.equal(run('--source', src).status, 1);
  assert.equal(run('--source', src, '--environment', 'staging').status, 1);
  assert.equal(run('--source', src, '--environment', 'sandbox', '--capability', 'platform.nope').status, 1);
});
