// platform.security_posture_scan, first release behaviour (R2):
// answers "what did the last scan of each kind find, and when" from stored scan records. A scan that
// has never run is 'unknown', never 'no findings'. Read-only; no secret value is ever passed on.
//
// Platform behaviour this rests on (platform repo, commit c99021d, unchanged at 13cb098):
// - Three timers, all run through runAgent (backend/src/services/aiOrchestrator.ts:818-828):
//   SecretDetectionAgent every 4 hours, CodeSecurityAuditAgent at 03:00, DependencySecurityAgent at
//   04:00 (backend/src/services/aiOpsScheduler.ts:329-331).
// - Each run's scan action, with its coverage counts, is in the activity row's details.actions
//   (aiOrchestrator.ts:247-251). The findings are stored as a department_events row with
//   metadata.agent, but only when a 'security' department exists (e.g. secretDetectionAgent.ts:129).
// - The production image has no source tree (backend/src/services/agents/security/sourceTreeRoot.ts:1-13).
//   The code audit records that as 'scan_skipped_no_source' (codeSecurityAuditAgent.ts:33). The secret
//   and dependency scanners do not: they record "Clean scan ... in 0 files" and "0 vulnerabilities
//   across 0 project(s)" (secretDetectionAgent.ts:69-74, :141; dependencySecurityAgent.ts:79-83, :21).
//   So a scan that covered nothing is 'unknown' here, never 'clean'.
// - The secret scanner keeps the first 80 characters of the matching line as `snippet`
//   (secretDetectionAgent.ts:104). Only whitelisted fields leave this module, so a snippet or any
//   other field that could hold a secret is never repeated.

import type { ActivityLogRow, DepartmentEventRow } from '../records.ts';
import type { ReadSource } from '../readSource.ts';
import type { Citation } from './orchestrationHealthWatch.ts';

export type ScanKind = 'secret' | 'code' | 'dependency';
export type ScanStatus = 'findings' | 'clean' | 'unknown';

interface ScannerSpec {
  agentName: string;
  scanActions: string[];
  coverageUnit: 'files' | 'projects';
  cadenceHours: number;
}

export const SCANNERS: Record<ScanKind, ScannerSpec> = {
  secret: { agentName: 'SecretDetectionAgent', scanActions: ['secret_scan'], coverageUnit: 'files', cadenceHours: 4 },
  code: { agentName: 'CodeSecurityAuditAgent', scanActions: ['code_security_audit', 'scan_skipped_no_source'], coverageUnit: 'files', cadenceHours: 24 },
  dependency: { agentName: 'DependencySecurityAgent', scanActions: ['dependency_audit'], coverageUnit: 'projects', cadenceHours: 24 },
};

// The only finding fields that are ever passed on. A secret finding names where it is, never what it is.
const SAFE_FINDING_FIELDS = ['file', 'line', 'type', 'pattern_name', 'vuln_name', 'category', 'severity', 'module_name', 'title', 'url', 'directory'];

export interface ScanAnswer {
  scan: ScanKind;
  agent_name: string;
  status: ScanStatus;
  reason: string;
  last_scan_at: string | null;
  coverage: { unit: 'files' | 'projects'; count: number } | null;
  findings_count: number | null;
  findings: Array<Record<string, unknown>>;
  latest_run_failed: boolean;
  citations: Citation[];
}

export interface PostureOptions {
  now: Date;
  // A scan is stale, so 'unknown', once it is older than this many of its scheduled intervals.
  missedIntervals?: number;
}

export function securityPosture(source: ReadSource, opts: PostureOptions): ScanAnswer[] {
  return (Object.keys(SCANNERS) as ScanKind[]).map((kind) => answerScan(source, kind, opts));
}

export function answerScan(source: ReadSource, kind: ScanKind, opts: PostureOptions): ScanAnswer {
  const spec = SCANNERS[kind];
  const base = { scan: kind, agent_name: spec.agentName, last_scan_at: null, coverage: null, findings_count: null, findings: [], latest_run_failed: false, citations: [] as Citation[] };
  const agents = source.findAgentsByName(spec.agentName);
  if (agents.length !== 1) {
    return { ...base, status: 'unknown', reason: agents.length === 0 ? `no ai_agents row named ${spec.agentName}, so no scan of this kind can have been recorded` : `${agents.length} ai_agents rows named ${spec.agentName}; the records are inconsistent` };
  }
  const agent = agents[0];
  const runs = source.recentActivity(agent.id, 20);
  const events = source.departmentEvents(spec.agentName, 5);
  const citations: Citation[] = [{ table: 'ai_agents', id: agent.id, fields: ['agent_name', 'enabled'] }];
  const latestFailed = runs[0]?.result === 'failed';
  if (latestFailed) citations.push(activityCite(runs[0]));

  const scanRun = runs.find((r) => scanAction(r, spec) !== undefined);
  const event = events[0];
  if (!scanRun && !event) {
    return { ...base, status: 'unknown', reason: `never run: no completed ${kind} scan is recorded in the activity log or department_events`, latest_run_failed: latestFailed, citations };
  }
  if (scanRun) citations.push(activityCite(scanRun));
  if (event) citations.push({ table: 'department_events', id: event.id, fields: ['created_at', 'metadata'] });

  const facts = scanFacts(spec, scanRun, event);
  const answer = { ...base, ...facts, latest_run_failed: latestFailed, citations };
  return { ...answer, ...judge(spec, facts, latestFailed, opts) };
}

