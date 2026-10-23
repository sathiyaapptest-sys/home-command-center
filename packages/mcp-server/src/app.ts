import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CommandCenterApi } from '../../shared/src/api.js';
import { requireBearer } from './auth.js';
import type { Config } from './config.js';
import { oauthRouter } from './oauth/router.js';
import type { OAuthStore } from './oauth/store.js';
import { createMcpServer } from './tools.js';

const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. This server is stateless: use POST /mcp.' },
    id: null,
  });
};

export function createApp(config: Config, store: OAuthStore, api: CommandCenterApi, log: (line: string) => void = () => {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a tunnel / load balancer, so rate limiting sees the real client

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`));
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/privacy', (_req, res) => {
    res.type('html').send(PRIVACY_PAGE);
  });

  app.use(oauthRouter(config, store));

  // Stateless Streamable HTTP: a fresh MCP server + transport per request keeps the
  // service restartable and horizontally scalable.
  app.post('/mcp', requireBearer(store), express.json({ limit: '1mb' }), async (req, res) => {
    // Our own web assistant logs its requests (with the Tamil wording) itself, so its calls
    // are marked and skipped here to avoid showing them twice on the TV.
    const fromAssistant = req.headers['x-activity-source'] === 'assistant';
    const server = createMcpServer(
      api,
      fromAssistant
        ? undefined
        : (event) => {
            api
              .logActivity({
                source: 'alexa',
                language: 'en',
                input: null,
                inputEnglish: null,
                tool: event.tool,
                toolInput: event.input,
                reply: event.text,
                replyEnglish: null,
                isError: event.isError,
              })
              .catch((error: Error) => log(`activity log failed: ${error.message}`));
          },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log(`mcp error: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });
  app.get('/mcp', requireBearer(store), methodNotAllowed);
  app.delete('/mcp', requireBearer(store), methodNotAllowed);

  return app;
}

const PRIVACY_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy - Home Command Center</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#0f172a}</style>
<h1>Privacy Policy</h1>
<p>Home Command Center is a hackathon prototype that lets Alexa check and control a set of smart-home devices.</p>
<h2>What we collect</h2>
<p>When you link your account we store a hashed access token and refresh token so Alexa can keep working without asking you to link again. We store the device states and notes you create through the service. We do not collect your name, email address or location, and we do not sell or share your data.</p>
<h2>Retention and deletion</h2>
<p>Tokens expire automatically and you can unlink the skill in the Alexa app at any time, which stops all access. Ask the owner of this service to delete your notes and device data.</p>
<h2>Contact</h2>
<p>Questions about this prototype can be raised on the project's GitHub repository.</p>`;
