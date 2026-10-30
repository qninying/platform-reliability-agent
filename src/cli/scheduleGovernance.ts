// Usage: node src/cli/scheduleGovernance.ts --source <platform checkout> --snapshot <records.json>
//          [--propose '<Name>=<cron>' ...] [--disable <Name> ...] [--window-days 7]
// Proposes schedule changes, each with the measured run cost and signal rate behind it and where the timer
// lives: the reloadable aiOps registry, inline in schedulerService.ts (restart only), both, or unknown. With no
// ask it sweeps for jobs that failed every run in the window. Reads only; a person applies any change. Exit
// code 0 when every proposal has a known home, 3 when one has an unknown home, 4 when there is nothing to
// propose, 1 for bad input.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { propose, TABLES, type Ask, type GovernanceSnapshot } from '../capabilities/scheduleGovernance.ts';
import { timerIndex } from '../inventory/timerHomes.ts';
import { parseCron } from '../inventory/cronExpression.ts';
import { InputError, reader, commitOf, requireCheckout } from './checkout.ts';

const { values } = parseArgs({ options: {
  source: { type: 'string' }, snapshot: { type: 'string' },
  propose: { type: 'string', multiple: true }, disable: { type: 'string', multiple: true }, 'window-days': { type: 'string' },
} });

function load(path: string): GovernanceSnapshot {
  let s: Partial<GovernanceSnapshot>;
  try {
    s = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new InputError('ContractViolation', `${path} could not be read as JSON: ${(err as Error).message}`);
  }
  if (typeof s.captured_at !== 'string' || Number.isNaN(Date.parse(s.captured_at))) throw new InputError('ContractViolation', `${path} needs captured_at as a date`);
  for (const t of TABLES) {
    if (!Array.isArray(s[t])) throw new InputError('ContractViolation', `${path} needs ${t}[] (use [] when empty); a missing table is not an empty one`);
  }
  return s as GovernanceSnapshot;
}

function asks(): Ask[] {
  const out: Ask[] = [];
  for (const p of values.propose ?? []) {
    const m = /^([A-Za-z0-9_]+)=(.+)$/.exec(p);
    if (!m) throw new InputError('ContractViolation', `--propose needs '<Name>=<cron>', got '${p}'`);
    if (!parseCron(m[2].trim())) throw new InputError('ContractViolation', `'${m[2]}' is not a five-field cron expression Ellis can read`);
    out.push({ target: m[1], change: { schedule: m[2].trim() } });
  }
  for (const d of values.disable ?? []) {
    if (!/^[A-Za-z0-9_]+$/.test(d)) throw new InputError('ContractViolation', `--disable needs a job name, got '${d}'`);
    out.push({ target: d, change: { enabled: false } });
  }
  return out;
}

try {
  const source = requireCheckout(values.source);
  if (!values.snapshot) throw new InputError('ContractViolation', 'needs --snapshot');
  const windowDays = values['window-days'] === undefined ? 7 : Number(values['window-days']);
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new InputError('ContractViolation', '--window-days needs a whole number of days, 1 or more');
  const wanted = asks();
  const snap = load(values.snapshot);
  const ix = timerIndex(reader(source), commitOf(source));
  const answer = propose(ix, snap, wanted, { window_days: windowDays });
  console.log(JSON.stringify({ snapshot: { captured_at: snap.captured_at, captured_by: snap.captured_by }, ...answer }, null, 2));
  process.exit(!answer.proposals.length ? 4 : answer.proposals.some((p) => p.home === 'unknown') ? 3 : 0);
} catch (err) {
  const e = err as Error & { errorClass?: string };
  console.error(JSON.stringify({ error_class: e.errorClass ?? e.name, message: e.message }));
  process.exit(1);
}
