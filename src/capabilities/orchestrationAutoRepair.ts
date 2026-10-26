// platform.orchestration_auto_repair, first release behaviour (R4):
// runs the repair sequence against a sandbox fixture carrying seeded faults and verifies the end
// state. Running it twice on the same fixture leaves one change per fault, and the second run
// reports no-op.
//
// Only a SandboxStore can be repaired: there is no production target, by design.
//
// Platform behaviour this rests on (platform repo, commit c99021d, unchanged at 13cb098):
// - The authorized repair set is the constant SAFE_REPAIR_TYPES: inactive_prompt_reactivation and
//   broken_fk_nullification (backend/src/services/agents/orchestrationAutoRepairAgent.ts:8-11),
//   applied to three fault events with fixed FK allowlists (:87-91, :135). Anything else is
//   left alone and reported.
// - The detector flags broken prompt FKs only on active mini-sections
//   (backend/src/services/agents/promptMonitorAgent.ts:39), but the platform's repair nulls the FK on
//   every mini-section (orchestrationAutoRepairAgent.ts:95). Ellis repairs only rows the detector
//   would flag, and reports the others as left alone.
// - The platform reads max_repairs_per_run with `|| 10` (orchestrationAutoRepairAgent.ts:20), so a
//   cap of 0 becomes 10. Here 0 means no repairs.

import { SandboxStore, SandboxError, type FaultSignal, type SandboxRow, type TableName } from '../sandbox/sandboxStore.ts';

const MINI_SECTION_FKS = ['concept_prompt_template_id', 'build_prompt_template_id', 'mentor_prompt_template_id'];
const ARTIFACT_FKS = ['instruction_prompt_id', 'auto_generate_prompt_id'];

export const AUTHORIZED_REPAIRS: Record<string, { repair_class: string; action: string }> = {
  inactive_prompt_referenced: { repair_class: 'inactive_prompt_reactivation', action: 'repair_reactivate_prompt' },
  broken_prompt_fk: { repair_class: 'broken_fk_nullification', action: 'repair_null_broken_fk' },
  broken_artifact_prompt_fk: { repair_class: 'broken_fk_nullification', action: 'repair_null_broken_artifact_fk' },
};

export interface Change {
  key: string;
  table: TableName;
  row_id: string;
  column: string;
  from: unknown;
  to: unknown;
  fault_id: string;
  repair_class: string;
  action: string;
}

export interface Skipped {
  fault_id: string;
  event_type: string;
  reason: string;
  row_id?: string;
}

export interface RepairReport {
  fixture_id: string;
  outcome: 'changed' | 'no_op' | 'partial' | 'failed';
  applied: Change[];
  no_op: Skipped[];
  left_alone: Skipped[];
  deferred: Change[];
  verified: boolean;
  error?: { error_class: string; message: string };
}

interface Plan {
  changes: Change[];
  no_op: Skipped[];
  left_alone: Skipped[];
}

export function runRepair(store: SandboxStore, faults: FaultSignal[], opts: { maxRepairs?: number } = {}): RepairReport {
  if (!(store instanceof SandboxStore)) throw new SandboxError('ContractViolation', 'repairs run against a SandboxStore only');
  const maxRepairs = opts.maxRepairs ?? 10;
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0) throw new SandboxError('ContractViolation', `maxRepairs must be a whole number >= 0, got ${maxRepairs}`);

  const plan = planRepairs(store, faults);
  const toApply = plan.changes.slice(0, maxRepairs);
  const report: RepairReport = {
    fixture_id: store.fixtureId, outcome: 'no_op', applied: [], no_op: plan.no_op, left_alone: plan.left_alone,
    deferred: plan.changes.slice(maxRepairs), verified: false,
  };

  for (const change of toApply) {
    try {
      store.update(change.table, change.row_id, change.column, change.to);
      report.applied.push(change);
    } catch (err) {
      const e = err as SandboxError;
      report.error = { error_class: e.errorClass ?? 'SandboxWriteFailed', message: e.message };
      // The failed change and everything after it wait for the next run, which re-plans from state.
      report.deferred = [...toApply.slice(report.applied.length), ...report.deferred];
      break;
    }
  }

  report.verified = report.applied.every((c) => store.get(c.table, c.row_id)?.[c.column] === c.to);
  report.outcome = report.error ? (report.applied.length > 0 ? 'partial' : 'failed') : report.applied.length > 0 ? 'changed' : 'no_op';
  if (!report.verified) report.outcome = 'failed';
  return report;
}

