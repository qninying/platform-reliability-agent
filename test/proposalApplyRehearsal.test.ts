import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehearse, validateProposalSet, loadProposalFixture, type ProposalFixture } from '../src/capabilities/proposalApplyRehearsal.ts';
import type { ProposalSet, Proposal } from '../src/capabilities/registrationProposal.ts';
import { proposalApplyOutput } from '../src/output/actionAdapters.ts';
import type { SeverityTable } from '../src/output/toolOutput.ts';

// The checkout is the ratchet's sandbox checkout plus one entry whose runner reads a missing row; names are test inputs.
const FIXTURE = 'examples/timer-proposal.fixture.json';
const load = (): ProposalFixture => loadProposalFixture(FIXTURE);
const EMPTY: SeverityTable = { owner: 'K.D.', status: 'not agreed yet, ISS-032', rules: [] };
const C = { captured_at: '2026-11-05T20:00:00Z', captured_by: 'test' };
const box = () => mkdtempSync(join(tmpdir(), 'ellis-proposal-'));
const run = (generate?: (s: ProposalSet) => ProposalSet) => rehearse(load(), box(), 'Q.N.', generate);
const edit = (name: string, change: (p: Proposal) => Proposal) => (s: ProposalSet): ProposalSet => ({ ...s, proposals: s.proposals.map((p) => (p.name === name ? change(structuredClone(p)) : p)) });
const timer = (r: ReturnType<typeof run>, name: string) => r.timers.find((t) => t.name === name)!;

test('acceptance (R3): each proposed row names its enabled value, and applying the set to a sandbox registry starts no timer the proposal marked disabled', () => {
  const r = run();
  assert.equal(r.verified, true, r.statement);
  const rows = r.proposals.proposals.flatMap((p) => (p.proposed_row ? [p.proposed_row] : []));
  assert.equal(rows.length, 8);
  assert.ok(rows.every((x) => typeof x.enabled === 'boolean'));
  assert.deepEqual(timer(r, 'Ghost'), { name: 'Ghost', governed_by: 'GhostRow', runs_today: 'no_row_to_run_on', marked_enabled: false, before: false, after: false, after_without_enabled: true });
  assert.ok(r.timers.filter((t) => t.marked_enabled !== false).every((t) => t.before && t.after), 'every timer meant to run ran before and after');
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.not_ticked, ['Director', 'Mystery']);
  assert.equal(r.initiated_by, 'Q.N.');
  assert.match(r.statement, /started by Q\.N\.: 10 untracked names measured, 8 rows proposed.*the 1 marked disabled \(Ghost via GhostRow\) does not start\. Applied without enabled, the column's default starts Ghost\..*Sandbox only; nothing ran on the platform\.$/);
  assert.equal(r.limits.length, 4);
});

test('a name whose own row exists outside the seed gets no second row: applying one would collide', () => {
  const r = run();
  const d = r.proposals.proposals.find((p) => p.name === 'DomainScheduled')!;
  assert.deepEqual([d.runs_today, d.proposed_row], ['yes_on_its_own_row', null]);
  assert.equal(timer(r, 'DomainScheduled').after, true);
  // The same name proposed as a second row is refused by the registry's unique key.
  const dup = run(edit('DomainScheduled', (p) => ({ ...p, proposed_row: { agent_name: 'DomainScheduled', trigger_type: 'cron', schedule: '0 8 * * *', enabled: true } })));
  assert.deepEqual(dup.refused.map((x) => x.agent_name), ['DomainScheduled']);
  assert.match(dup.refused[0].why, /UNIQUE constraint failed/);
  assert.deepEqual([dup.checks.every_row_applied, dup.verified], [false, false]);
});

test('the set is validated as data: a row that leaves enabled unnamed, names it wrongly, reads the wrong row or repeats is a problem', () => {
  const base = run().proposals;
  assert.deepEqual(validateProposalSet(base), []);
  const without = edit('Ghost', (p) => { delete (p.proposed_row as Partial<NonNullable<Proposal['proposed_row']>>).enabled; return p; })(base);
  assert.deepEqual(validateProposalSet(without), ['Ghost: the proposed row GhostRow does not name its enabled value']);
  const text = edit('Ghost', (p) => ({ ...p, proposed_row: { ...p.proposed_row!, enabled: 'false' as never } }))(base);
  assert.equal(validateProposalSet(text).length, 1);
  assert.deepEqual(validateProposalSet(edit('Ghost', (p) => ({ ...p, proposed_row: { ...p.proposed_row!, agent_name: 'Ghost' } }))(base)), ['Ghost: the proposed row is Ghost, but its runner reads GhostRow']);
  const twice: ProposalSet = { ...base, proposals: [...base.proposals, base.proposals.find((p) => p.name === 'Uninst')!] };
  assert.deepEqual(validateProposalSet(twice), ['Uninst: proposed 2 times']);
  assert.deepEqual(validateProposalSet(edit('Uninst', (p) => ({ ...p, proposed_row: null }))(base)), ["Uninst: no row is proposed, but its runner's row is not known to exist"]);
  const r = run(edit('Ghost', (p) => { delete (p.proposed_row as Partial<NonNullable<Proposal['proposed_row']>>).enabled; return p; }));
  assert.deepEqual([r.checks.every_row_names_enabled, timer(r, 'Ghost').marked_enabled, r.verified], [false, null, false]);
});