interface ScanFacts {
  last_scan_at: string;
  coverage: { unit: 'files' | 'projects'; count: number } | null;
  findings_count: number | null;
  findings: Array<Record<string, unknown>>;
  skipped: boolean;
}

// Prefers the department_events row (it carries the findings); falls back to the counts in the
// activity row's scan action when no event was stored.
function scanFacts(spec: ScannerSpec, run: ActivityLogRow | undefined, event: DepartmentEventRow | undefined): ScanFacts {
  const action = run ? scanAction(run, spec) : undefined;
  const after = (action?.after_state ?? {}) as Record<string, unknown>;
  const useEvent = event && (!run || Date.parse(event.created_at) >= Date.parse(run.created_at) - 60_000);
  const meta = (useEvent ? event.metadata : null) ?? {};
  const coverageCount = spec.coverageUnit === 'projects'
    ? num(after.projects_audited) ?? (Array.isArray(meta.results) ? meta.results.length : undefined)
    : num(meta.files_scanned) ?? num(after.files_scanned);
  return {
    last_scan_at: useEvent ? event.created_at : run!.created_at,
    coverage: coverageCount === undefined ? null : { unit: spec.coverageUnit, count: coverageCount },
    findings_count: num(meta.findings_count) ?? num(after.findings_count) ?? num(after.total_vulns) ?? findingsList(meta).length,
    findings: findingsList(meta).slice(0, 10).map(redact),
    skipped: action?.action === 'scan_skipped_no_source' || after.skipped === true,
  };
}

function judge(spec: ScannerSpec, f: ScanFacts, latestFailed: boolean, opts: PostureOptions): { status: ScanStatus; reason: string } {
  const failedNote = latestFailed ? ' The newest run after it failed.' : '';
  const ageHours = (opts.now.getTime() - Date.parse(f.last_scan_at)) / 3_600_000;
  const limit = spec.cadenceHours * (opts.missedIntervals ?? 2);
  if (ageHours > limit) {
    return { status: 'unknown', reason: `last scan is ${Math.round(ageHours)} hours old; it runs every ${spec.cadenceHours} hours, so its result no longer describes the code.${failedNote}` };
  }
  if (f.skipped) return { status: 'unknown', reason: `the last scan was skipped: no source tree in that runtime, so nothing was examined.${failedNote}` };
  if (!f.coverage) return { status: 'unknown', reason: `the last scan recorded no ${spec.coverageUnit} count, so whether it examined anything is unknown.${failedNote}` };
  if (f.coverage.count === 0) {
    return { status: 'unknown', reason: `the last scan examined 0 ${spec.coverageUnit}; a scan of nothing is not a clean scan.${failedNote}` };
  }
  if ((f.findings_count ?? 0) > 0) return { status: 'findings', reason: `${f.findings_count} finding(s) in ${f.coverage.count} ${spec.coverageUnit}.${failedNote}` };
  return { status: 'clean', reason: `0 findings in ${f.coverage.count} ${spec.coverageUnit}.${failedNote}` };
}

function scanAction(run: ActivityLogRow, spec: ScannerSpec) {
  if (run.result === 'failed') return undefined;
  return run.details?.actions?.find((a) => spec.scanActions.includes(a.action ?? ''));
}

function findingsList(meta: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(meta.top_findings)) return meta.top_findings as Array<Record<string, unknown>>;
  if (Array.isArray(meta.findings)) return meta.findings as Array<Record<string, unknown>>;
  if (Array.isArray(meta.results)) {
    return (meta.results as Array<Record<string, unknown>>).flatMap((r) => (Array.isArray(r.advisories) ? (r.advisories as Array<Record<string, unknown>>).map((a) => ({ ...a, directory: r.directory })) : []));
  }
  return [];
}

export function redact(finding: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SAFE_FINDING_FIELDS) {
    const v = finding[k];
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return out;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function activityCite(row: ActivityLogRow): Citation {
  return { table: 'ai_agent_activity_logs', id: row.id, fields: ['action', 'result', 'created_at', 'details'] };
}
