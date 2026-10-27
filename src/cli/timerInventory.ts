// Usage: node src/cli/timerInventory.ts --source <platform checkout> [--commit <sha>]
// Builds a control snapshot of the timers run through the cron wrapper outside aiOpsScheduler.ts, with the
// ai_agents rows created in code, for disable-recommendation --pause-gaps. Reads the checkout only; it never
// writes to it. Exit code 0 when every call site was resolved, 3 when any was not, 1 for bad input.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { extractCronSites, extractSeedRows, stringConstants, type Unresolved } from '../inventory/cronSites.ts';
import type { ControlSnapshot, TimerRow } from '../capabilities/agentEnableDisableControl.ts';

const { values } = parseArgs({ options: { source: { type: 'string' }, commit: { type: 'string' } } });

// The files that register cron-wrapped timers, and the files that create ai_agents rows (platform commit 7c70f0a).
const CRON_FILES = ['backend/src/services/schedulerService.ts', 'backend/src/services/scheduling/growthJourneyCrons.ts'];
const SEED_FILES = ['backend/src/services/agentRegistrySeed.ts', 'backend/src/services/agentRegistry/growthJourneyAgents.ts', 'backend/src/services/agentRegistry/domainAgents.ts'];
const GOVERNANCE_FILE = 'backend/src/services/governanceService.ts';

class InputError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation';
  constructor(errorClass: InputError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

function read(root: string, rel: string): string {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch (err) {
    throw new InputError('SourceUnavailable', `${rel} could not be read under ${root}: ${(err as Error).message}`);
  }
}

// Constants a file imports by name from a relative path, read from that file.
function importedConstants(root: string, rel: string, text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/gm)) {
    const names = m[1].split(',').map((n) => n.trim()).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n));
    if (names.length === 0) continue;
    const consts = stringConstants(read(root, join(dirname(rel), `${m[2]}.ts`)));
    for (const n of names) if (consts.has(n)) out.set(n, consts.get(n)!);
  }
  return out;
}

try {
  if (!values.source) throw new InputError('ContractViolation', 'missing --source <platform checkout>');
  const root = resolve(values.source);
  const timers: TimerRow[] = [];
  const unresolved: Unresolved[] = [];
  for (const rel of CRON_FILES) {
    const text = read(root, rel);
    const sites = extractCronSites(text, rel, importedConstants(root, rel, text));
    timers.push(...sites.timers);
    unresolved.push(...sites.unresolved);
  }
  const snap: ControlSnapshot = {
    captured_at: new Date().toISOString(),
    captured_by: `built from platform source${values.commit ? ` at ${values.commit}` : ''}: cron-wrapped timers outside aiOpsScheduler.ts, and the ai_agents rows created in code (seed and governance agents, enabled as seeded). Production may hold rows the code does not create.`,
    timers,
    ai_agents: extractSeedRows(SEED_FILES.map((f) => read(root, f)), read(root, GOVERNANCE_FILE)),
    cron_schedule_configs: [],
    requests: [],
  };
  console.log(JSON.stringify({ ...snap, unresolved }, null, 2));
  process.exit(unresolved.length === 0 ? 0 : 3);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
