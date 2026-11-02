// platform.scheduler_registration_liveness_probe, first release behaviour (R2):
// reports what decides whether any timer registers at all, and what the probes can see of it. It names the flag
// that gates startScheduler(), the only caller of startAIOpsScheduler(), and whether GET /health could ever fail
// when nothing registered. With a boot log it reports how many timers the AI Ops scheduler says it registered.
// Changing what a probe returns changes external alerting: K.D.'s decision and a deploy. Read-only.
//
// Platform behaviour this rests on (platform repo, commit bbde6ef):
// - startScheduler() runs only under env.enableFollowUpScheduler (server.ts:3631-3632), which is
//   process.env.ENABLE_FOLLOWUP_SCHEDULER === 'true' (config/env.ts:182).
// - startScheduler() loads startAIOpsScheduler with require() and calls it (services/schedulerService.ts:3489-3490);
//   nothing else calls it. aiOpsScheduler-Ali-AI.ts defines a second copy (:322).
// - GET /health runs SELECT 1 and nothing else (routes/healthRoutes.ts:7-15). GET /health/full includes a
//   heartbeat check (services/systemHealthService.ts:136-169): no heartbeat is a warning, over 25 minutes critical.
// - The only record of the registered count is one console line at boot (aiOpsScheduler.ts:796), and the count
//   includes a cron registered inside startAIOpsScheduler outside both registries (:785-794).

import { scan, inString, lineOf, balanced, type Scanned } from '../inventory/sourceScan.ts';
import { registryEntries } from '../inventory/registrySource.ts';
import type { Reader } from './registryReconciliation.ts';

export const FILES = {
  env: 'backend/src/config/env.ts',
  scheduler: 'backend/src/services/aiOpsScheduler.ts',
  health: 'backend/src/routes/healthRoutes.ts',
  healthService: 'backend/src/services/systemHealthService.ts',
} as const;
const SRC = 'backend/src';
const skipped = (rel: string) => !/\.(ts|js)$/.test(rel) || /(^|\/)(__tests__|node_modules)\//.test(rel) || /\.test\./.test(rel);
const BOOT_LINE = /\[AI Ops\] Scheduler started: (\d+) agents scheduled, (\d+) disabled/g;

export interface At { file: string; line: number }
export interface Gate { call_sites: Array<At & { guarded_by: string | null; env_var: string | null }>; flags: Array<{ env_var: string; key: string; defined_at: At | null }>; single_flag: boolean }
export interface AiOpsStart { definitions: Array<At & { called: boolean }>; callers: Array<At & { in_function: string | null }>; only_caller: string | null }
export interface Probe { route: string; at: At | null; consults_scheduler: boolean | null }
export interface Heartbeat { at: At; missing: string | null; warning_after_minutes: number | null; critical_after_minutes: number | null }
export interface Registered { from: 'boot_log' | null; scheduled: number | null; disabled: number | null; boots_in_log: number; counts_outside_registries: At[] }
export interface LivenessAnswer {
  source_commit: string | null;
  gate: Gate;
  ai_ops_start: AiOpsStart;
  public_probe: Probe & { detects_zero_timers: boolean | null };
  full_probe: Probe & { heartbeat: Heartbeat | null };
  registered: Registered;
  registry_entries: number;
  blind_spots: string[];
  statement: string;
  decision: string;
}

const DECISION = 'K.D. approves any change to what a probe returns, and the expected count it fails against. Shipping it is a reviewed deploy. Ellis reports only.';

