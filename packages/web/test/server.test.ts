import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startFakeBackend, startMcpServer, type FakeBackend, type TestServer } from '../../mcp-server/test/helpers.js';
import { activityRecorder } from '../server/activity.js';
import { createApp } from '../server/app.js';
import { Assistant } from '../server/assistant.js';
import { createMcpClient } from '../server/mcpClient.js';
import { RuleRouter } from '../server/router.js';
import { OfflineTranslator } from '../server/translate.js';

// End to end with no mocks on our side: the assistant links to the real MCP server with the
// real OAuth flow, discovers its tools, and drives the (fake) backend through them.
describe('assistant server', () => {
  let backend: FakeBackend;
  let mcp: TestServer;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    backend = await startFakeBackend();
    mcp = await startMcpServer(backend.url, { redirectUris: ['http://127.0.0.1/assistant-callback'] });
    const tools = createMcpClient({
      mcpUrl: mcp.base,
      clientId: mcp.config.clientId,
      clientSecret: mcp.config.clientSecret,
      ownerPasscode: mcp.config.ownerPasscode,
      redirectUri: 'http://127.0.0.1/assistant-callback',
    });
    const assistant = new Assistant({ translator: new OfflineTranslator(), router: new RuleRouter(), tools });
    const app = createApp({ assistant, tools, mode: 'offline', port: 4200, recordActivity: activityRecorder(backend.url) });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mcp.close();
    await backend.close();
  });

  const ask = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('reports that it is linked to the MCP server and lists its tools', async () => {
    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.mode).toBe('offline');
    expect(status.mcp.connected).toBe(true);
    expect(status.mcp.tools).toContain('run_device_for_duration');
  });

  it('turns a spoken English request into a real MCP tool call against the backend', async () => {
    const res = await ask({ text: 'turn on the lamp plug' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.steps.map((s: { kind: string }) => s.kind)).toEqual(['route', 'tool']);
    expect(body.reply).toBe('Okay, Lamp Plug is now on.');
    expect(backend.calls).toContain('power:lamp-plug:on');
  });

  it('logs each answered request for the TV exactly once (not again as Alexa+ activity)', async () => {
    await ask({ text: 'is the pump plug working' });
    await vi.waitFor(() => expect(backend.calls).toContain('activity:assistant:get_device_status'));
    expect(backend.calls.filter((c) => c.startsWith('activity:alexa'))).toEqual([]);
  });

  it('runs a timed request end to end', async () => {
    const body = await (await ask({ text: 'run the fan plug for 10 minutes' })).json();
    expect(body.reply).toContain('will switch off by itself in 10 minutes');
    expect(backend.calls).toContain('run:fan-plug:10');
  });

  it('reads alerts back in speakable text', async () => {
    const body = await (await ask({ text: 'are there any alerts' })).json();
    expect(body.reply).toContain('Pump Plug');
  });

  it('explains clearly that Tamil needs AWS when offline', async () => {
    const res = await ask({ text: 'பம்ப் பிளக் பழுதடைந்ததா?' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Tamil needs Amazon Translate');
  });

  it('validates input', async () => {
    expect((await ask({ text: '   ' })).status).toBe(400);
    expect((await ask({})).status).toBe(400);
    expect((await ask({ text: 'x'.repeat(501) })).status).toBe(400);
  });

  it('refuses requests from other web pages', async () => {
    expect((await ask({ text: 'turn on the lamp plug' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await ask({ text: 'are there any alerts' }, { Origin: 'http://localhost:5173' })).status).toBe(200);
  });
});
