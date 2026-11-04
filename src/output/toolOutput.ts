// One output shape for every Ellis tool (K.D.'s ask 3, cleared by A.M. on 2026-11-04).
// Each tool's own answer travels unchanged in `detail`; the envelope adds a shared verdict,
// a severity set only by K.D.'s table, and the row ids the verdict rests on.

import { readFileSync } from 'node:fs';

export type SharedVerdict = 'problem' | 'ok' | 'unknown' | 'partly_unknown';
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Evidence { table: string; id: string; fields: string[] }
export interface AsOf { captured_at: string | null; captured_by: string | null; note: string | null }

export interface ToolOutput<D> {
  tool: string;
  as_of: AsOf;
  verdict: SharedVerdict;
  severity: Severity | 'unassigned';
  // The table rule that set the severity, or why none did.
  severity_rule: string;
  // A severity the platform itself attached, shown as evidence, never used as Ellis's severity.
  platform_signal: string | null;
  evidence: Evidence[];
  blind_spots: string[];
  detail: D;
}

export interface SeverityRule { tool: string; case: string; severity: Severity; why: string }
export interface SeverityTable { owner: string; status: string; rules: SeverityRule[] }

export const SEVERITY_TABLE_PATH = new URL('../../governance/severity-table.json', import.meta.url);
const LEVELS: ReadonlySet<string> = new Set(['Critical', 'High', 'Medium', 'Low']);

export class ContractViolation extends Error {
  constructor(message: string) { super(message); this.name = 'ContractViolation'; }
}

export function loadSeverityTable(path: URL | string = SEVERITY_TABLE_PATH): SeverityTable {
  const t = JSON.parse(readFileSync(path, 'utf8')) as SeverityTable;
  if (typeof t.owner !== 'string' || typeof t.status !== 'string' || !Array.isArray(t.rules)) {
    throw new ContractViolation(`severity table at ${String(path)} is not { owner, status, rules[] }`);
  }
  for (const r of t.rules) {
    if (typeof r.tool !== 'string' || typeof r.case !== 'string' || !LEVELS.has(r.severity)) {
      throw new ContractViolation(`severity rule ${JSON.stringify(r)} needs tool, case and one of Critical, High, Medium, Low`);
    }
  }
  return t;
}

// Only a problem gets a severity, and only from a rule K.D. wrote for this tool and case.
export function applySeverity(table: SeverityTable, tool: string, verdict: SharedVerdict, kase: string): { severity: Severity | 'unassigned'; severity_rule: string } {
  if (verdict !== 'problem') return { severity: 'unassigned', severity_rule: `no severity: the verdict is ${verdict}, not a problem` };
  const rule = table.rules.find((r) => r.tool === tool && r.case === kase);
  if (rule) return { severity: rule.severity, severity_rule: `${tool} / ${kase}: ${rule.why}` };
  if (table.rules.length === 0) return { severity: 'unassigned', severity_rule: `${table.owner}'s severity table has no rules yet (${table.status})` };
  return { severity: 'unassigned', severity_rule: `${table.owner}'s severity table has no rule for ${tool} / ${kase}` };
}

export interface EnvelopeInput<D> {
  tool: string;
  as_of: AsOf;
  verdict: SharedVerdict;
  // Names the kind of problem, for the severity table to match on.
  case: string;
  platform_signal: string | null;
  evidence: Evidence[];
  blind_spots: string[];
  detail: D;
}

export function envelope<D>(input: EnvelopeInput<D>, table: SeverityTable): ToolOutput<D> {
  // NFR-009: a problem or an ok with no row behind it never leaves the tool.
  if ((input.verdict === 'problem' || input.verdict === 'ok') && input.evidence.length === 0) {
    throw new ContractViolation(`${input.tool}: verdict ${input.verdict} cites no row`);
  }
  // Partly unknown says what could not be seen; without that it would read as ok.
  if (input.verdict === 'partly_unknown' && input.blind_spots.length === 0) {
    throw new ContractViolation(`${input.tool}: partly_unknown names no blind spot`);
  }
  const { severity, severity_rule } = applySeverity(table, input.tool, input.verdict, input.case);
  return {
    tool: input.tool,
    as_of: input.as_of,
    verdict: input.verdict,
    severity,
    severity_rule,
    platform_signal: input.platform_signal,
    evidence: input.evidence,
    blind_spots: input.blind_spots,
    detail: input.detail,
  };
}
