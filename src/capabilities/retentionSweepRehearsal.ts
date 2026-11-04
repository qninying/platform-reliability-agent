// platform.data_retention_sweep, rung R4: executes a retention sweep of intelligence_decisions end to end against a
// sandbox database seeded with rows either side of the boundary and rows other tables still reference. Ellis's
// sweep applies a stated rule, holds back any row that is referenced, archives before it deletes, deletes only
// rows it can see in the archive, and works in bounded batches. The platform's sweep runs on the same seed as the
// control. Sandbox only; nothing reaches a database.
//
// Platform behaviour the control mirrors (platform repo, commit c150d4c48, backend/src/services/cory/intelligenceRetention.ts):
// - The window is 30 days in code (:17) and a row is old when timestamp < now - 30 days (:47, :70), so a row exactly
//   30 days old is kept. No stated policy names that window.
// - Archive copies up to 5,000 old rows not yet archived, in no stated order (:49-55). Delete removes up to 5,000 old
//   rows, in no stated order, without checking that they were archived (:71-77), and without checking references.
// - strategic_actions.decision_id references intelligence_decisions (backend/src/models/StrategicAction.ts:37-41),
//   and company_directives.cory_decision_id holds a decision id with no constraint (CompanyDirective.ts:29,
//   read at companyToCoryAdapter.ts:79-80). Whether the foreign key exists in production is not readable from source.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = 'c150d4c48';
export const LIMITS: readonly string[] = [
  'The stated rule comes from the fixture. No retention window for this table is approved anywhere, so a pass shows the sweep follows a rule, not that the rule is right.',
  'References are the two the platform code shows: strategic_actions.decision_id and company_directives.cory_decision_id. A reference held only in JSON or in another service is not seen.',
  'The platform control models "no stated order" as two different orders, so the risk shows deterministically. In production the overlap depends on the planner.',
  'Whether the foreign key is enforced in production is not known. If it is, the platform\'s delete fails for the whole batch instead of removing referenced rows.',
];

export interface Decision { decision_id: string; timestamp: string }
export interface StatedRule { days: number; boundary: 'older_than' | 'at_or_older'; source: string }
export interface Seeded extends Decision { expect: 'deleted' | 'kept' | 'held' }
export interface RetentionFixture {
  fixture_id: string;
  description: string;
  now: string;
  batch_limit: number;
  stated_rule: StatedRule | null;
  decisions: Seeded[];
  strategic_actions: Array<{ id: string; decision_id: string | null }>;
  company_directives: Array<{ id: string; cory_decision_id: string | null }>;
  // Rows whose archive write fails, as a constraint or a full disk would make it fail.
  archive_fails?: string[];
}

interface Db { main: Map<string, Decision>; archive: Map<string, Decision>; refs: Set<string>; failing: Set<string> }
export interface RunResult { run: number; batches: number; archived: string[]; deleted: string[]; held: string[]; archive_failed: string[] }

const DAY = 86_400_000;
const db = (fx: RetentionFixture): Db => ({
  main: new Map(fx.decisions.map(({ expect: _e, ...d }) => [d.decision_id, { ...d }])),
  archive: new Map(),
  refs: new Set([...fx.strategic_actions.map((s) => s.decision_id), ...fx.company_directives.map((c) => c.cory_decision_id)].filter((x): x is string => x !== null)),
  failing: new Set(fx.archive_fails ?? []),
});
const archive = (s: Db, d: Decision): boolean => { if (s.failing.has(d.decision_id)) return false; s.archive.set(d.decision_id, { ...d }); return true; };
const byAge = (a: Decision, b: Decision) => a.timestamp.localeCompare(b.timestamp) || a.decision_id.localeCompare(b.decision_id);

export function isOld(d: Decision, nowMs: number, rule: StatedRule): boolean {
  const t = Date.parse(d.timestamp), cut = nowMs - rule.days * DAY;
  return rule.boundary === 'older_than' ? t < cut : t <= cut;
}

// Ellis's sweep: one run works batch by batch until nothing old and unreferenced is left, up to a cap.
function ellisRun(s: Db, run: number, nowMs: number, rule: StatedRule, limit: number): RunResult {
  const out: RunResult = { run, batches: 0, archived: [], deleted: [], held: [], archive_failed: [] };
  out.held = [...s.main.values()].filter((d) => isOld(d, nowMs, rule) && s.refs.has(d.decision_id)).map((d) => d.decision_id).sort();
  for (let i = 0; i < 1000; i++) {
    // A row whose archive failed this run is left for the next run, not retried in a loop.
    const batch = [...s.main.values()].filter((d) => isOld(d, nowMs, rule) && !s.refs.has(d.decision_id) && !out.archive_failed.includes(d.decision_id)).sort(byAge).slice(0, limit);
    if (!batch.length) break;
    out.batches++;
    for (const d of batch) if (!s.archive.has(d.decision_id)) (archive(s, d) ? out.archived : out.archive_failed).push(d.decision_id);
    for (const d of batch) if (s.archive.has(d.decision_id)) { s.main.delete(d.decision_id); out.deleted.push(d.decision_id); }
  }
  return out;
}

// The platform's cycle as written: one archive batch and one delete batch per nightly run, each in its own order.
function platformRun(s: Db, run: number, nowMs: number, limit: number): RunResult {
  const rule: StatedRule = { days: 30, boundary: 'older_than', source: 'platform code' };
  const out: RunResult = { run, batches: 1, archived: [], deleted: [], held: [], archive_failed: [] };
  const old = [...s.main.values()].filter((d) => isOld(d, nowMs, rule));
  for (const d of old.filter((x) => !s.archive.has(x.decision_id)).sort(byAge).reverse().slice(0, limit)) (archive(s, d) ? out.archived : out.archive_failed).push(d.decision_id);
  for (const d of [...old].sort(byAge).slice(0, limit)) { s.main.delete(d.decision_id); out.deleted.push(d.decision_id); }
  return out;
}

