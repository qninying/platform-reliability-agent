// platform.schema_drift_detection, first release behaviour (R2):
// reports known drift from the latest drift run and names the axes that are not measured. Where no run has
// completed the answer is 'unknown, last run not found', never 'no drift'. Read-only: Ellis cannot read the
// production schema (production_database is default-denied, delivery/execution/executionPolicy.ts:35), so it
// reads the log the nightly script leaves. Resolving drift is a schema change, which stays a person's.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - schemaDriftCheck.sh writes one stamped line per run, `schema-drift: none` or `schema-drift: DETECTED`, and a
//   drifted run's report under it (scripts/schemaDriftCheck.sh:35-43). The install line sends both to a log (:18).
// - It decides "clean" only by finding the words "already schema-faithful" (:35). Anything else logs DETECTED, so
//   a run that never compared anything logs DETECTED too, with only a header under it.
// - The sync script ends a finished report with a DRY-RUN line (syncDevSchemaFromProd.sh:115). No such line means
//   the comparison stopped part way.
// - The alert's result is one line after the report, and a failure still exits 0 (schemaDriftCheck.sh:64, :71).

import type { Reader } from './registryReconciliation.ts';

export const DRIFT_SCRIPT = 'scripts/schemaDriftCheck.sh';
export const SYNC_SCRIPT = 'scripts/syncDevSchemaFromProd.sh';
export const SERVER = 'backend/src/server.ts';
export const RECONCILER = 'backend/src/config/schemaReconcile.ts';
export const NOT_FOUND = 'unknown, last run not found';
// The tables this domain reads. A new column on any of these reaches production only through its ensure module.
export const DOMAIN_MODELS = ['AiAgent', 'CronScheduleConfig', 'AiAgentActivityLog', 'DeadLetterJob'] as const;

export type AlertState = 'sent' | 'failed' | 'not_recorded';
export type RunOutcome = 'none' | 'detected' | 'incomplete';
export interface DriftItems { enums: string[]; tables: string[]; columns: string[]; warnings: string[] }
export interface DriftRun { stamp: string; outcome: RunOutcome; drift: DriftItems | null; alert: AlertState | null }
export interface ParsedLog { runs: DriftRun[]; lines_not_read: number }

const RUN_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) schema-drift: (none|DETECTED)$/;
const SECTIONS: Record<string, 'enums' | 'tables' | 'columns' | 'warnings'> = {
  '-- missing enum types --': 'enums',
  '-- missing tables --': 'tables',
  '-- missing columns (drift on existing tables) --': 'columns',
  '-- warnings --': 'warnings',
};
const REQUIRED = ['enums', 'tables', 'columns'] as const;

function readDetected(stamp: string, body: string[]): DriftRun {
  const drift: DriftItems = { enums: [], tables: [], columns: [], warnings: [] };
  const seen = new Set<string>();
  let section: keyof DriftItems | null = null;
  let finished = false;
  let alert: AlertState = 'not_recorded';
  for (const raw of body) {
    const line = raw.trim();
    if (line.startsWith('schema-drift alert sent')) alert = 'sent';
    else if (line.startsWith('schema-drift alert FAILED')) alert = 'failed';
    else if (line.startsWith('DRY-RUN:')) { finished = true; section = null; }
    else if (SECTIONS[line]) { section = SECTIONS[line]; seen.add(section); }
    else if (section && line && line !== '(none)') drift[section].push(line.replace(/^! /, ''));
  }
  const items = drift.enums.length + drift.tables.length + drift.columns.length;
  const complete = finished && REQUIRED.every((s) => seen.has(s)) && items > 0;
  return { stamp, outcome: complete ? 'detected' : 'incomplete', drift: items > 0 || complete ? drift : null, alert };
}

export function parseDriftLog(text: string): ParsedLog {
  const runs: DriftRun[] = [];
  let lines_not_read = 0;
  let open: { stamp: string; body: string[] } | null = null;
  const close = () => { if (open) runs.push(readDetected(open.stamp, open.body)); open = null; };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = RUN_LINE.exec(line);
    if (m && !Number.isNaN(Date.parse(m[1]))) {
      close();
      if (m[2] === 'none') runs.push({ stamp: m[1], outcome: 'none', drift: null, alert: null });
      else open = { stamp: m[1], body: [] };
    } else if (open) open.body.push(line);
    else if (line.trim()) lines_not_read++;
  }
  close();
  return { runs: runs.sort((a, b) => a.stamp.localeCompare(b.stamp)), lines_not_read };
}

export type AxisStatus = 'measured' | 'unmeasured' | 'not_read';
export interface Axis { axis: string; status: AxisStatus; why: string; where: string | null }

function tryRead(r: Reader, path: string): string | null {
  try {
    return r.read(path);
  } catch (err) {
    if ((err as { errorClass?: string }).errorClass === 'SourceUnavailable') return null;
    throw err;
  }
}

