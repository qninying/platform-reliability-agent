// Where each timer lives, read from a platform checkout: in one of the two aiOps registries the governance
// screen can reload, or registered inline with cron.schedule. Pure over a Reader; nothing here touches the
// platform.
//
// Platform behaviour this rests on (platform repo, commit c96f6a6):
// - reloadAIOpsSchedules reconciles SCHEDULE_REGISTRY and DYNAMIC_SCHEDULE_REGISTRY only
//   (services/aiOpsScheduler.ts:632-645), against task handles it keeps for those two (:149). A timer
//   registered anywhere else keeps no handle, so the reload cannot stop, start or reschedule it.
// - The governance key is the registry entry's agentName (:647-649), which need not be the ai_agents row its
//   runs record under: a runner can record under another name (recordsUnder, registrySource.ts).
// - Inline timers name their run through instrumentCronJob('<Name>'), a constant, or a name built at run time
//   (`Intel_${slug}`, schedulerService.ts); some name it through trackAgentRun or runAgent instead.

import { registryEntries, cronNameSites, scheduleSites, resolveConstant, intelSlugs, recordsUnder, uninstrumentedAgents, type RegistryEntry, type ScheduleSite, type Recording } from './registrySource.ts';
import { scan, inString, lineOf, balanced } from './sourceScan.ts';
import type { Reader } from '../capabilities/registryReconciliation.ts';

export interface RegistryHome extends RegistryEntry { row: string | null; how: Recording }
export interface InlineSite { name: string; file: string; line: number; schedule: string | null; schedule_line: number | null }
export interface Site { file: string; line: number; text: string }
export interface TimerIndex {
  source_commit: string | null;
  files_read: number;
  registry: RegistryHome[];
  inline: InlineSite[];
  // instrumentCronJob calls outside the registries whose name is built at run time and could not be listed.
  unlisted: Site[];
  // trackAgentRun('<Name>') or runAgent('<Name>') outside the two registry files, not tied to a timer here.
  namedCalls: Array<Site & { name: string }>;
  // Every cron.schedule call in code.
  scheduleSites: ScheduleSite[];
  // Where wrapWithDeadLetter is applied: in each registry's task starter (null when the starter cannot be read),
  // and anywhere else.
  deadLetter: { standard: boolean | null; dynamic: boolean | null; other: Site[] };
}

const SRC = 'backend/src';
const S = `${SRC}/services`;
const SCHEDULER = `${S}/aiOpsScheduler.ts`;
const ORCHESTRATOR = `${S}/aiOrchestrator.ts`;
const SOURCE_FILE = /\.(ts|js)$/;
const skipped = (rel: string) => /(^|\/)(__tests__|node_modules)\//.test(rel) || /\.test\./.test(rel) || /-Ali-AI\.ts$/.test(rel);
// How far above an instrumentCronJob call its cron.schedule may open, as in cronSites.ts.
const SCHEDULE_WINDOW_LINES = 15;

