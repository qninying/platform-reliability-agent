// The local "Ask Ellis" page for demos: a question box, the checks the agent runs as they happen, the answer, the
// guardrail's decisions, and saved runs to replay without calling the model.
//
// Local only, by design. It listens on 127.0.0.1, answers only requests addressed to localhost, and accepts a
// question only from its own page (same Origin, JSON body), so another website open in the same browser cannot
// spend the operator's API credits. One question runs at a time; a second gets 409.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { askEllis, type ModelClient, type AgentOptions, type AgentEvent } from '../agent/loop.ts';
import { writeRun, type AgentRun } from '../agent/record.ts';
import { describe } from '../agent/errors.ts';

export interface WebOptions { client: ModelClient; agent: Omit<AgentOptions, 'onEvent'>; runsDir: string }

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
const RUN_FILE = /^[0-9TZ-]+\.json$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const MAX_BODY = 4096;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function listRuns(dir: string) {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => RUN_FILE.test(f)); } catch { return []; }
  return files.sort().reverse().slice(0, 20).flatMap((file) => {
    try {
      const r = JSON.parse(readFileSync(join(dir, file), 'utf8')) as AgentRun;
      return [{ file, question: r.question, outcome: r.outcome, started_at: r.started_at, estimated_cost_usd: r.estimated_cost_usd }];
    } catch { return []; } // an unreadable record is left out of the list, not shown as empty
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new RangeError('request body too large')); req.destroy(); } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

export function createAskServer(o: WebOptions): Server {
  let busy = false;

  async function ask(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host!;
    const origin = req.headers.origin;
    if (origin !== `http://${host}`) return json(res, 403, { error: 'questions are accepted only from this page' });
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'send JSON' });
    let question: unknown;
    try { question = JSON.parse(await readBody(req)).question; } catch (err) { return json(res, 400, { error: (err as Error).message }); }
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) return json(res, 400, { error: 'ask one question of 1 to 2000 characters' });
    if (busy) return json(res, 409, { error: 'a question is already running' });

    busy = true;
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    const line = (e: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(e) + '\n'); };
    try {
      const run = await askEllis(question.trim(), o.client, { ...o.agent, onEvent: (e: AgentEvent) => line(e) });
      const file = writeRun(run, o.runsDir);
      line({ type: 'done', run, file: file.split('/').pop() });
    } catch (err) {
      line({ type: 'error', ...describe(err) });
    } finally {
      busy = false;
      res.end();
    }
  }

  return createServer(async (req, res) => {
    try {
      if (!LOCAL_HOST.test(req.headers.host ?? '')) return json(res, 403, { error: 'local requests only' });
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
        return res.end(PAGE);
      }
      if (req.method === 'GET' && path === '/api/runs') return json(res, 200, listRuns(o.runsDir));
      if (req.method === 'GET' && path.startsWith('/api/runs/')) {
        const name = decodeURIComponent(path.slice('/api/runs/'.length));
        if (!RUN_FILE.test(name)) return json(res, 400, { error: 'not a run record name' });
        try { return json(res, 200, JSON.parse(readFileSync(join(o.runsDir, name), 'utf8'))); } catch { return json(res, 404, { error: 'no such run' }); }
      }
      if (req.method === 'POST' && path === '/api/ask') return await ask(req, res);
      json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error(JSON.stringify({ event: 'ask_web_failed', ...describe(err) }));
      if (!res.headersSent) json(res, 500, { error: 'internal error' }); else res.end();
    }
  });
}
