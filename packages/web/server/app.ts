import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { AskResult, Assistant } from './assistant.js';
import type { McpTools } from './mcpClient.js';

export interface AppDeps {
  assistant: Assistant;
  tools: McpTools;
  mode: 'aws' | 'offline';
  port: number;
  voice?: boolean;
  /** Called after each answered request, e.g. to show it on the TV. Failures are ignored. */
  recordActivity?: (input: string, result: AskResult) => Promise<void>;
}

/** Only the local UI may call this server: it holds AWS and MCP access. */
export function originChecker(port: number) {
  const allowed = new Set([5173, port].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]));
  return (origin: string | undefined) => origin === undefined || allowed.has(origin);
}

const MAX_INPUT_CHARS = 500;

export function createApp({ assistant, tools, mode, port, voice = false, recordActivity }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');

  // A web page on another origin must not be able to drive this server just because it
  // runs in your browser.
  const isOriginAllowed = originChecker(port);
  app.use((req, res, next) => {
    if (!isOriginAllowed(req.headers.origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/status', async (_req, res) => {
    try {
      const list = await tools.listTools();
      res.json({ mode, voice, mcp: { connected: true, tools: list.map((t) => t.name) } });
    } catch (error) {
      res.json({ mode, voice, mcp: { connected: false, error: error instanceof Error ? error.message : String(error) } });
    }
  });

  app.post('/api/ask', async (req, res) => {
    const { text, language } = (req.body ?? {}) as { text?: unknown; language?: unknown };
    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'Say or type something first.' });
      return;
    }
    if (text.length > MAX_INPUT_CHARS) {
      res.status(400).json({ error: `Keep it under ${MAX_INPUT_CHARS} characters.` });
      return;
    }
    const hint = language === 'ta' || language === 'en' ? language : 'auto';
    try {
      const result = await assistant.ask(text, hint);
      res.json(result);
      recordActivity?.(text.trim(), result).catch(() => {});
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
  }
  return app;
}
