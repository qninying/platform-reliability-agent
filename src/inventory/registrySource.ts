// Reads, from platform source text, the two lists the registry reconciliation compares: what can fire (the
// scheduler registries, every instrumentCronJob call, every cron.schedule call) and what ai_agents rows code
// creates. Pure functions over text; the caller reads the files.
//
// Platform shape this rests on (platform repo, commit 4443087):
// - SCHEDULE_REGISTRY and DYNAMIC_SCHEDULE_REGISTRY in services/aiOpsScheduler.ts list agentName and
//   hardcodedSchedule per entry; standard entries call entry.runner(), dynamic ones go through instrumentCronJob
//   (aiOpsScheduler.ts:549-574).
// - Rows come from AGENT_REGISTRY in services/agentRegistrySeed.ts, which spreads in GROWTH_JOURNEY_AGENT_ENTRIES
//   and DOMAIN_AGENT_ENTRIES (:2848, :2878); from GOVERNANCE_AGENTS in services/governanceService.ts:5-11, created
//   event_driven (:28); and from agentFactory at run time, which source cannot show. A domain entry that spreads
//   releaseZero() is seeded event_driven and disabled (agentRegistry/domainAgents.ts:66-72).
// - The platform's own reconciler reads AGENT_REGISTRY's literal entries plus the growth-journey entries only
//   (__tests__/fixtures/cronRegistryWorld.ts), so its seed set leaves out the domain and governance rows.

import { scan, inString, lineOf, firstArgument, balanced, type Scanned } from './sourceScan.ts';

export type RowSource = 'seed' | 'growth' | 'domain' | 'governance';
export interface CodeRow { agentName: string; triggerType: string; schedule: string; source: RowSource }
export type RegistryName = 'SCHEDULE_REGISTRY' | 'DYNAMIC_SCHEDULE_REGISTRY';
export interface RegistryEntry { agentName: string; schedule: string; registry: RegistryName; runner: string; line: number }
export interface CronNameSite { file: string; line: number; kind: 'exact' | 'constant' | 'prefix' | 'dynamic'; value: string }
export interface ScheduleSite { file: string; line: number; schedule: string; named: boolean }

// The array literal assigned after `marker`, with comments blanked. Throws when it is missing, so a renamed
// list is an error rather than an empty list.
export function arrayAfter(text: string, marker: string): string {
  const code = scan(text).code;
  const at = code.indexOf(marker);
  if (at < 0) throw new Error(`${marker} not found; the platform source has changed shape`);
  const open = code.indexOf('[', code.indexOf('=', at));
  const arr = open < 0 ? null : balanced(code, open);
  if (!arr) throw new Error(`no array literal after ${marker}`);
  return arr;
}

// The `{...}` objects directly inside an array literal, each with its offset in the array.
export function topObjects(arr: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let depth = 0;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < arr.length && arr[i] !== c) i += arr[i] === '\\' ? 2 : 1;
      continue;
    }
    if ('[({'.includes(c)) {
      if (c === '{' && depth === 1) {
        const obj = balanced(arr, i);
        if (obj) { out.push({ text: obj, at: i }); i += obj.length - 1; continue; }
      }
      depth++;
    } else if (')]}'.includes(c)) depth--;
  }
  return out;
}

// A string property at the object's own level (not inside a nested object), or null.
export function ownString(obj: string, key: string): string | null {
  let depth = 0;
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < obj.length && obj[i] !== c) i += obj[i] === '\\' ? 2 : 1;
      continue;
    }
    if ('[({'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 1 && obj.startsWith(key, i) && !/[A-Za-z0-9_$]/.test(obj[i - 1] ?? '')) {
      const m = /^\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(obj.slice(i + key.length));
      if (m) return m[2];
    }
  }
  return null;
}

const hasOwnSpread = (obj: string, call: string) => new RegExp(`^\\{\\s*(?:[^{}]*,\\s*)?\\.\\.\\.${call}\\(`).test(obj.replace(/\s+/g, ' '));

