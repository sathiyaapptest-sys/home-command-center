import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { linkAccount, startFakeBackend, startMcpServer, type FakeBackend, type TestServer } from './helpers.js';

describe('MCP server over Streamable HTTP', () => {
  let backend: FakeBackend;
  let server: TestServer;
  let client: Client;

  beforeAll(async () => {
    backend = await startFakeBackend();
    server = await startMcpServer(backend.url);
    const tokens = await linkAccount(server);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await backend.close();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    expect(Date.now() - started).toBeLessThan(500); // Alexa+'s round-trip budget
    return { text: result.content[0].text, isError: result.isError === true };
  };

  it('rejects unauthenticated requests with 401 and no WWW-Authenticate header', async () => {
    const res = await fetch(`${server.base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();

    const garbage = await fetch(`${server.base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
      body: '{}',
    });
    expect(garbage.status).toBe(401);
  });

  it('exposes the expected tools, each with a description', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_note',
      'get_device_status',
      'get_recent_alerts',
      'list_devices',
      'list_notes',
      'run_device_for_duration',
      'set_device_power',
    ]);
    for (const tool of tools) expect(tool.description?.length).toBeGreaterThan(20);
  });

  it('summarises the fleet in speakable text', async () => {
    const { text, isError } = await call('list_devices');
    expect(isError).toBe(false);
    expect(text).toContain('4 devices');
    expect(text).toContain('1 fault');
    expect(text).toContain('Needs attention: Pump Plug');
  });

  it('reports one device from a loosely spoken name', async () => {
    const faulty = await call('get_device_status', { device: 'pump plug' });
    expect(faulty.text).toContain('Pump Plug is faulty');
    const healthy = await call('get_device_status', { device: 'heater' });
    expect(healthy.text).toContain('Heater Plug is on, using 1000 W');
  });

  it('asks which device when the name is ambiguous, and says so when it is unknown', async () => {
    const ambiguous = await call('get_device_status', { device: 'plug' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('could mean');
    const unknown = await call('get_device_status', { device: 'toaster' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Your devices are');
  });

  it('reads the latest alert with its explanation', async () => {
    const { text } = await call('get_recent_alerts');
    expect(text).toContain('Pump Plug');
    expect(text).toContain('stopped drawing power 10 minutes');
  });

  it('turns a device on or off through the backend', async () => {
    const { text } = await call('set_device_power', { device: 'lamp plug', power: 'on' });
    expect(text).toBe('Okay, Lamp Plug is now on.');
    expect(backend.calls).toContain('power:lamp-plug:on');
  });

  it('starts a timed run on a healthy device', async () => {
    const { text, isError } = await call('run_device_for_duration', { device: 'fan', minutes: 10 });
    expect(isError).toBe(false);
    expect(text).toContain('will switch off by itself in 10 minutes');
    expect(backend.calls).toContain('run:fan-plug:10');
  });

  it('refuses a timed run on a faulty device and never calls the backend', async () => {
    // Activity-log posts from earlier calls arrive asynchronously, so only count device actions.
    const deviceActions = () => backend.calls.filter((c) => !c.startsWith('activity:')).length;
    const before = deviceActions();
    const { text, isError } = await call('run_device_for_duration', { device: 'pump plug', minutes: 5 });
    expect(isError).toBe(true);
    expect(text).toContain('faulty');
    expect(deviceActions()).toBe(before);
  });

  it('rejects out-of-range minutes at the schema level', async () => {
    const result = (await client
      .callTool({ name: 'run_device_for_duration', arguments: { device: 'fan', minutes: 5000 } })
      .catch((e: Error) => ({ isError: true, error: e.message }))) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it('saves and reads back notes', async () => {
    expect((await call('add_note', { text: 'Check the pump wiring on Saturday' })).text).toContain('Saved');
    expect(backend.calls).toContain('note:en:Check the pump wiring on Saturday');
    expect((await call('list_notes')).text).toContain('Check the pump wiring on Saturday');
  });

  it("reports Alexa+ tool calls to the activity log so the TV can show them", async () => {
    await call('get_recent_alerts');
    await vi.waitFor(() => expect(backend.calls).toContain('activity:alexa:get_recent_alerts'));
  });

  it("doesn't report calls our own assistant marks, since it logs them itself", async () => {
    const tokens = await linkAccount(server);
    const assistant = new Client({ name: 'assistant', version: '1.0.0' });
    await assistant.connect(
      new StreamableHTTPClientTransport(new URL(`${server.base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}`, 'X-Activity-Source': 'assistant' } },
      }),
    );
    const before = backend.calls.filter((c) => c.startsWith('activity:')).length;
    await assistant.callTool({ name: 'list_notes', arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(backend.calls.filter((c) => c.startsWith('activity:')).length).toBe(before);
    await assistant.close();
  });

  it('serves a privacy policy and a health check without authentication', async () => {
    expect((await fetch(`${server.base}/privacy`)).status).toBe(200);
    expect((await (await fetch(`${server.base}/health`)).json()).ok).toBe(true);
  });
});
