// Usage:
//   node src/cli/shadowObservations.ts --mode record --monitor <cron_health|orchestration_health> --snapshot <export.json>
//        --records <records.json> [--subject fleet]
//   node src/cli/shadowObservations.ts --mode sheet --records <records.json> --sheet <review-sheet.json>
//   node src/cli/shadowObservations.ts --mode pair --records <records.json> --sheet <review-sheet.json> --out <observations.json>
// Builds the input for shadow-evaluation: record a monitor's output on a dated export, write a BLIND review sheet
// (no Ellis verdict on it) for a named person to fill in, then pair the signed sheet with the records. Reads the
// export; writes only the three files named. Records and sheet rows a person filled in are kept on every re-run.
// Exit code 0 when done (pair: every record reviewed), 3 when pair leaves records awaiting review or orphaned
// sheet rows, 1 for bad input.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadSeverityTable, ContractViolation } from '../output/toolOutput.ts';
import { makeRecord, mergeRecords, pair, reviewSheet, type RecordedOutput, type ReviewSheet } from '../shadow/observationBuilder.ts';
import { recordMonitor } from '../shadow/monitorRecorders.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string' }, monitor: { type: 'string' }, snapshot: { type: 'string' }, subject: { type: 'string' },
    records: { type: 'string' }, sheet: { type: 'string' }, out: { type: 'string' },
  },
});

function need(name: keyof typeof values): string {
  const v = values[name];
  if (typeof v !== 'string' || v === '') throw new ContractViolation(`--mode ${values.mode} needs --${name}`);
  return v;
}

function readJson<T>(path: string, fallback?: T): T {
  if (fallback !== undefined && !existsSync(path)) return fallback;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw Object.assign(new Error(`${path} could not be read: ${(err as Error).message}`), { name: 'SourceUnavailable' });
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ContractViolation(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

// Written to a temporary file and renamed, so an interrupted run never leaves half a file behind.
function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

function loadRecords(path: string, mustExist: boolean): RecordedOutput[] {
  const f = readJson<{ records?: unknown }>(path, mustExist ? undefined : { records: [] });
  if (!Array.isArray(f.records)) throw new ContractViolation(`${path} needs records[]`);
  return f.records as RecordedOutput[];
}

try {
  const mode = values.mode;
  if (mode === 'record') {
    const recordsPath = need('records');
    const output = recordMonitor(need('monitor'), need('snapshot'), loadSeverityTable());
    const { records, added } = mergeRecords(loadRecords(recordsPath, false), [makeRecord(output, values.subject ?? 'fleet')]);
    writeJson(recordsPath, { records });
    console.log(JSON.stringify({ mode, added, records: records.length, tool: output.tool, verdict_recorded: true }, null, 2));
    process.exit(0);
  }
  if (mode === 'sheet') {
    const sheetPath = need('sheet');
    const prior = readJson<ReviewSheet | undefined>(sheetPath, { instructions: '', rows: [] });
    const sheet = reviewSheet(loadRecords(need('records'), true), prior);
    writeJson(sheetPath, sheet);
    console.log(JSON.stringify({ mode, rows: sheet.rows.length, filled: sheet.rows.filter((r) => r.reference.verdict !== null).length }, null, 2));
    process.exit(0);
  }
  if (mode === 'pair') {
    const sheet = readJson<ReviewSheet>(need('sheet'));
    if (!Array.isArray(sheet.rows)) throw new ContractViolation(`${values.sheet} needs rows[]`);
    const result = pair(loadRecords(need('records'), true), sheet);
    writeJson(need('out'), { note: 'Built by shadow-observations from recorded Ellis outputs and a signed review sheet.', observations: result.observations });
    console.log(JSON.stringify({ mode, observations: result.observations.length, awaiting_review: result.awaiting_review, orphaned: result.orphaned }, null, 2));
    process.exit(result.awaiting_review.length > 0 || result.orphaned.length > 0 ? 3 : 0);
  }
  throw new ContractViolation('--mode must be record, sheet or pair');
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
