// Builds the timer inventory for the cron wrapper from platform source text, so the disable and pause answers
// cover every timer, not only the aiOpsScheduler.ts registry. Pure functions over text: reading the files is
// the caller's job, and nothing here touches the platform.
//
// Platform shape this rests on (platform repo, commit 7c70f0a):
// - schedulerService.ts and scheduling/growthJourneyCrons.ts register timers as cron.schedule('<expr>', () => {
//   instrumentCronJob('<Name>', ...) }), sometimes with the schedule on the next line or the name in a constant.
// - The intel sources build their names at run time (instrumentCronJob(`Intel_${src.slug}`),
//   schedulerService.ts:2143), so they cannot be listed from source and are reported as unresolved.
// - ai_agents rows come from the registry seed (agentRegistrySeed.ts, one entry per `agent_name`), the
//   governance agents (governanceService.ts:5-11) and agentFactory at run time. The seed also spreads in
//   GROWTH_JOURNEY_AGENT_ENTRIES and DOMAIN_AGENT_ENTRIES from agentRegistry/ (agentRegistrySeed.ts:2846,
//   :2876), so every one of those files is read. A name with no row here has no row in code; production may
//   still hold one.

import type { TimerRow, ControlAgentRow } from '../capabilities/agentEnableDisableControl.ts';

export interface Unresolved { ref: string; reason: string }
export interface CronSites { timers: TimerRow[]; unresolved: Unresolved[] }

// How far back from an instrumentCronJob call to look for the cron.schedule that registers it.
const SCHEDULE_WINDOW_LINES = 15;

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function scheduleAt(lines: string[], i: number, consts: Map<string, string>): string | null {
  const joined = lines.slice(i, i + 3).join(' ');
  const m = joined.match(/cron\.schedule\(\s*(?:(['"`])([^'"`]+)\1|([A-Z][A-Z0-9_]*)\b)/);
  if (!m) return null;
  return m[2] ?? consts.get(m[3]) ?? null;
}

// `const NAME = 'value'` declarations in a file, for resolving a name or schedule passed as a constant.
export function stringConstants(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/gm)) out.set(m[1], m[2]);
  return out;
}

// importedConsts holds constants this file imports from elsewhere; the caller reads those files.
export function extractCronSites(text: string, file: string, importedConsts: Map<string, string> = new Map()): CronSites {
  const lines = text.split('\n');
  const consts = new Map([...importedConsts, ...stringConstants(text)]);
  const timers: TimerRow[] = [];
  const unresolved: Unresolved[] = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const call = line.match(/instrumentCronJob\(\s*(?:(['"])([^'"]+)\1|(`[^`]*`)|([A-Za-z_][A-Za-z0-9_.]*))/);
    if (!call) return;
    const ref = `${file}:${i + 1}`;
    let name: string | null = call[2] ?? null;
    if (!name && call[4]) name = consts.get(call[4]) ?? null;
    if (!name) {
      unresolved.push({ ref, reason: call[3] ? `name is built at run time (${call[3]})` : `name is the identifier ${call[4]}, which could not be resolved` });
      return;
    }
    let schedule: string | null = null;
    for (let j = i; j >= Math.max(0, i - SCHEDULE_WINDOW_LINES); j--) {
      if (lines[j].includes('cron.schedule(') && !isComment(lines[j])) { schedule = scheduleAt(lines, j, consts) ?? 'not a literal'; break; }
    }
    if (!schedule) {
      unresolved.push({ ref, reason: `${name}: no cron.schedule within ${SCHEDULE_WINDOW_LINES} lines above` });
      return;
    }
    timers.push({ timer: name, schedule, label: name, ref, gates: [{ gate: 'instrument_cron_job', flag: name }] });
  });
  return { timers, unresolved };
}

// Rows created in code: the registry seed's entries and the governance agents. enabled is as seeded
// (the column defaults to true, models/AiAgent.ts:423-427); production may have changed it since. A domain
// agent spreads releaseZero() above its name, which seeds it disabled (agentRegistry/domainAgents.ts:66-72).
export function extractSeedRows(seedTexts: string[], governanceText: string): ControlAgentRow[] {
  const rows: ControlAgentRow[] = [];
  for (const seed of seedTexts.map((t) => t.split('\n'))) {
    seed.forEach((line, i) => {
      const m = line.match(/^ {4}agent_name: '([^']+)'/);
      if (!m) return;
      let enabled = true;
      for (let j = i - 1; j >= 0 && !/^ {2}\{\s*$/.test(seed[j]); j--) {
        if (/^ {4}\.\.\.releaseZero\(\),/.test(seed[j])) enabled = false;
      }
      for (let j = i + 1; j < seed.length && !/^ {2}\},?\s*$/.test(seed[j]) && !/^ {4}agent_name: /.test(seed[j]); j++) {
        const e = seed[j].match(/^ {4}enabled: (true|false)/);
        if (e) enabled = e[1] === 'true';
      }
      rows.push({ id: `seed:${m[1]}`, agent_name: m[1], enabled, status: 'idle' });
    });
  }
  for (const m of governanceText.matchAll(/\{\s*agent_name: '([^']+)'/g)) {
    rows.push({ id: `governance:${m[1]}`, agent_name: m[1], enabled: true, status: 'idle' });
  }
  return rows;
}