test('with no row marked disabled the acceptance says nothing, so the run is not verified; and the control needs one', () => {
  const r = run(edit('Ghost', (p) => ({ ...p, proposed_row: { ...p.proposed_row!, enabled: true } })));
  assert.equal(timer(r, 'Ghost').after, true, 'marked enabled, the row starts a job that did nothing before');
  assert.deepEqual([r.checks.a_row_is_marked_disabled, r.checks.default_enabled_starts_a_disabled_timer, r.verified], [false, false, false]);
  assert.equal(r.checks.no_disabled_timer_started, true);
});

test('a row marked disabled stops a timer that runs today untracked, and a timer meant to run whose row is missing fails the run', () => {
  const off = run(edit('Uninst', (p) => ({ ...p, proposed_row: { ...p.proposed_row!, enabled: false } })));
  assert.deepEqual([timer(off, 'Uninst').before, timer(off, 'Uninst').after, timer(off, 'Uninst').after_without_enabled], [true, false, true]);
  assert.equal(off.verified, true);
  // A row marked disabled whose name already exists enabled is refused, so the timer keeps running: caught.
  const exists = run(edit('Drift', (p) => ({ ...p, proposed_row: { agent_name: 'DriftAgent', trigger_type: 'cron', schedule: null, enabled: false } })));
  assert.deepEqual([timer(exists, 'Drift').marked_enabled, timer(exists, 'Drift').after, exists.checks.no_disabled_timer_started], [false, true, false]);
  const missing = run(edit('Drift', (p) => ({ ...p, governed_by: 'NoSuchRow' })));
  assert.deepEqual([timer(missing, 'Drift').after, missing.checks.enabled_timers_run, missing.verified], [false, false, false]);
});

test('a proposal run is started by a named operator, and its registries stay in one sandbox folder', () => {
  assert.throws(() => rehearse(load(), box(), ' '), /named operator/);
  const root = box();
  rehearse(load(), root, 'Q.N.');
  const [folder] = readdirSync(root);
  assert.deepEqual(readdirSync(join(root, folder)).sort(), ['registry-applied-without-enabled.sqlite', 'registry-applied.sqlite', 'registry-before.sqlite']);
  assert.deepEqual(run(), run(), 'the same fixture gives the same rehearsal');
});

test('in the shared output, a verified run is ok citing each ticked timer; a failed run cites what went wrong; untickable timers are blind spots', () => {
  const o = proposalApplyOutput(run(), C, EMPTY);
  assert.equal(o.verdict, 'ok');
  assert.equal(o.evidence.length, 8);
  assert.deepEqual(o.evidence.find((x) => x.id === 'GhostRow'), { table: 'sandbox_registry', id: 'GhostRow', fields: ['timer Ghost', 'marked disabled', 'does not run'] });
  assert.deepEqual(o.evidence.find((x) => x.id === 'DriftAgent')!.fields, ['timer Drift', 'marked no new row', 'runs']);
  assert.match(o.as_of.note!, /sandbox fixture timer-proposal-sandbox-1, not production/);
  assert.equal(o.blind_spots.length, 6);
  assert.match(o.blind_spots[0], /^Director: not ticked/);
  const f = proposalApplyOutput(run(edit('Drift', (p) => ({ ...p, governed_by: 'NoSuchRow' }))), C, EMPTY);
  assert.deepEqual([f.verdict, f.evidence.map((x) => x.id)], ['problem', ['NoSuchRow']]);
  const p = proposalApplyOutput(run(edit('DomainScheduled', (x) => ({ ...x, proposed_row: { agent_name: 'DomainScheduled', trigger_type: 'cron', schedule: null, enabled: true } }))), C, EMPTY);
  assert.deepEqual(p.evidence.at(-1)!.table, 'proposal_set');
  assert.match(p.evidence.at(-1)!.fields[0], /^DomainScheduled: not applied, UNIQUE constraint failed/);
  assert.equal(p.evidence.length, 9, 'no timer went wrong, so every timer is cited beside the problem');
});

test('a fixture is refused without its parts; the command exits 0, 3 and 1', () => {
  const dir = box();
  for (const bad of [{ files: {} }, { fixture_id: 'x' }, { fixture_id: 'x', files: { a: 1 } }]) {
    const path = join(dir, `${Math.random()}.json`);
    writeFileSync(path, JSON.stringify(bad));
    assert.throws(() => loadProposalFixture(path), /needs fixture_id and files/);
  }
  const cli = (...a: string[]) => spawnSync(process.execPath, ['src/cli/proposalApplyRehearsal.ts', ...a], { encoding: 'utf8' });
  const ok = cli('--fixture', FIXTURE, '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(ok.status, 0, ok.stderr);
  // Without the entry whose row is missing, nothing is marked disabled, so the run is not verified.
  const fx = load();
  const k = 'backend/src/services/aiOpsScheduler.ts';
  const plain = join(dir, 'plain.json');
  writeFileSync(plain, JSON.stringify({ ...fx, files: { ...fx.files, [k]: fx.files[k].replace(/ {2}\{ agentName: 'Ghost'.*\n/, '') } }));
  assert.equal(cli('--fixture', plain, '--sandbox', box(), '--operator', 'Q.N.').status, 3);
  const noOperator = cli('--fixture', FIXTURE, '--sandbox', box());
  assert.equal(noOperator.status, 1);
  assert.match(noOperator.stderr, /named person/);
  const missing = cli('--fixture', 'examples/nope.json', '--sandbox', box(), '--operator', 'Q.N.');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SourceUnavailable/);
});