// The innermost `function name(` whose body holds `at`, or null.
function enclosingFunction(s: Scanned, at: number): string | null {
  let best: { name: string; open: number } | null = null;
  for (const m of s.code.slice(0, at).matchAll(/function\s+(\w+)\s*\(/g)) {
    const open = s.code.indexOf('{', s.code.indexOf(')', m.index));
    const body = open < 0 ? null : balanced(s.code, open);
    if (body && open < at && open + body.length > at && (!best || open > best.open)) best = { name: m[1], open };
  }
  return best?.name ?? null;
}

// The condition of the innermost `if (...) {` whose block holds `at`, or null.
function enclosingIf(s: Scanned, at: number): string | null {
  let best: { cond: string; open: number } | null = null;
  for (const m of s.code.slice(0, at).matchAll(/\bif\s*\(/g)) {
    const paren = m.index + m[0].length - 1;
    const cond = balanced(s.code, paren);
    if (!cond) continue;
    const open = paren + cond.length;
    const brace = /^\s*\{/.exec(s.code.slice(open));
    if (!brace) continue;
    const blockOpen = open + brace[0].length - 1;
    const block = balanced(s.code, blockOpen);
    if (block && blockOpen < at && blockOpen + block.length > at && (!best || blockOpen > best.open)) best = { cond: cond.slice(1, -1).trim(), open: blockOpen };
  }
  return best?.cond ?? null;
}

// Calls of `name(` in code, not in a string or comment, and not its own definition.
function calls(s: Scanned, name: string): number[] {
  return [...s.code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))]
    .filter((m) => !inString(s, m.index) && !/\bfunction\s+$/.test(s.code.slice(Math.max(0, m.index - 20), m.index)))
    .map((m) => m.index);
}

export function gate(sources: Array<{ file: string; text: string; s: Scanned }>, envText: string): Gate {
  const env = scan(envText);
  const keys = new Map<string, { env_var: string; line: number }>();
  for (const m of env.code.matchAll(/(\w+)\s*:\s*process\.env\.(\w+)\s*===\s*'true'/g)) keys.set(m[1], { env_var: m[2], line: lineOf(envText, m.index) });
  const call_sites = sources.flatMap(({ file, text, s }) => calls(s, 'startScheduler').map((at) => {
    const cond = enclosingIf(s, at);
    const key = cond && /^env\.(\w+)$/.exec(cond)?.[1];
    return { file, line: lineOf(text, at), guarded_by: cond, env_var: key ? keys.get(key)?.env_var ?? null : null };
  }));
  const flagKeys = [...new Set(call_sites.map((c) => c.guarded_by && /^env\.(\w+)$/.exec(c.guarded_by)?.[1]).filter((k): k is string => !!k))];
  const flags = flagKeys.map((key) => ({ key, env_var: keys.get(key)?.env_var ?? '', defined_at: keys.has(key) ? { file: FILES.env, line: keys.get(key)!.line } : null }));
  const single_flag = call_sites.length > 0 && call_sites.every((c) => c.env_var !== null) && new Set(call_sites.map((c) => c.env_var)).size === 1;
  return { call_sites, flags, single_flag };
}

export function aiOpsStart(sources: Array<{ file: string; text: string; s: Scanned }>): AiOpsStart {
  const definitions = sources.flatMap(({ file, text, s }) => [...s.code.matchAll(/function\s+startAIOpsScheduler\s*\(/g)].map((m) => ({ file, line: lineOf(text, m.index), called: false })));
  const callers = sources.flatMap(({ file, text, s }) => calls(s, 'startAIOpsScheduler').map((at) => {
    const near = s.code.slice(Math.max(0, at - 400), at);
    const from = /require\(\s*'\.\/(aiOpsScheduler[\w-]*)'\s*\)\s*;?\s*$/.exec(near.trimEnd()) ?? [...near.matchAll(/require\(\s*'\.\/(aiOpsScheduler[\w-]*)'\s*\)/g)].at(-1) ?? null;
    const target = from ? `backend/src/services/${from[1]}.ts` : null;
    for (const d of definitions) if (d.file === (target ?? FILES.scheduler)) d.called = true;
    return { file, line: lineOf(text, at), in_function: enclosingFunction(s, at) };
  }));
  const only_caller = callers.length === 1 ? callers[0].in_function : null;
  return { definitions, callers, only_caller };
}

function routeAt(text: string, path: string): { at: number; body: string } | null {
  const s = scan(text);
  const m = new RegExp(`router\\.get\\(\\s*'${path.replace('/', '\\/')}'`).exec(s.code);
  if (!m) return null;
  const open = s.code.indexOf('(', m.index);
  return { at: m.index, body: balanced(s.code, open) ?? '' };
}

export function probes(healthText: string, serviceText: string): Pick<LivenessAnswer, 'public_probe' | 'full_probe'> {
  const pub = routeAt(healthText, '/health');
  const full = routeAt(healthText, '/health/full');
  const SCHED = /scheduler|heartbeat|registered/i;
  const consults = pub ? SCHED.test(pub.body) : null;
  const svc = scan(serviceText);
  const fn = /function\s+checkSchedulerLiveness\s*\(/.exec(svc.code);
  let heartbeat: Heartbeat | null = null;
  if (fn) {
    const body = balanced(svc.code, svc.code.indexOf('{', svc.code.indexOf(')', fn.index))) ?? '';
    const text = serviceText.slice(svc.code.indexOf('{', svc.code.indexOf(')', fn.index)), svc.code.indexOf('{', svc.code.indexOf(')', fn.index)) + body.length);
    const missing = /if\s*\(\s*!heartbeat\s*\)\s*\{[\s\S]*?severity:\s*'(\w+)'/.exec(text)?.[1] ?? null;
    // Each `ageMinutes > N) {` takes the severity of the first check its own block pushes.
    const steps = [...text.matchAll(/ageMinutes\s*>\s*(\d+)\s*\)\s*\{/g)].map((m) => ({ n: Number(m[1]), sev: /severity:\s*'(\w+)'/.exec(text.slice(m.index))?.[1] }));
    const limit = (sev: string) => steps.find((x) => x.sev === sev)?.n ?? null;
    heartbeat = { at: { file: FILES.healthService, line: lineOf(serviceText, fn.index) }, missing, warning_after_minutes: limit('warning'), critical_after_minutes: limit('critical') };
  }
  return {
    public_probe: { route: 'GET /health', at: pub ? { file: FILES.health, line: lineOf(healthText, pub.at) } : null, consults_scheduler: consults, detects_zero_timers: consults === null ? null : consults },
    full_probe: { route: 'GET /health/full', at: full ? { file: FILES.health, line: lineOf(healthText, full.at) } : null, consults_scheduler: full ? /runFullSystemHealthCheck/.test(full.body) && !!heartbeat : null, heartbeat },
  };
}

// cron.schedule calls inside startAIOpsScheduler: registered and counted at boot, but in neither registry.
export function outsideRegistries(schedulerText: string): At[] {
  const s = scan(schedulerText);
  const fn = /function\s+startAIOpsScheduler\s*\(/.exec(s.code);
  if (!fn) return [];
  const open = s.code.indexOf('{', s.code.indexOf(')', fn.index));
  const body = balanced(s.code, open) ?? '';
  return [...body.matchAll(/\bcron\.schedule\s*\(/g)].map((m) => ({ file: FILES.scheduler, line: lineOf(schedulerText, open + m.index) }));
}

export function fromBootLog(log: string | null, schedulerText: string): Registered {
  const extra = outsideRegistries(schedulerText);
  if (log === null) return { from: null, scheduled: null, disabled: null, boots_in_log: 0, counts_outside_registries: extra };
  const boots = [...log.matchAll(BOOT_LINE)];
  const last = boots.at(-1);
  return { from: 'boot_log', scheduled: last ? Number(last[1]) : null, disabled: last ? Number(last[2]) : null, boots_in_log: boots.length, counts_outside_registries: extra };
}

export function liveness(r: Reader, commit: string | null, bootLog: string | null): LivenessAnswer {
  const sources = r.list(SRC).filter((f) => !skipped(f)).map((file) => { const text = r.read(file); return { file, text, s: scan(text) }; });
  const schedulerText = r.read(FILES.scheduler);
  const g = gate(sources, r.read(FILES.env));
  const a = aiOpsStart(sources);
  const p = probes(r.read(FILES.health), r.read(FILES.healthService));
  const reg = fromBootLog(bootLog, schedulerText);
  const printsCount = /Scheduler started: \$\{scheduledCount\} agents scheduled/.test(schedulerText);
  const blind: string[] = [];
  if (reg.from === null) blind.push(`no boot log was given, so the number of timers the running process registered is not known here. The only record of it is one console line at boot${printsCount ? '' : ', and that line was not found in this source'}; no endpoint or table holds it.`);
  else if (reg.scheduled === null) blind.push('the boot log holds no "[AI Ops] Scheduler started" line: either the scheduler never started in that log, or the log does not cover a boot. Ellis cannot tell which.');
  blind.push('a registered timer is not a fired one: this reports registration only, never execution.');
  blind.push('the boot line counts the AI Ops scheduler only. Timers registered inline in schedulerService.ts are not in it.');
  if (reg.counts_outside_registries.length) blind.push(`the boot count includes ${reg.counts_outside_registries.length} cron registered inside startAIOpsScheduler outside both registries (${reg.counts_outside_registries.map((x) => `${x.file}:${x.line}`).join(', ')}), so it is not a count of registry entries.`);
  blind.push('no expected count is pinned in the platform, so a shortfall cannot be judged, only zero.');
  const flag = g.single_flag ? g.flags[0].env_var : null;
  const parts = [
    flag ? `${flag} is the single flag: every startScheduler() call (${g.call_sites.map((c) => `${c.file}:${c.line}`).join(', ')}) runs only when it is 'true'.` : `No single flag gates startScheduler(): ${g.call_sites.length} call site(s), guarded by ${[...new Set(g.call_sites.map((c) => c.guarded_by ?? 'nothing'))].join(', ')}.`,
    a.only_caller ? `${a.only_caller}() is the only caller of startAIOpsScheduler() (${a.callers[0].file}:${a.callers[0].line}).` : `startAIOpsScheduler() has ${a.callers.length} caller(s).`,
    p.public_probe.detects_zero_timers === false ? 'GET /health never consults the scheduler, so it returns 200 when no timer registered.' : p.public_probe.detects_zero_timers ? 'GET /health refers to the scheduler.' : 'GET /health was not found.',
    reg.scheduled !== null ? `The last boot in the log registered ${reg.scheduled} AI Ops timers (${reg.disabled} disabled).` : '',
  ].filter(Boolean);
  return {
    source_commit: commit, gate: g, ai_ops_start: a, ...p, registered: reg,
    registry_entries: registryEntries(schedulerText).length,
    blind_spots: blind, statement: parts.join(' '), decision: DECISION,
  };
}
