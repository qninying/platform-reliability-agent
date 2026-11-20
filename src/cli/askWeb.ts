// Usage: npm run ask:web   then open http://localhost:4317
// Starts the local Ask Ellis page (src/web/). Same settings as `npm run ask` (see .env.example), plus
// ELLIS_WEB_PORT (default 4317). Listens on 127.0.0.1 only. Stop it with Ctrl+C.
import Anthropic from '@anthropic-ai/sdk';
import { createAskServer } from '../web/server.ts';

const port = Number(process.env.ELLIS_WEB_PORT || 4317);
const maxSteps = Number(process.env.ELLIS_MAX_STEPS || 8);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
  console.error(JSON.stringify({ error_class: 'ValidationError', message: 'ELLIS_WEB_PORT must be 1024 to 65535 and ELLIS_MAX_STEPS 1 to 20' }));
  process.exit(1);
}

const anthropic = new Anthropic({ timeout: 120_000, maxRetries: 2 });
const server = createAskServer({
  client: { create: (p) => anthropic.beta.messages.create(p) },
  agent: {
    model: process.env.ELLIS_MODEL || 'claude-sonnet-5-5',
    maxSteps,
    tools: { repoRoot: process.cwd(), platformSource: process.env.ELLIS_PLATFORM_SOURCE || null, timeoutMs: 60_000 },
  },
  runsDir: '.ellis/runs',
});
server.listen(port, '127.0.0.1', () => console.log(`Ask Ellis: http://localhost:${port}  (Ctrl+C to stop)`));
