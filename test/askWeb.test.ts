import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { createAskServer } from '../src/web/server.ts';
import type { ModelClient } from '../src/agent/loop.ts';

// A scripted model (no network, no cost): one check, then an answer. `gate` lets a test hold a run open.
function fake(gate?: Promise<void>): ModelClient {
  let n = 0;
  return {
    async create(p) {
      n += 1;
      if (gate) await gate;
      const content = n % 2 ? [{ type: 'tool_use', id: `t${n}`, name: 'cron_health', input: {} }] : [{ type: 'text', text: '**Answer**\nNo job alerts.' }];
      return { id: `m${n}`, type: 'message', role: 'assistant', model: p.model, content, stop_reason: n % 2 ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } } as any;
    },
  };
}

async function start(client: ModelClient) {
  const runsDir = mkdtempSync(join(tmpdir(), 'ellis-runs-'));
  const server = createAskServer({ client, runsDir, agent: { model: 'claude-sonnet-5-5', maxSteps: 4, tools: { repoRoot: process.cwd(), platformSource: null, timeoutMs: 30_000 } } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ask = (question: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify({ question }) });
  const stop = () => { server.close(); rmSync(runsDir, { recursive: true, force: true }); };
  return { base, ask, runsDir, stop };
}

test('the page asks a question and streams the steps, then the answer, and saves the run for replay', async () => {
  const s = await start(fake());
  try {
    const page = await fetch(s.base);
    assert.match(await page.text(), /<title>Ask Ellis<\/title>/);
    const events = (await (await s.ask('Is anything broken?')).text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(events.map((e) => e.type), ['thinking', 'tool_started', 'tool_finished', 'thinking', 'done']);
    assert.equal(events[2].call.exit_code, 3, 'cron_health really ran on the example');
    const done = events.at(-1);
    assert.equal(done.run.answer, '**Answer**\nNo job alerts.');
    const runs = await (await fetch(`${s.base}/api/runs`)).json();
    assert.deepEqual(runs.map((r: { file: string }) => r.file), [done.file]);
    const replay = await (await fetch(`${s.base}/api/runs/${done.file}`)).json();
    assert.equal(replay.question, 'Is anything broken?');
  } finally { s.stop(); }
});

test('another website cannot spend the credits: a foreign or missing Origin, or a non-JSON body, is refused', async () => {
  const s = await start(fake());
  try {
    assert.equal((await s.ask('q', { origin: 'https://evil.example' })).status, 403);
    const noOrigin = await fetch(`${s.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"q"}' });
    assert.equal(noOrigin.status, 403);
    assert.equal((await s.ask('q', { 'content-type': 'text/plain' })).status, 415);
    // fetch cannot set Host, so this one goes through node:http: a request addressed to another host name (as a
    // DNS-rebinding page would send) is refused.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const u = new URL(s.base);
      request({ host: u.hostname, port: u.port, path: '/', headers: { host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
    });
    assert.equal(status, 403);
  } finally { s.stop(); }
});

test('bad questions and oversized bodies are refused before any model call', async () => {
  let calls = 0;
  const counting: ModelClient = { create: async (p) => { calls += 1; return fake().create(p); } };
  const s = await start(counting);
  try {
    for (const q of ['', '   ', 'x'.repeat(2001), 42]) assert.equal((await s.ask(q)).status, 400, String(q).slice(0, 10));
    const big = await fetch(`${s.base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.base }, body: JSON.stringify({ question: 'q', pad: 'x'.repeat(5000) }) }).catch(() => null);
    assert.ok(!big || big.status === 400);
    assert.equal(calls, 0);
  } finally { s.stop(); }
});

test('one question at a time: a second while one runs gets 409', async () => {
  let release!: () => void;
  const s = await start(fake(new Promise<void>((r) => { release = r; })));
  try {
    const first = s.ask('first');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await s.ask('second')).status, 409);
    release();
    assert.equal((await first).status, 200);
  } finally { s.stop(); }
});

test('replay reads only run records by name; a path outside the runs folder is refused', async () => {
  const s = await start(fake());
  try {
    writeFileSync(join(s.runsDir, 'not-a-run.txt'), 'secret');
    for (const name of ['..%2F..%2Fpackage.json', 'not-a-run.txt', '%2Fetc%2Fpasswd']) {
      assert.equal((await fetch(`${s.base}/api/runs/${name}`)).status, 400, name);
    }
    assert.equal((await fetch(`${s.base}/api/runs/2026-01-01T00-00-00-000Z.json`)).status, 404);
  } finally { s.stop(); }
});
