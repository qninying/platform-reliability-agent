import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, SandboxStore, SandboxError, type Fixture, type FaultSignal } from '../src/sandbox/sandboxStore.ts';
import { runRepair } from '../src/capabilities/orchestrationAutoRepair.ts';

// The seeded fixture is the same file the CLI demo runs. It is a sandbox fixture, not production data.
const SEEDED = 'examples/orchestration-repair.fixture.json';

function fault(id: string, event_type: string, details: Record<string, unknown>, entity_id?: string): FaultSignal {
  return { id, source: 'prompt_monitor', event_type, entity_id, details, created_at: '2026-10-26T15:00:00Z' };
}

function fixture(over: Partial<Fixture['tables']>, faults: FaultSignal[]): Fixture {
  return { fixture_id: 'test', description: 'test', tables: { prompt_templates: [], mini_sections: [], artifact_definitions: [], ...over }, faults };
}

test('acceptance: the same repair twice on the same fixture leaves one change, and the second run reports no-op', () => {
  const fx = fixture(
    { prompt_templates: [{ id: 'p1', is_active: false }], mini_sections: [{ id: 'ms1', is_active: true, build_prompt_template_id: 'p1' }] },
    [fault('e1', 'inactive_prompt_referenced', { fk_field: 'build_prompt_template_id' }, 'p1')],
  );
  const store = new SandboxStore(fx);
  const first = runRepair(store, fx.faults);
  const second = runRepair(store, fx.faults);
  assert.equal(first.outcome, 'changed');
  assert.equal(first.verified, true);
  assert.equal(second.outcome, 'no_op');
  assert.equal(second.applied.length, 0);
  assert.equal(store.journal().length, 1);
  assert.equal(store.get('prompt_templates', 'p1')?.is_active, true);
});

test('acceptance on the seeded demo fixture: run 1 makes 4 changes, run 2 makes none, journal holds 4', () => {
  const fx = loadFixture(SEEDED);
  const store = new SandboxStore(fx);
  const first = runRepair(store, fx.faults);
  const second = runRepair(store, fx.faults);
  assert.equal(first.applied.length, 4);
  assert.equal(second.outcome, 'no_op');
  assert.equal(store.journal().length, 4);
  // Same end state as a single run: replay does not drift.
  const once = new SandboxStore(fx);
  runRepair(once, fx.faults);
  for (const t of ['prompt_templates', 'mini_sections', 'artifact_definitions'] as const) {
    assert.deepEqual(store.where(t, () => true), once.where(t, () => true));
  }
});

test('duplicate signals for the same row (the monitor runs every minute) make one change, and the duplicate is reported', () => {
  const fx = fixture(
    { prompt_templates: [{ id: 'p1', is_active: false }], mini_sections: [{ id: 'ms1', is_active: true, concept_prompt_template_id: 'p1' }] },
    [fault('e1', 'inactive_prompt_referenced', {}, 'p1'), fault('e2', 'inactive_prompt_referenced', {}, 'p1')],
  );
  const store = new SandboxStore(fx);
  const r = runRepair(store, fx.faults);
  assert.equal(r.applied.length, 1);
  assert.ok(r.no_op.some((s) => s.fault_id === 'e2' && /duplicate/.test(s.reason)));
  assert.equal(store.journal().length, 1);
});

test('a fault outside the authorized repair set is left alone and reported, not improvised on', () => {
  const fx = fixture({ mini_sections: [{ id: 'ms1', is_active: true, concept_prompt_template_id: 'gone' }] }, [fault('e1', 'gating_deadlock', {})]);
  const store = new SandboxStore(fx);
  const r = runRepair(store, fx.faults);
  assert.equal(r.outcome, 'no_op');
  assert.equal(r.left_alone[0].fault_id, 'e1');
  assert.equal(store.journal().length, 0);
});

test('an FK column outside the allowlist is left alone', () => {
  const fx = fixture({ mini_sections: [{ id: 'ms1', is_active: true, title: 'gone' }] }, [fault('e1', 'broken_prompt_fk', { broken_prompt_id: 'gone', fk_field: 'title' })]);
  const store = new SandboxStore(fx);
  assert.equal(runRepair(store, fx.faults).left_alone.length, 1);
  assert.equal(store.journal().length, 0);
});