function starterCalls(schedulerCode: string, starter: string): boolean | null {
  const at = schedulerCode.search(new RegExp(`function ${starter}\\(`));
  const body = at < 0 ? null : balanced(schedulerCode, schedulerCode.indexOf('{', schedulerCode.indexOf(')', at)));
  return body === null ? null : /\bwrapWithDeadLetter\s*\(/.test(body);
}

export function timerIndex(r: Reader, commit: string | null): TimerIndex {
  const scheduler = r.read(SCHEDULER);
  const orchestrator = r.read(ORCHESTRATOR);
  const uninstrumented = uninstrumentedAgents(scheduler);
  const registry = registryEntries(scheduler).map((e) => ({ ...e, ...recordsUnder(e, orchestrator, uninstrumented) }));
  const files = r.list(SRC).filter((f) => SOURCE_FILE.test(f) && !skipped(f));
  const sources = files.map((file) => ({ file, text: r.read(file) }));
  const inline: InlineSite[] = [];
  const unlisted: Site[] = [];
  const namedCalls: TimerIndex['namedCalls'] = [];
  const allSchedules: ScheduleSite[] = [];
  const wrapped: Site[] = [];
  let slugs: string[] | null = null;
  for (const { file, text } of sources) {
    const s = scan(text);
    const schedules = scheduleSites(file, text, s);
    allSchedules.push(...schedules);
    const scheduleFor = (line: number) => schedules.filter((x) => x.line <= line && line - x.line <= SCHEDULE_WINDOW_LINES).at(-1) ?? null;
    for (const m of s.code.matchAll(/\bwrapWithDeadLetter\s*\(/g)) {
      if (inString(s, m.index) || /\bfunction\s+$/.test(s.code.slice(Math.max(0, m.index - 20), m.index))) continue;
      if (file !== SCHEDULER) wrapped.push({ file, line: lineOf(s.code, m.index), text: 'wrapWithDeadLetter' });
    }
    for (const n of cronNameSites(file, text, s)) {
      // The registry's own wrapper call (startDynamicTask) names entry.agentName; the registry rows cover it.
      if (file === SCHEDULER && n.kind === 'dynamic' && n.value === 'entry.agentName') continue;
      const site = scheduleFor(n.line);
      const at = { file, line: n.line, schedule: site?.schedule ?? null, schedule_line: site?.line ?? null };
      if (n.kind === 'exact') inline.push({ name: n.value, ...at });
      else if (n.kind === 'constant') {
        const v = resolveConstant(n.value, sources);
        if (v) inline.push({ name: v, ...at });
        else unlisted.push({ file, line: n.line, text: n.value });
      } else if (n.kind === 'prefix' && n.value === 'Intel_') {
        slugs ??= intelSlugs(r.read(`${S}/intel/sources/index.ts`), (base) => r.read(`${S}/intel/sources/${base}.ts`));
        for (const sl of slugs) inline.push({ name: `Intel_${sl}`, ...at });
      } else unlisted.push({ file, line: n.line, text: n.value });
    }
    if (file === SCHEDULER || file === ORCHESTRATOR) continue;
    for (const m of s.code.matchAll(/\b(trackAgentRun|runAgent)\(\s*'([A-Za-z0-9_]+)'/g)) {
      namedCalls.push({ name: m[2], file, line: text.slice(0, m.index).split('\n').length, text: m[1] });
    }
  }
  const schedulerCode = scan(scheduler).code;
  const deadLetter = { standard: starterCalls(schedulerCode, 'startStandardTask'), dynamic: starterCalls(schedulerCode, 'startDynamicTask'), other: wrapped };
  return { source_commit: commit, files_read: files.length, registry, inline, unlisted, namedCalls, scheduleSites: allSchedules, deadLetter };
}

export type Home = 'aiops_registry' | 'inline' | 'registry_and_inline' | 'unknown';
export interface HomeAnswer { home: Home; registry: RegistryHome[]; inline: InlineSite[]; unknown_because: string | null }

// A target is the name a person knows a job by: a registry agentName, or the ai_agents row its runs record under.
export function homeOf(ix: TimerIndex, target: string): HomeAnswer {
  const registry = ix.registry.filter((e) => e.agentName === target || e.row === target);
  const inline = ix.inline.filter((s) => s.name === target);
  if (registry.length && inline.length) return { home: 'registry_and_inline', registry, inline, unknown_because: null };
  if (registry.length) return { home: 'aiops_registry', registry, inline, unknown_because: null };
  if (inline.length) return { home: 'inline', registry, inline, unknown_because: null };
  const named = ix.namedCalls.filter((c) => c.name === target);
  const why = named.length
    ? `${target} is named at ${named.map((c) => `${c.file}:${c.line} (${c.text})`).join(', ')}, but Ellis could not tie that call to a timer`
    : `no timer in the ${ix.files_read} source files read registers under ${target}`;
  const tail = ix.unlisted.length ? `; ${ix.unlisted.length} timer(s) build their name at run time and could be it (${ix.unlisted.map((u) => `${u.file}:${u.line}`).join(', ')})` : '';
  return { home: 'unknown', registry, inline, unknown_because: why + tail };
}