// Rows from one seed list. With releaseZero, an entry that spreads releaseZero() and states no trigger is
// event_driven, as it is seeded; without it, only the literal trigger_type counts, as the platform's own
// reconciler reads it.
export function seedRows(text: string, marker: string, source: RowSource, releaseZero = true): CodeRow[] {
  return topObjects(arrayAfter(text, marker)).flatMap(({ text: o }) => {
    const name = ownString(o, 'agent_name');
    if (!name) return [];
    const literal = ownString(o, 'trigger_type');
    const trigger = literal ?? (releaseZero && hasOwnSpread(o, 'releaseZero') ? 'event_driven' : '');
    return [{ agentName: name, triggerType: trigger, schedule: ownString(o, 'schedule') ?? '', source }];
  });
}

export function governanceRows(text: string): CodeRow[] {
  return topObjects(arrayAfter(text, 'const GOVERNANCE_AGENTS')).flatMap(({ text: o }) => {
    const name = ownString(o, 'agent_name');
    return name ? [{ agentName: name, triggerType: 'event_driven', schedule: '', source: 'governance' as const }] : [];
  });
}

export function registryEntries(schedulerText: string): RegistryEntry[] {
  const lineBase = (marker: string) => lineOf(schedulerText, schedulerText.indexOf(marker));
  return (['SCHEDULE_REGISTRY', 'DYNAMIC_SCHEDULE_REGISTRY'] as const).flatMap((registry) => {
    const marker = registry === 'SCHEDULE_REGISTRY' ? 'export const SCHEDULE_REGISTRY' : 'const DYNAMIC_SCHEDULE_REGISTRY';
    const arr = arrayAfter(schedulerText, marker);
    const base = lineBase(marker);
    return topObjects(arr).flatMap(({ text: o, at }) => {
      const name = ownString(o, 'agentName');
      if (!name) return [];
      const runner = /\brunner:\s*([^\n]*?),\s*(?:label:|$)/m.exec(o)?.[1]?.trim() ?? (registry === 'DYNAMIC_SCHEDULE_REGISTRY' ? 'instrumentCronJob' : '');
      return [{ agentName: name, schedule: ownString(o, 'hardcodedSchedule') ?? '', registry, runner, line: base + lineOf(arr, at) - 1 }];
    });
  });
}

const IDENT = 'instrumentCronJob';

