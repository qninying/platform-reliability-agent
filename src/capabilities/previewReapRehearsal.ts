// platform.preview_stack_reaping, rung R4: runs the platform's reap decision and a simulated teardown against a
// sandbox inventory of preview stacks and their containers, interrupts some teardowns partway, re-runs the reaper,
// and checks the end state is fully clean: every reaped stack stopped, no container left running behind a stack
// that is not running, and every stack that should stay untouched untouched. Sandbox only; no docker, no database.
//
// Platform behaviour this mirrors (platform repo, commit c150d4c48):
// - The reaper runs every 5 minutes (schedulerService.ts:2302-2306). It selects running stacks last accessed
//   before the cutoff, or never accessed and started before it (previewStackReaper.ts:17-30), with a 30 minute
//   default (:14). It stops each in turn and a failure on one does not stop the others (:32-38).
// - Stopping runs `docker compose stop` first, then marks the row stopped, then logs a stop event; a stack that
//   is not running is left as it is (previewStackService.ts:298-311). Containers first, row second, is what lets
//   an interrupted stop be finished by the next run: the row still says running, so the stack is picked again.
// - A failed event write is caught and only printed (previewStackService.ts:123-129), so a stop can happen with
//   no stop event recorded.

import { readFileSync } from 'node:fs';
import { SandboxError } from '../sandbox/sandboxStore.ts';

export const PINNED_AT = 'c150d4c48';
export const PLATFORM_IDLE_MINUTES = 30;
export const LIMITS: readonly string[] = [
  'Containers are modelled as running or stopped. docker compose itself is not run, so a container that refuses to stop is not covered.',
  'Each interruption is one fault at one point in the stop, injected once. A pass does not cover every point a stop can fail.',
  'A stop event lost to a failed write is reported, not counted as an orphan: it is a missing record, not a running resource.',
  'The reaper stops a stack; it does not archive or destroy it. Volumes and the repo clone are kept by design, so they are not orphans here.',
];

export type StackStatus = 'provisioning' | 'running' | 'stopped' | 'failed' | 'tearing_down' | 'archived';
export interface SandboxStack { id: string; slug: string; status: StackStatus; last_accessed_at: string | null; last_started_at: string | null; last_stopped_at: string | null; stack_path: string | null }
export interface Container { id: string; stack: string; service: string; state: 'running' | 'stopped' }
export type Interrupt = 'during_compose_stop' | 'after_compose_stop' | 'event_write';
export interface SeededStack extends SandboxStack { expect: 'stopped' | 'untouched' }
export interface ReapFixture { fixture_id: string; description: string; now: string; idle_minutes?: number; stacks: SeededStack[]; containers: Container[]; interrupt: Array<{ slug: string; at: Interrupt }> }
// compose_first is the platform's order. status_first is the control: it marks the row before stopping containers.
export type Order = 'compose_first' | 'status_first';

interface Inventory { stacks: Map<string, SandboxStack>; containers: Container[]; events: Array<{ stack: string; type: 'stop'; run: string }> }
export interface RunResult { run: string; checked: string[]; stopped: string[]; errors: Array<{ slug: string; at: Interrupt }>; events_lost: string[] }

class Interrupted extends Error {}

function inventory(fx: ReapFixture): Inventory {
  return { stacks: new Map(fx.stacks.map(({ expect: _e, ...s }) => [s.slug, { ...s }])), containers: fx.containers.map((c) => ({ ...c })), events: [] };
}

// The reap decision, as previewStackReaper.ts:17-30 makes it.
export function candidates(stacks: SandboxStack[], nowMs: number, idleMinutes = PLATFORM_IDLE_MINUTES): string[] {
  const cutoff = nowMs - idleMinutes * 60_000;
  const before = (t: string | null) => t !== null && Date.parse(t) < cutoff;
  return stacks.filter((s) => s.status === 'running' && (s.last_accessed_at !== null ? before(s.last_accessed_at) : before(s.last_started_at))).map((s) => s.slug).sort();
}

function stop(inv: Inventory, slug: string, run: string, now: string, order: Order, fault: Interrupt | undefined, lost: string[]): void {
  const s = inv.stacks.get(slug)!;
  const markStopped = () => { s.status = 'stopped'; s.last_stopped_at = now; };
  if (order === 'status_first') markStopped();
  if (s.stack_path) {
    const mine = inv.containers.filter((c) => c.stack === slug && c.state === 'running');
    for (const [i, c] of mine.entries()) {
      c.state = 'stopped';
      if (fault === 'during_compose_stop' && i === 0 && mine.length > 1) throw new Interrupted();
    }
  }
  if (fault === 'after_compose_stop') throw new Interrupted();
  if (order === 'compose_first') markStopped();
  if (fault === 'event_write') { lost.push(slug); return; }
  inv.events.push({ stack: slug, type: 'stop', run });
}

function reap(inv: Inventory, run: string, now: string, idle: number, order: Order, faults: Map<string, Interrupt>): RunResult {
  const checked = candidates([...inv.stacks.values()], Date.parse(now), idle);
  const out: RunResult = { run, checked, stopped: [], errors: [], events_lost: [] };
  for (const slug of checked) {
    const fault = faults.get(slug);
    faults.delete(slug);
    try {
      stop(inv, slug, run, now, order, fault, out.events_lost);
      out.stopped.push(slug);
    } catch (e) {
      if (!(e instanceof Interrupted)) throw e;
      out.errors.push({ slug, at: fault! });
    }
  }
  return out;
}