export interface Loss { unarchived_deleted: string[]; references_broken: string[] }
const losses = (s: Db, fx: RetentionFixture): Loss => ({
  unarchived_deleted: fx.decisions.filter((d) => !s.main.has(d.decision_id) && !s.archive.has(d.decision_id)).map((d) => d.decision_id).sort(),
  references_broken: [...s.refs].filter((id) => fx.decisions.some((d) => d.decision_id === id) && !s.main.has(id)).sort(),
});

export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  stated_rule: StatedRule | null;
  runs: RunResult[];
  rows: Array<{ decision_id: string; timestamp: string; expect: Seeded['expect']; got: Seeded['expect'] }>;
  ellis_losses: Loss;
  platform_control: { runs: RunResult[]; losses: Loss };
  checks: { boundary_per_stated_rule: boolean; dependents_survive: boolean; every_delete_archived: boolean; second_run_deletes_zero: boolean; control_shows_a_loss: boolean };
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: RetentionFixture): Rehearsal {
  const nowMs = Date.parse(fx.now);
  const control = db(fx);
  const platform = { runs: [platformRun(control, 1, nowMs, fx.batch_limit), platformRun(control, 2, nowMs, fx.batch_limit)], losses: losses(control, fx) };
  const base = { fixture_id: fx.fixture_id, pinned_at: PINNED_AT, stated_rule: fx.stated_rule, platform_control: platform, limits: [...LIMITS] };
  if (!fx.stated_rule) {
    const none = { boundary_per_stated_rule: false, dependents_survive: false, every_delete_archived: false, second_run_deletes_zero: false, control_shows_a_loss: false };
    return { ...base, runs: [], rows: [], ellis_losses: { unarchived_deleted: [], references_broken: [] }, checks: none, verified: false,
      statement: `In sandbox ${fx.fixture_id}, not run: no stated retention rule, and Ellis does not sweep against a window it has not been given.` };
  }
  const s = db(fx);
  const runs = [ellisRun(s, 1, nowMs, fx.stated_rule, fx.batch_limit), ellisRun(s, 2, nowMs, fx.stated_rule, fx.batch_limit)];
  const rows = fx.decisions.map((d) => ({ decision_id: d.decision_id, timestamp: d.timestamp, expect: d.expect,
    got: (s.main.has(d.decision_id) ? (runs[0].held.includes(d.decision_id) ? 'held' : 'kept') : 'deleted') as Seeded['expect'] }));
  const mine = losses(s, fx);
  const cut = nowMs - fx.stated_rule.days * DAY;
  const atBoundary = rows.filter((r) => Date.parse(r.timestamp) === cut);
  const checks = {
    boundary_per_stated_rule: atBoundary.length > 0 && rows.every((r) => r.got === r.expect),
    dependents_survive: runs[0].held.length > 0 && mine.references_broken.length === 0,
    every_delete_archived: runs[0].deleted.length > 0 && mine.unarchived_deleted.length === 0 && runs[0].archive_failed.length > 0,
    second_run_deletes_zero: runs[1].deleted.length === 0 && runs[1].archived.length === 0,
    control_shows_a_loss: platform.losses.unarchived_deleted.length + platform.losses.references_broken.length > 0,
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const pl = platform.losses;
  return {
    ...base, runs, rows, ellis_losses: mine, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${runs[0].deleted.length} row(s) deleted in ${runs[0].batches} batch(es), each archived first; ${runs[0].archive_failed.length} row(s) kept because their archive write failed; ${runs[0].held.length} referenced row(s) held; the row at the boundary handled per the stated rule (${fx.stated_rule.boundary}, ${fx.stated_rule.days} days); the second run deleted zero. Sandbox only; nothing reached a database.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + ` On the same seed the platform's cycle deleted ${pl.unarchived_deleted.length} row(s) never archived and removed ${pl.references_broken.length} row(s) other tables still reference.`,
  };
}

export function loadRetentionFixture(path: string): RetentionFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: RetentionFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof fx.fixture_id !== 'string' || Number.isNaN(Date.parse(fx.now)) || !Number.isInteger(fx.batch_limit) || fx.batch_limit < 1
    || !Array.isArray(fx.decisions) || !Array.isArray(fx.strategic_actions) || !Array.isArray(fx.company_directives)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, now, batch_limit >= 1, decisions[], strategic_actions[] and company_directives[]`);
  }
  const r = fx.stated_rule;
  if (r !== null && (!(r.days > 0) || (r.boundary !== 'older_than' && r.boundary !== 'at_or_older') || typeof r.source !== 'string')) {
    throw new SandboxError('ContractViolation', `fixture ${path}: stated_rule needs days > 0, boundary older_than or at_or_older, and a source (or null)`);
  }
  for (const d of fx.decisions) if (typeof d.decision_id !== 'string' || Number.isNaN(Date.parse(d.timestamp))) throw new SandboxError('ContractViolation', `fixture ${path}: decision ${JSON.stringify(d.decision_id)} needs decision_id and timestamp`);
  for (const id of fx.archive_fails ?? []) if (!fx.decisions.some((d) => d.decision_id === id)) throw new SandboxError('ContractViolation', `fixture ${path}: archive_fails names unknown decision ${id}`);
  return fx;
}