// Works out every change the faults call for, from the sandbox's current state. A fault whose
// target is already in the repaired state produces a no-op, never a second change; duplicate
// signals for the same row and column collapse to one change.
export function planRepairs(store: SandboxStore, faults: FaultSignal[]): Plan {
  const plan: Plan = { changes: [], no_op: [], left_alone: [] };
  const seen = new Set<string>();
  const ordered = [...faults].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));

  for (const fault of ordered) {
    const rule = AUTHORIZED_REPAIRS[fault.event_type];
    if (!rule) {
      plan.left_alone.push(skip(fault, 'outside the authorized repair set; reported, not repaired'));
      continue;
    }
    const proposed = fault.event_type === 'inactive_prompt_referenced' ? planReactivation(store, fault, plan) : planFkNull(store, fault, plan);
    for (const change of proposed) {
      if (seen.has(change.key)) {
        plan.no_op.push(skip(fault, `duplicate signal: ${change.key} is already planned by an earlier fault`, change.row_id));
        continue;
      }
      seen.add(change.key);
      plan.changes.push(change);
    }
  }
  return plan;
}

function planReactivation(store: SandboxStore, fault: FaultSignal, plan: Plan): Change[] {
  const promptId = String(fault.details?.prompt_id ?? fault.entity_id ?? '');
  const prompt = promptId ? store.get('prompt_templates', promptId) : undefined;
  if (!prompt) {
    plan.left_alone.push(skip(fault, `prompt ${promptId || '(none named)'} does not exist, so there is nothing to reactivate`));
    return [];
  }
  if (prompt.is_active === true) {
    plan.no_op.push(skip(fault, 'prompt is already active', promptId));
    return [];
  }
  const stillReferenced = store.where('mini_sections', (ms) => ms.is_active === true && MINI_SECTION_FKS.some((f) => ms[f] === promptId));
  if (stillReferenced.length === 0) {
    plan.no_op.push(skip(fault, 'no active mini-section references this prompt any more', promptId));
    return [];
  }
  return [change(fault, 'prompt_templates', prompt, 'is_active', true)];
}

function planFkNull(store: SandboxStore, fault: FaultSignal, plan: Plan): Change[] {
  const isArtifact = fault.event_type === 'broken_artifact_prompt_fk';
  const table: TableName = isArtifact ? 'artifact_definitions' : 'mini_sections';
  const fkField = String(fault.details?.fk_field ?? '');
  const brokenId = String(fault.details?.broken_prompt_id ?? '');
  if (!(isArtifact ? ARTIFACT_FKS : MINI_SECTION_FKS).includes(fkField) || !brokenId) {
    plan.left_alone.push(skip(fault, `fk_field '${fkField}' or broken_prompt_id is missing or not on the allowlist for ${table}`));
    return [];
  }
  if (store.get('prompt_templates', brokenId)) {
    plan.no_op.push(skip(fault, `prompt ${brokenId} exists now, so the link is not broken`));
    return [];
  }
  const pointing = store.where(table, (r) => r[fkField] === brokenId);
  // Mini-sections: only active rows, matching what the detector flags (promptMonitorAgent.ts:39).
  const inScope = isArtifact ? pointing : pointing.filter((r) => r.is_active === true);
  for (const r of pointing.filter((p) => !inScope.includes(p))) {
    plan.left_alone.push(skip(fault, 'inactive mini-section: the detector does not flag it, so it is not repaired', r.id));
  }
  if (inScope.length === 0) plan.no_op.push(skip(fault, `no ${table} row in scope still points at ${brokenId}`));
  return inScope.map((r) => change(fault, table, r, fkField, null));
}

function change(fault: FaultSignal, table: TableName, row: SandboxRow, column: string, to: unknown): Change {
  const rule = AUTHORIZED_REPAIRS[fault.event_type];
  return { key: `${table}:${row.id}:${column}`, table, row_id: row.id, column, from: row[column], to, fault_id: fault.id, repair_class: rule.repair_class, action: rule.action };
}

function skip(fault: FaultSignal, reason: string, rowId?: string): Skipped {
  return { fault_id: fault.id, event_type: fault.event_type, reason, ...(rowId ? { row_id: rowId } : {}) };
}