// A running container behind a stack that is not running is an orphan; a running stack with nothing running is
// a row that lies about its containers.
function mess(inv: Inventory): { orphans: string[]; rows_out_of_step: string[] } {
  const orphans = inv.containers.filter((c) => c.state === 'running' && inv.stacks.get(c.stack)?.status !== 'running').map((c) => c.id).sort();
  const rows_out_of_step = [...inv.stacks.values()].filter((s) => s.status === 'running' && s.stack_path && inv.containers.some((c) => c.stack === s.slug) && inv.containers.filter((c) => c.stack === s.slug).some((c) => c.state === 'stopped')).map((s) => s.slug).sort();
  return { orphans, rows_out_of_step };
}

function scenario(fx: ReapFixture, order: Order) {
  const inv = inventory(fx);
  const idle = fx.idle_minutes ?? PLATFORM_IDLE_MINUTES;
  const faults = new Map(fx.interrupt.map((f) => [f.slug, f.at]));
  const first = reap(inv, 'interrupted', fx.now, idle, order, faults);
  const after_first = mess(inv);
  const second = reap(inv, 're-run', fx.now, idle, order, faults);
  return { inv, runs: [first, second], after_first, after_rerun: mess(inv) };
}

export interface StackOutcome { slug: string; expect: SeededStack['expect']; status: StackStatus; containers_running: number; stop_events: number }
export interface Rehearsal {
  fixture_id: string;
  pinned_at: string;
  idle_minutes: number;
  runs: RunResult[];
  after_interruption: { orphans: string[]; rows_out_of_step: string[] };
  after_rerun: { orphans: string[]; rows_out_of_step: string[] };
  stacks: StackOutcome[];
  stops_not_recorded: string[];
  checks: { interruption_left_work_unfinished: boolean; rerun_ends_clean: boolean; reaped_as_expected: boolean; control_order_leaves_orphans: boolean };
  verified: boolean;
  statement: string;
  limits: string[];
}

export function rehearse(fx: ReapFixture): Rehearsal {
  const real = scenario(fx, 'compose_first');
  const control = scenario(fx, 'status_first');
  const stacks: StackOutcome[] = fx.stacks.map((s) => {
    const now = real.inv.stacks.get(s.slug)!;
    return { slug: s.slug, expect: s.expect, status: now.status, containers_running: real.inv.containers.filter((c) => c.stack === s.slug && c.state === 'running').length, stop_events: real.inv.events.filter((e) => e.stack === s.slug).length };
  });
  const asSeeded = (o: StackOutcome) => o.status === fx.stacks.find((s) => s.slug === o.slug)!.status && o.containers_running === fx.containers.filter((c) => c.stack === o.slug && c.state === 'running').length;
  const checks = {
    interruption_left_work_unfinished: real.runs[0].errors.length > 0 && real.after_first.rows_out_of_step.length + real.after_first.orphans.length > 0,
    rerun_ends_clean: real.after_rerun.orphans.length === 0 && real.after_rerun.rows_out_of_step.length === 0,
    reaped_as_expected: stacks.length > 0 && stacks.every((o) => (o.expect === 'stopped' ? o.status === 'stopped' && o.containers_running === 0 : asSeeded(o))),
    // Marking the row before the containers must strand them after the re-run, or the check cannot see orphans.
    control_order_leaves_orphans: control.after_rerun.orphans.length > 0,
  };
  const verified = Object.values(checks).every(Boolean);
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const lost = real.runs.flatMap((r) => r.events_lost).sort();
  return {
    fixture_id: fx.fixture_id, pinned_at: PINNED_AT, idle_minutes: fx.idle_minutes ?? PLATFORM_IDLE_MINUTES,
    runs: real.runs, after_interruption: real.after_first, after_rerun: real.after_rerun, stacks, stops_not_recorded: lost, checks, verified,
    statement: (verified
      ? `In sandbox ${fx.fixture_id}: ${real.runs[0].errors.length} teardown(s) interrupted, and the re-run reached a clean end state with no orphaned containers. Sandbox only; nothing reached docker or a database.`
      : `In sandbox ${fx.fixture_id}, not verified: ${failed.join(', ')}.`)
      + (lost.length ? ` ${lost.length} stop(s) left no stop event, because a failed event write is only printed: ${lost.join(', ')}.` : ''),
    limits: [...LIMITS],
  };
}

export function loadReapFixture(path: string): ReapFixture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SandboxError('SourceUnavailable', `fixture ${path} could not be read: ${(err as Error).message}`);
  }
  let fx: ReapFixture;
  try {
    fx = JSON.parse(text);
  } catch (err) {
    throw new SandboxError('ContractViolation', `fixture ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof fx.fixture_id !== 'string' || Number.isNaN(Date.parse(fx.now)) || !Array.isArray(fx.stacks) || !Array.isArray(fx.containers) || !Array.isArray(fx.interrupt)) {
    throw new SandboxError('ContractViolation', `fixture ${path} needs fixture_id, now, stacks[], containers[] and interrupt[]`);
  }
  const slugs = new Set(fx.stacks.map((s) => s.slug));
  for (const c of fx.containers) if (!slugs.has(c.stack)) throw new SandboxError('ContractViolation', `fixture ${path}: container ${c.id} names unknown stack ${c.stack}`);
  for (const f of fx.interrupt) if (!slugs.has(f.slug)) throw new SandboxError('ContractViolation', `fixture ${path}: interrupt names unknown stack ${f.slug}`);
  return fx;
}