const code = (text: string) => text.split('\n').map((l) => (l.trimStart().startsWith('#') ? '' : l)).join('\n');
const lineOf = (text: string, needle: string) => text.slice(0, Math.max(text.indexOf(needle), 0)).split('\n').length;
const definition = (text: string, name: string) => text.split('\n').find((l) => l.startsWith(`${name}()`)) ?? null;

export function readAxes(r: Reader): Axis[] {
  const raw = tryRead(r, SYNC_SCRIPT);
  const notRead = (axis: string, why: string): Axis => ({ axis, status: 'not_read', why: `${SYNC_SCRIPT} could not be read: ${why}`, where: null });
  if (raw === null) {
    return ['dev_behind_prod_names', 'dev_ahead_of_prod', 'column_shape', 'enum_values', 'indexes_and_constraints', 'code_versus_database']
      .map((a) => notRead(a, 'not assumed either way'));
  }
  const sync = code(raw);
  const at = (needle: string) => `${SYNC_SCRIPT}:${lineOf(raw, needle)}`;
  const columns = definition(sync, 'list_colpairs');
  const enums = definition(sync, 'list_enums');
  const flag = (axis: string, found: boolean | null, yes: string, no: string, where: string): Axis => (found === null
    ? notRead(axis, 'its definition was not found')
    : { axis, status: found ? 'measured' : 'unmeasured', why: found ? yes : no, where });
  const shape = columns === null ? null : /data_type|format_type|is_nullable|column_default/.test(columns);
  const values = enums === null ? null : /enumlabel/.test(enums);
  const ahead = /comm\s+-13\b/.test(sync) || /comm\s+-23\s+<\([^)]*DEV/.test(sync);
  const behind = /comm\s+-23\s+<\([^)]*PROD/.test(sync);
  const keys = /pg_indexes|pg_constraint|table_constraints/.test(sync);
  const model = /ensure\w*Schema|rawAttributes|models\//.test(sync);
  const exclude = /EXCLUDE_REGEX="\$\{EXCLUDE_REGEX:-([^}]*)\}"/.exec(sync)?.[1] ?? null;
  return [
    flag('dev_behind_prod_names', behind, 'Tables, enum types and column names on production and missing on development.', 'The script no longer compares production against development.', at('MISSING_TABLES=$(comm')),
    flag('dev_ahead_of_prod', ahead, 'Objects on development and missing on production are compared.', 'Only production minus development is taken, so an object only on development is never seen. A column built on development and missing on production is this case.', at('MISSING_TABLES=$(comm')),
    flag('column_shape', shape, 'Column shape is compared.', 'Columns compare by table.column name only, so a changed type, nullability or default is not seen.', at('list_colpairs()')),
    flag('enum_values', values, 'Enum values are compared.', 'Enum types compare by name only, so a value added to one side is not seen.', at('list_enums()')),
    flag('indexes_and_constraints', keys, 'Indexes and constraints are compared.', 'Neither is compared on a table that exists on both sides.', SYNC_SCRIPT),
    flag('code_versus_database', model, 'Code is compared with a database.', 'Neither database is compared with the models or the ensure-schema modules.', SYNC_SCRIPT),
    ...(exclude === null ? [] : [{ axis: 'excluded_names', status: 'unmeasured' as const, why: `Names matching ${exclude} are left out of the table and column comparison.`, where: at('EXCLUDE_REGEX="${') }]),
  ];
}

export interface Reconciler {
  read: boolean;
  models: string[];
  domain_models_protected: string[];
  domain_models_not_protected: string[];
  additive_only: boolean | null;
  where: string | null;
}

export function readReconciler(r: Reader): Reconciler {
  const server = tryRead(r, SERVER);
  const body = server === null ? null : /reconcileMissingColumns\(\[([^\]]*)\]\)/.exec(server);
  const source = tryRead(r, RECONCILER);
  const additive = source === null ? null : /addColumn/.test(source) && !/removeColumn|changeColumn|renameColumn/.test(source);
  if (server === null || body === null) {
    return { read: false, models: [], domain_models_protected: [], domain_models_not_protected: [], additive_only: additive, where: null };
  }
  const models = body[1].split(',').map((m) => m.trim()).filter(Boolean);
  return {
    read: true,
    models,
    domain_models_protected: DOMAIN_MODELS.filter((m) => models.includes(m)),
    domain_models_not_protected: DOMAIN_MODELS.filter((m) => !models.includes(m)),
    additive_only: additive,
    where: `${SERVER}:${lineOf(server, 'await reconcileMissingColumns([')}`,
  };
}

function ensureModules(r: Reader): number | null {
  try {
    return r.list('backend/src/db').filter((f) => /\/ensure\w*Schema\.ts$/.test(f)).length;
  } catch {
    return null; // the count is a figure in the answer, and null says it was not read
  }
}

export type Verdict = 'drift_reported' | 'no_drift_reported' | 'unknown';
export type UnknownReason = 'log_not_supplied' | 'no_completed_run' | 'last_attempt_incomplete' | 'last_run_stale';

