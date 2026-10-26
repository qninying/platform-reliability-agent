import { readFileSync } from 'node:fs';

// A sandbox copy of the platform tables a repair can touch. Every write is recorded in a journal,
// so "how many changes did this leave" is counted, not inferred. Nothing here reaches a database.

export type TableName = 'prompt_templates' | 'mini_sections' | 'artifact_definitions';
export const TABLES: TableName[] = ['prompt_templates', 'mini_sections', 'artifact_definitions'];

export interface SandboxRow {
  id: string;
  [column: string]: unknown;
}

// Shaped like the platform's AiSystemEvent rows that the repair agent reads
// (backend/src/services/aiEventService.ts:14-26).
export interface FaultSignal {
  id: string;
  source: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface Fixture {
  fixture_id: string;
  description: string;
  tables: Record<TableName, SandboxRow[]>;
  faults: FaultSignal[];
}

export interface JournalEntry {
  seq: number;
  table: TableName;
  row_id: string;
  column: string;
  before: unknown;
  after: unknown;
}

export class SandboxError extends Error {
  readonly errorClass: 'SourceUnavailable' | 'ContractViolation' | 'SandboxWriteFailed';
  constructor(errorClass: SandboxError['errorClass'], message: string) {
    super(message);
    this.errorClass = errorClass;
  }
}

export class SandboxStore {
  readonly fixtureId: string;
  #tables: Record<TableName, Map<string, SandboxRow>>;
  #journal: JournalEntry[] = [];

  constructor(fixture: Fixture) {
    this.fixtureId = fixture.fixture_id;
    this.#tables = {} as Record<TableName, Map<string, SandboxRow>>;
    for (const t of TABLES) {
      this.#tables[t] = new Map((fixture.tables[t] ?? []).map((r) => [r.id, structuredClone(r)]));
    }
  }

  get(table: TableName, id: string): SandboxRow | undefined {
    const row = this.#tables[table].get(id);
    return row ? structuredClone(row) : undefined;
  }

  where(table: TableName, match: (row: SandboxRow) => boolean): SandboxRow[] {
    return [...this.#tables[table].values()].filter(match).map((r) => structuredClone(r)).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // Writes one column. Writing the value a column already holds is refused, so a caller that
  // skips its own precondition check cannot add a journal entry that changes nothing.
  update(table: TableName, id: string, column: string, value: unknown): JournalEntry {
    const row = this.#tables[table].get(id);
    if (!row) throw new SandboxError('SandboxWriteFailed', `${table} row ${id} does not exist`);
    if (row[column] === value) throw new SandboxError('SandboxWriteFailed', `${table}.${column} on ${id} is already ${String(value)}`);
    const entry: JournalEntry = { seq: this.#journal.length + 1, table, row_id: id, column, before: row[column], after: value };
    row[column] = value;
    this.#journal.push(entry);
    return { ...entry };
  }

  journal(): JournalEntry[] {
    return this.#journal.map((e) => ({ ...e }));
  }
}

export function loadFixture(path: string): Fixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let parsed: Partial<Fixture>;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed.fixture_id !== 'string' || typeof parsed.tables !== 'object' || !Array.isArray(parsed.faults)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, tables and faults[]`);
  }
  return parsed as Fixture;
}
