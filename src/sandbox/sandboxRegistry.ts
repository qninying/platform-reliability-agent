import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A sandbox agent registry: one SQLite file holding an ai_agents table shaped like the platform's on the columns a
// timer's gate reads. Like the platform's model, enabled defaults to true when a row is created without it
// (backend/src/models/AiAgent.ts:423-427 at a29dfb245). Nothing outside the sandbox folder is opened.

export interface RegistryRow { agent_name: string; trigger_type: string; schedule: string | null; enabled?: boolean }

const DDL = `CREATE TABLE ai_agents (
  agent_name VARCHAR(100) NOT NULL UNIQUE,
  trigger_type VARCHAR(30),
  schedule VARCHAR(50),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) NOT NULL DEFAULT 'idle'
);`;

// The seed rows are created enabled.
export function createRegistry(dir: string, name: string, seed: RegistryRow[]): string {
  const path = join(dir, `${name}.sqlite`);
  const db = new DatabaseSync(path);
  try {
    db.exec(DDL);
    const insert = db.prepare('INSERT INTO ai_agents (agent_name, trigger_type, schedule, enabled) VALUES (?, ?, ?, ?)');
    for (const r of seed) insert.run(r.agent_name, r.trigger_type, r.schedule, 1);
  } finally {
    db.close();
  }
  return path;
}

// Inserts each row. With explicit, enabled is written as the row states it; without, the column is left to its
// default, as a row created from a proposal that never named enabled would be. A row whose name exists is refused
// by the unique key and reported, never merged.
export function applyRows(path: string, rows: RegistryRow[], explicit: boolean): { inserted: string[]; refused: Array<{ agent_name: string; why: string }> } {
  const db = new DatabaseSync(path);
  const inserted: string[] = [], refused: Array<{ agent_name: string; why: string }> = [];
  try {
    const withEnabled = db.prepare('INSERT INTO ai_agents (agent_name, trigger_type, schedule, enabled) VALUES (?, ?, ?, ?)');
    const withoutEnabled = db.prepare('INSERT INTO ai_agents (agent_name, trigger_type, schedule) VALUES (?, ?, ?)');
    for (const r of rows) {
      try {
        if (explicit) withEnabled.run(r.agent_name, r.trigger_type, r.schedule, r.enabled ? 1 : 0);
        else withoutEnabled.run(r.agent_name, r.trigger_type, r.schedule);
        inserted.push(r.agent_name);
      } catch (err) {
        refused.push({ agent_name: r.agent_name, why: (err as Error).message });
      }
    }
  } finally {
    db.close();
  }
  return { inserted, refused };
}

// The gate every wrapper applies (agents/agentControlGate.ts:38-44): a row runs only when enabled and not paused.
// null when there is no row: what happens then is the runner's choice, not the gate's.
export function readGate(path: string, agentName: string): boolean | null {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const r = db.prepare('SELECT enabled, status FROM ai_agents WHERE agent_name = ?').get(agentName) as { enabled: number; status: string } | undefined;
    return r ? r.enabled === 1 && r.status !== 'paused' : null;
  } finally {
    db.close();
  }
}
