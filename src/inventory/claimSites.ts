// Where a job defends itself against a second run: a database claim written in its own code, or node-cron's
// noOverlap on its timer. Pure over source text; nothing is run, so a claim Ellis finds is a claim written down,
// not one proved to hold.
//
// Platform and library behaviour this rests on (platform repo, commit bbde6ef; node-cron 4.2.1):
// - The publishing worker's claim is an update conditional on the state it read
//   (services/publishing/publishingWorker.ts:290-295).
// - Other queues claim with FOR UPDATE SKIP LOCKED (services/delivery/execution/executionRunState.ts:147-163).
// - noOverlap blocks a tick while the promise the callback returned is unsettled (node-cron scheduler/runner.js,
//   :70, :113). A callback with braces that starts the job and returns nothing settles at once, so the guard
//   sees no run in flight. It is also per process.

import { scan, inString, lineOf, balanced, type Scanned } from './sourceScan.ts';
import type { Reader } from '../capabilities/registryReconciliation.ts';

export type ClaimKind = 'conditional_update' | 'skip_locked' | 'advisory_lock';
export interface ClaimSite { file: string; line: number; kind: ClaimKind }
export interface LibraryGuard { no_overlap: boolean; callback_holds_run: boolean }

const MARKS: Array<[ClaimKind, RegExp]> = [
  ['skip_locked', /FOR\s+UPDATE\s+SKIP\s+LOCKED/g],
  ['advisory_lock', /pg_try_advisory(?:_xact)?_lock/g],
  ['conditional_update', /\.update\(\s*\{[^}]*\b(state|status):\s*'(?:claimed|running|processing)'[^}]*\}\s*,\s*\{\s*where:\s*\{[^}]*\b\1\b/g],
];
const SOURCE = /\.ts$/;
const skipped = (rel: string) => /(^|\/)(__tests__|node_modules)\//.test(rel) || /\.test\./.test(rel) || /-Ali-AI\.ts$/.test(rel);

export function claimsIn(file: string, text: string): ClaimSite[] {
  const code = scan(text).code;
  return MARKS.flatMap(([kind, re]) => [...code.matchAll(re)].map((m) => ({ file, line: lineOf(code, m.index), kind }))).sort((a, b) => a.line - b.line);
}

// The call text of the first cron.schedule inside `code`, or null.
function scheduleCall(code: string): string | null {
  const m = /\bcron\.schedule\s*\(/.exec(code);
  return m ? balanced(code, m.index + m[0].length - 1) : null;
}

export function libraryGuard(call: string): LibraryGuard {
  // Anchored to the second argument, so an arrow nested inside a braced callback does not count.
  const expression = /^\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`|[\w.]+)\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*(?![\s{])/.test(call);
  const held = /\b(?:await|return)\s+(?:instrumentCronJob|wrapWithDeadLetter|trackAgentRun|runAgent)\b/.test(call);
  return { no_overlap: /\bnoOverlap\s*:\s*true\b/.test(call), callback_holds_run: expression || held };
}

// The guard on one registered cron.schedule, by the line it opens on.
export function guardAtLine(text: string, line: number): LibraryGuard | null {
  const code = scan(text).code;
  const at = code.split('\n').slice(0, line - 1).join('\n').length;
  const call = scheduleCall(code.slice(at));
  return call ? libraryGuard(call) : null;
}

// The guard in a registry's task starter (startStandardTask, startDynamicTask).
export function guardInStarter(text: string, starter: string): LibraryGuard | null {
  const code = scan(text).code;
  const at = code.search(new RegExp(`function ${starter}\\(`));
  const body = at < 0 ? null : balanced(code, code.indexOf('{', code.indexOf(')', at)));
  const call = body && scheduleCall(body);
  return call ? libraryGuard(call) : null;
}

function importsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/(?:import|const)\s*\{([^}]+)\}\s*(?:from\s*|=\s*await\s+import\(\s*)'(\.[^']+)'/g)) {
    for (const n of m[1].split(',')) {
      const local = n.trim().split(/\s+as\s+|\s*:\s*/).at(-1)?.trim();
      if (local) out.set(local, m[2]);
    }
  }
  return out;
}

function resolve(from: string, path: string, known: Set<string>): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  const base = parts.join('/');
  return [`${base}.ts`, `${base}/index.ts`].find((f) => known.has(f)) ?? null;
}

// The start and end of a named function in scanned code, or null when it is not declared here.
function functionSpan(s: Scanned, name: string): [number, number] | null {
  const m = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(s.code);
  if (!m || inString(s, m.index)) return null;
  const params = balanced(s.code, m.index + m[0].length - 1);
  if (params === null) return null;
  const open = s.code.indexOf('{', m.index + m[0].length - 1 + params.length);
  const body = open < 0 ? null : balanced(s.code, open);
  return body === null ? null : [m.index, open + body.length];
}

export interface ClaimIndex { sites: ClaimSite[]; job: (file: string, snippet: string) => ClaimSite[] }

// Reads every source file once. job() follows the names in a timer's snippet one hop, into the function each
// one imports, and returns the claims written inside those functions. A claim deeper than that is not tied to
// the timer; it stays in sites, so the report can say so.
export function claimIndex(r: Reader): ClaimIndex {
  const files = r.list('backend/src').filter((f) => SOURCE.test(f) && !skipped(f));
  const known = new Set(files);
  const cache = new Map<string, { text: string; s: Scanned; claims: ClaimSite[] }>();
  const load = (f: string) => {
    let v = cache.get(f);
    if (!v) {
      const text = r.read(f);
      v = { text, s: scan(text), claims: claimsIn(f, text) };
      cache.set(f, v);
    }
    return v;
  };
  const sites = files.flatMap((f) => load(f).claims);
  const job = (file: string, snippet: string): ClaimSite[] => {
    const imports = importsOf(load(file).text);
    const found = new Map<string, ClaimSite>();
    for (const name of new Set(snippet.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
      const path = imports.get(name);
      const target = path ? resolve(file, path, known) : null;
      if (!target) continue;
      const t = load(target);
      const span = functionSpan(t.s, name);
      if (!span) continue;
      const [a, z] = [lineOf(t.s.code, span[0]), lineOf(t.s.code, span[1])];
      for (const c of t.claims) if (c.line >= a && c.line <= z) found.set(`${c.file}:${c.line}`, c);
    }
    return [...found.values()];
  };
  return { sites, job };
}
