// The twice-run harness. It runs a job once, then twice in a row, then twice at once, each from a fresh copy of the
// same fixture, and compares the end states. Nothing here reaches a database, a provider or the network: a job
// gets only the in-memory world it is handed.
//
// If it cannot fail, it cannot pass. A job that changed nothing on its first run proves nothing, and a job that
// threw did not finish, so both are unknown rather than safe.

export interface Row { id: string; [column: string]: unknown }
export interface Fixture { rows: Row[] }
export interface ExternalEffect { row_id: string; kind: string }

export class World {
  readonly rows: Map<string, Row>;
  readonly effects: ExternalEffect[] = [];
  constructor(fixture: Fixture) { this.rows = new Map(fixture.rows.map((r) => [r.id, structuredClone(r)])); }
  // A yield between steps, so two concurrent runs interleave at every await, in a fixed order.
  tick(): Promise<void> { return new Promise((done) => { setImmediate(done); }); }
  read(where: (r: Row) => boolean): Row[] { return [...this.rows.values()].filter(where).map((r) => structuredClone(r)); }
  // Updates only if the row still matches, and says how many rows moved: an optimistic claim.
  update(id: string, when: (r: Row) => boolean, change: Partial<Row>): number {
    const row = this.rows.get(id);
    if (!row || !when(row)) return 0;
    Object.assign(row, change);
    return 1;
  }
  // Adds a row unless one with its id exists, as a primary key would, and says whether it did.
  insert(row: Row): number {
    if (this.rows.has(row.id)) return 0;
    this.rows.set(row.id, structuredClone(row));
    return 1;
  }
  // Removes a row only if it still matches, and says whether it did.
  remove(id: string, when: (r: Row) => boolean): number {
    const row = this.rows.get(id);
    if (!row || !when(row)) return 0;
    this.rows.delete(id);
    return 1;
  }
  emit(effect: ExternalEffect): void { this.effects.push(effect); }
}

export type Job = (w: World, worker: string) => Promise<void>;
export type Mode = 'safe' | 'unsafe' | 'unknown';
export interface Check { mode: Mode; why: string; differences: string[] }

export function endState(w: World): string {
  const canon = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v);
  const effects = w.effects.map((e) => `${e.row_id}:${e.kind}`).sort();
  return JSON.stringify({ rows: [...w.rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(canon), effects });
}

function differences(one: World, other: World): string[] {
  const out: string[] = [];
  const count = (w: World) => { const m = new Map<string, number>(); for (const e of w.effects) m.set(`${e.row_id}:${e.kind}`, (m.get(`${e.row_id}:${e.kind}`) ?? 0) + 1); return m; };
  const a = count(one), b = count(other);
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) if (a.get(k) !== b.get(k)) out.push(`${k}: ${a.get(k) ?? 0} after one run, ${b.get(k) ?? 0} after this`);
  for (const [id, row] of one.rows) if (JSON.stringify(row) !== JSON.stringify(other.rows.get(id))) out.push(`row ${id} differs`);
  return out;
}

const worldAfter = async (fixture: Fixture, run: (w: World) => Promise<unknown>) => { const w = new World(fixture); await run(w); return w; };

async function check(fixture: Fixture, once: World, run: (w: World) => Promise<unknown>): Promise<Check> {
  let other: World;
  try { other = await worldAfter(fixture, run); } catch (err) {
    return { mode: 'unknown', why: `the repeat threw ${(err as Error).name}, so it never finished`, differences: [] };
  }
  const found = differences(once, other);
  return endState(once) === endState(other) ? { mode: 'safe', why: 'the end state matches one run', differences: [] } : { mode: 'unsafe', why: 'the end state differs from one run', differences: found };
}

export interface TwiceRun { sequential: Check; overlap: Check }

export async function twiceRun(job: Job, fixture: Fixture): Promise<TwiceRun> {
  const blank = (why: string): TwiceRun => { const c: Check = { mode: 'unknown', why, differences: [] }; return { sequential: c, overlap: c }; };
  let once: World;
  try { once = await worldAfter(fixture, (w) => job(w, 'worker-a')); } catch (err) {
    return blank(`the first run threw ${(err as Error).name}, so nothing was compared`);
  }
  if (endState(once) === endState(new World(fixture))) return blank('the first run changed nothing, so a second run proves nothing');
  return {
    sequential: await check(fixture, once, async (w) => { await job(w, 'worker-a'); await job(w, 'worker-b'); }),
    overlap: await check(fixture, once, (w) => Promise.all([job(w, 'worker-a'), job(w, 'worker-b')])),
  };
}
