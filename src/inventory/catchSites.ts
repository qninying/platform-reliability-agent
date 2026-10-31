// Every place a file catches a failure, and what the handler does with it. Pure over source text.
//
// A handler is read by what it names, never run. Being a text reading, it reports a handler passed by name as
// not_read rather than guessing what that function does.

import { scan, inString, lineOf, balanced } from './sourceScan.ts';

export type CatchKind = 'records_class' | 'class_may_be_generic' | 'records_no_class' | 'rethrows' | 'logs_only' | 'silent' | 'not_read';
export interface CatchSite { file: string; line: number; kind: CatchKind }

const CLASS = /\b(error_class|errorClass|classifyError)\b/;
// A class taken from the constructor, or falling back to a generic string, is not a class of cause.
const FALLBACK = /constructor\??\.name|\|\|\s*['"](Error|Unknown)['"]/;
const RECORDS = /\b(logAiEvent|emitAiEvent|logAgentActivity|AiAgentActivityLog|DeadLetterJob|emitAlert|completeRunPreservingControls|last_error|error_count)\b|\bresult\s*=\s*['"]failed['"]/;
const LOGS = /\b(console|logger)\.\w+\(/;
const THROWS = /\bthrow\b/;

export function kindOf(handler: string): CatchKind {
  if (CLASS.test(handler)) return FALLBACK.test(handler) ? 'class_may_be_generic' : 'records_class';
  if (RECORDS.test(handler)) return 'records_no_class';
  if (THROWS.test(handler)) return 'rethrows';
  if (LOGS.test(handler)) return 'logs_only';
  return 'silent';
}

// Set onlyInTimers for a file that is not all cron code: only handlers inside a cron.schedule callback count.
export function catchSites(file: string, text: string, onlyInTimers = false): CatchSite[] {
  const s = scan(text);
  const timers = [...s.code.matchAll(/\bcron\.schedule\s*\(/g)].map((m) => {
    const open = m.index + m[0].length - 1;
    return [open, open + (balanced(s.code, open) ?? '').length] as const;
  });
  const counts = (at: number) => !onlyInTimers || timers.some(([a, z]) => at > a && at < z);
  const out: CatchSite[] = [];
  for (const m of s.code.matchAll(/(\.?)\bcatch\b\s*(?:\([^)]*\)\s*)?\{/g)) {
    if (m[1] || inString(s, m.index) || !counts(m.index)) continue;
    const open = m.index + m[0].length - 1;
    const body = balanced(s.code, open);
    out.push({ file, line: lineOf(s.code, m.index), kind: body === null ? 'not_read' : kindOf(body) });
  }
  for (const m of s.code.matchAll(/\.catch\s*\(/g)) {
    if (inString(s, m.index) || !counts(m.index)) continue;
    const args = balanced(s.code, m.index + m[0].length - 1);
    const inline = args !== null && /=>|\bfunction\b/.test(args);
    out.push({ file, line: lineOf(s.code, m.index), kind: inline ? kindOf(args) : 'not_read' });
  }
  return out.sort((a, b) => a.line - b.line);
}