// Every instrumentCronJob call in code (not in a comment or string), with what its first argument names.
export function cronNameSites(file: string, text: string, s: Scanned = scan(text)): CronNameSite[] {
  const out: CronNameSite[] = [];
  const re = /\binstrumentCronJob\b/g;
  for (let m = re.exec(s.code); m; m = re.exec(s.code)) {
    const at = m.index;
    if (inString(s, at)) continue;
    const before = s.code.slice(Math.max(0, at - 40), at);
    if (/\bfunction\s+$/.test(before)) continue;
    let j = at + IDENT.length;
    while (/\s/.test(s.code[j] ?? '')) j++;
    if (s.code.startsWith('?.', j)) j += 2;
    while (/\s/.test(s.code[j] ?? '')) j++;
    const typeArgs = /^<[^;(){}'"`]{0,200}?>/.exec(s.code.slice(j));
    if (typeArgs) j += typeArgs[0].length;
    while (/\s/.test(s.code[j] ?? '')) j++;
    if (s.code[j] !== '(') continue; // an import or a reference, not a call
    const arg = firstArgument(s.code, j);
    if (!arg || arg.end !== ',') continue;
    const line = lineOf(s.code, at);
    const lit = /^(['"])([A-Za-z0-9_]+)\1$/.exec(arg.text);
    const tpl = /^`([A-Za-z0-9_]+)\$\{/.exec(arg.text);
    if (lit) out.push({ file, line, kind: 'exact', value: lit[2] });
    else if (tpl) out.push({ file, line, kind: 'prefix', value: tpl[1] });
    else if (/^[A-Z][A-Z0-9_]*$/.test(arg.text)) out.push({ file, line, kind: 'constant', value: arg.text });
    else out.push({ file, line, kind: 'dynamic', value: arg.text });
  }
  return out;
}

// `const NAME = 'Value'` anywhere in the given sources, for names passed as a constant.
export function resolveConstant(name: string, sources: Array<{ text: string }>): string | null {
  for (const { text } of sources) {
    const m = new RegExp(`\\b${name}\\s*=\\s*'([A-Za-z0-9_]+)'`).exec(text);
    if (m) return m[1];
  }
  return null;
}

// The slugs of the intel sources the barrel imports, which name the `Intel_${slug}` timers. A source that
// registers itself but whose slug cannot be read is an error, never a silent skip.
export function intelSlugs(barrel: string, readModule: (base: string) => string): string[] {
  const out: string[] = [];
  for (const m of scan(barrel).code.matchAll(/import\s+'\.\/([A-Za-z0-9_]+)'/g)) {
    const text = readModule(m[1]);
    if (!/registerIntelSource\s*\(/.test(text)) continue;
    const slug = /\bSLUG\s*=\s*'([A-Za-z0-9_]+)'/.exec(text);
    if (!slug) throw new Error(`intel source ${m[1]} registers itself but its SLUG cannot be read`);
    out.push(slug[1]);
  }
  return [...new Set(out)].sort();
}

// What can record a run under a name. A callback that calls none of these fires with no name, no ai_agents
// row and no run record.
const NAMED = /\b(?:instrumentCronJob|trackAgentRun|runAgent|logAgentExecution)\s*\(|\bentry\.runner\b|\bwrapWithDeadLetter\s*\(/;

// Every cron.schedule call in code, with its schedule and whether its callback names a run.
export function scheduleSites(file: string, text: string, s: Scanned = scan(text)): ScheduleSite[] {
  const out: ScheduleSite[] = [];
  const re = /\bcron\.schedule\s*\(/g;
  for (let m = re.exec(s.code); m; m = re.exec(s.code)) {
    if (inString(s, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const call = balanced(s.code, open);
    if (!call) continue;
    const first = firstArgument(s.code, open);
    const lit = first && /^(['"])(.+)\1$/.exec(first.text);
    out.push({ file, line: lineOf(s.code, m.index), schedule: lit ? lit[2] : `(${first?.text ?? '?'})`, named: NAMED.test(call) });
  }
  return out;
}

export type Recording = 'instrumentCronJob' | 'trackAgentRun' | 'runAgent' | 'own_row' | 'director_gate' | 'unknown';

// How a standard registry entry's runs are recorded, and under which row: the entry's own name when it goes
// through instrumentCronJob (UNINSTRUMENTED_AGENTS, aiOpsScheduler.ts:549-554); trackAgentRun('<Row>'); a named
// runner in aiOrchestrator.ts that returns runAgent('<Row>') or updates the row it looks up by name (as
// runHealthScans does for CampaignHealthScanner, aiOrchestrator.ts:106); a workforce director's gate, which
// records no run (workforce/workforceAgentRuntime.ts:66-69). Row is null when nothing is recorded or it cannot be read.
export function recordsUnder(entry: RegistryEntry, orchestratorText: string, uninstrumented: Set<string>): { row: string | null; how: Recording } {
  if (entry.registry === 'DYNAMIC_SCHEDULE_REGISTRY' || uninstrumented.has(entry.agentName)) return { row: entry.agentName, how: 'instrumentCronJob' };
  const track = /trackAgentRun\(\s*'([^']+)'/.exec(entry.runner);
  if (track) return { row: track[1], how: 'trackAgentRun' };
  if (/directorActions/.test(entry.runner)) return { row: null, how: 'director_gate' };
  if (!/^\w+$/.test(entry.runner)) return { row: null, how: 'unknown' };
  const code = scan(orchestratorText).code;
  const at = code.search(new RegExp(`export async function ${entry.runner}\\(`));
  const body = at < 0 ? null : balanced(code, code.indexOf('{', code.indexOf(')', at)));
  if (!body) return { row: null, how: 'unknown' };
  const run = /^\{\s*return runAgent\(\s*'([^']+)'/.exec(body);
  if (run) return { row: run[1], how: 'runAgent' };
  // The row's name passed as a constant (runCampaignPerformance, aiOrchestrator.ts:941): the wrapper is known, the row is not read.
  if (/^\{\s*return runAgent\(\s*[A-Z][A-Z0-9_]*\b/.test(body)) return { row: null, how: 'runAgent' };
  const own = /AiAgent\.findOne\(\{\s*where:\s*\{\s*agent_name:\s*'([^']+)'/.exec(body);
  return own ? { row: own[1], how: 'own_row' } : { row: null, how: 'unknown' };
}

export function uninstrumentedAgents(schedulerText: string): Set<string> {
  const m = /const UNINSTRUMENTED_AGENTS = new Set\(\[([\s\S]*?)\]\)/.exec(scan(schedulerText).code);
  return new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);
}