export interface DriftAnswer {
  captured_at: string;
  source_commit: string | null;
  verdict: Verdict;
  unknown_because: UnknownReason | null;
  statement: string;
  last_completed: { stamp: string; outcome: 'none' | 'detected'; age_hours: number; fresh: boolean } | null;
  latest_attempt: { stamp: string; outcome: RunOutcome } | null;
  drift: DriftItems | null;
  alert: AlertState | null;
  runs: { completed: number; incomplete: number; dated_after_capture: number; lines_not_read: number };
  axes_measured: Axis[];
  axes_not_measured: Axis[];
  reconciler: Reconciler;
  ensure_schema_modules: number | null;
  human_decision: { applying_any_schema_change: 'person_only'; ellis_may: 'report_and_propose' };
  limits: string[];
}

export const LIMITS: readonly string[] = [
  'A none entry is not proof of agreement. When the column or enum read fails the script still logs none, and the log cannot show it; Ellis cannot tell the two apart.',
  'Every answer is about development against production, on the axes listed as measured, at the stamp of the last completed run. It says nothing about what changed after that stamp.',
  'The crontab is held in no repository, so source cannot prove the nightly job is installed. Only dated entries in the log show it ran.',
  'Ellis reads a copy of the log, supplied by a person. It cannot read the production schema, so it never re-checks an entry.',
  'A column whose type could not be read is dropped from the report by the script without a warning.',
  'The reconciler list and flags are read from source. Whether SCHEMA_RECONCILE is on in production, and what each boot healed, are not read.',
];

export interface DriftOptions { max_age_hours: number; source_commit: string | null }

export function schemaDriftAnswer(r: Reader, log: string | null, capturedAt: string, opts: DriftOptions): DriftAnswer {
  const parsed = log === null ? { runs: [], lines_not_read: 0 } : parseDriftLog(log);
  const now = Date.parse(capturedAt);
  const usable = parsed.runs.filter((run) => Date.parse(run.stamp) <= now);
  const done = usable.filter((run) => run.outcome !== 'incomplete');
  const latest = usable.at(-1) ?? null;
  const last = done.at(-1) ?? null;
  const age = last ? Math.round((now - Date.parse(last.stamp)) / 360000) / 10 : null;
  const fresh = age !== null && age <= opts.max_age_hours;
  const failedAfter = latest !== null && latest.outcome === 'incomplete';

  let verdict: Verdict;
  let because: UnknownReason | null = null;
  let statement: string;
  if (last === null) {
    verdict = 'unknown';
    because = log === null ? 'log_not_supplied' : failedAfter ? 'last_attempt_incomplete' : 'no_completed_run';
    statement = failedAfter ? `${NOT_FOUND}. The attempt at ${latest!.stamp} never finished its comparison.` : NOT_FOUND;
  } else if (last.outcome === 'detected') {
    verdict = 'drift_reported';
    const d = last.drift!;
    statement = `Drift reported at ${last.stamp}: ${d.tables.length} table(s), ${d.enums.length} enum type(s) and ${d.columns.length} column(s) on production are missing from development.`;
    if (!fresh) statement += ` That run is ${age} hours old, so this may not be current.`;
    if (failedAfter) statement += ` The attempt at ${latest!.stamp} never finished its comparison.`;
  } else if (failedAfter) {
    verdict = 'unknown';
    because = 'last_attempt_incomplete';
    statement = `Unknown. The attempt at ${latest!.stamp} never finished its comparison; the last completed run, at ${last.stamp}, reported none.`;
  } else if (!fresh) {
    verdict = 'unknown';
    because = 'last_run_stale';
    statement = `Unknown. The last completed run, at ${last.stamp}, reported none but is ${age} hours old, and silence since then proves nothing.`;
  } else {
    verdict = 'no_drift_reported';
    statement = `The run at ${last.stamp} reported none, on the axes listed as measured only.`;
  }

  const axes = readAxes(r);
  return {
    captured_at: capturedAt,
    source_commit: opts.source_commit,
    verdict,
    unknown_because: because,
    statement,
    last_completed: last ? { stamp: last.stamp, outcome: last.outcome as 'none' | 'detected', age_hours: age!, fresh } : null,
    latest_attempt: latest ? { stamp: latest.stamp, outcome: latest.outcome } : null,
    drift: last?.outcome === 'detected' ? last.drift : null,
    alert: last?.alert ?? null,
    runs: {
      completed: done.length,
      incomplete: usable.length - done.length,
      dated_after_capture: parsed.runs.length - usable.length,
      lines_not_read: parsed.lines_not_read,
    },
    axes_measured: axes.filter((a) => a.status === 'measured'),
    axes_not_measured: axes.filter((a) => a.status !== 'measured'),
    reconciler: readReconciler(r),
    ensure_schema_modules: ensureModules(r),
    human_decision: { applying_any_schema_change: 'person_only', ellis_may: 'report_and_propose' },
    limits: [...LIMITS],
  };
}