test('broken mini-section FK: active rows are repaired, the inactive row the detector never flags is left alone', () => {
  const fx = fixture(
    { mini_sections: [{ id: 'on', is_active: true, mentor_prompt_template_id: 'gone' }, { id: 'off', is_active: false, mentor_prompt_template_id: 'gone' }] },
    [fault('e1', 'broken_prompt_fk', { broken_prompt_id: 'gone', fk_field: 'mentor_prompt_template_id' })],
  );
  const store = new SandboxStore(fx);
  const r = runRepair(store, fx.faults);
  assert.deepEqual(r.applied.map((c) => c.row_id), ['on']);
  assert.equal(store.get('mini_sections', 'off')?.mentor_prompt_template_id, 'gone');
  assert.ok(r.left_alone.some((s) => s.row_id === 'off'));
});

test('a link that is no longer broken (the prompt exists again) is a no-op', () => {
  const fx = fixture(
    { prompt_templates: [{ id: 'back', is_active: true }], artifact_definitions: [{ id: 'a1', instruction_prompt_id: 'back' }] },
    [fault('e1', 'broken_artifact_prompt_fk', { broken_prompt_id: 'back', fk_field: 'instruction_prompt_id' })],
  );
  const store = new SandboxStore(fx);
  assert.equal(runRepair(store, fx.faults).outcome, 'no_op');
  assert.equal(store.journal().length, 0);
});

test('reactivation is skipped when no active mini-section uses the prompt any more', () => {
  const fx = fixture({ prompt_templates: [{ id: 'p1', is_active: false }] }, [fault('e1', 'inactive_prompt_referenced', {}, 'p1')]);
  const store = new SandboxStore(fx);
  assert.equal(runRepair(store, fx.faults).outcome, 'no_op');
  assert.equal(store.get('prompt_templates', 'p1')?.is_active, false);
});

test('repair cap: 0 means no repairs (the platform turns 0 into 10), and deferred work completes on the next run', () => {
  const fx = loadFixture(SEEDED);
  const store = new SandboxStore(fx);
  const capped = runRepair(store, fx.faults, { maxRepairs: 0 });
  assert.equal(capped.applied.length, 0);
  assert.equal(capped.deferred.length, 4);
  const partial = runRepair(store, fx.faults, { maxRepairs: 3 });
  assert.equal(partial.applied.length, 3);
  assert.equal(partial.deferred.length, 1);
  const rest = runRepair(store, fx.faults, { maxRepairs: 3 });
  assert.equal(rest.applied.length, 1);
  assert.equal(store.journal().length, 4);
});

test('failure path: a write that fails mid-run reports partial, and a re-run finishes without doubling anything', () => {
  const fx = loadFixture(SEEDED);
  const store = new SandboxStore(fx);
  const realUpdate = store.update.bind(store);
  let calls = 0;
  store.update = (...args) => {
    calls += 1;
    if (calls === 2) throw new SandboxError('SandboxWriteFailed', 'simulated write failure');
    return realUpdate(...args);
  };
  const broken = runRepair(store, fx.faults);
  assert.equal(broken.outcome, 'partial');
  assert.equal(broken.error?.error_class, 'SandboxWriteFailed');
  assert.equal(broken.applied.length, 1);
  assert.equal(broken.deferred.length, 3);
  store.update = realUpdate;
  const retry = runRepair(store, fx.faults);
  assert.equal(retry.applied.length, 3);
  assert.equal(store.journal().length, 4);
});

test('refuses anything that is not a SandboxStore, and a bad cap', () => {
  const fake = { fixtureId: 'prod' } as unknown as SandboxStore;
  assert.throws(() => runRepair(fake, []), /SandboxStore only/);
  assert.throws(() => runRepair(new SandboxStore(fixture({}, [])), [], { maxRepairs: -1 }), /whole number/);
});

test('every repair action name contains "repair", so the AI Ops overview counter would count it', () => {
  const fx = loadFixture(SEEDED);
  const r = runRepair(new SandboxStore(fx), fx.faults);
  assert.ok(r.applied.every((c) => c.action.includes('repair')));
});
