import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isValidSessionId, makeSessionId } from '../src/transportGuards.js';
import { linkAccount, startFakeBackend, startMcpServer, type FakeBackend, type TestServer } from './helpers.js';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'transport-test', version: '1.0.0' } },
};
const PING = { jsonrpc: '2.0', id: 2, method: 'ping' };

describe('MCP transport rules', () => {
  let backend: FakeBackend;
  let server: TestServer;
  let token: string;

  const post = (body: unknown, headers: Record<string, string> = {}, query = '') =>
    fetch(`${server.base}/mcp${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const newSession = async () => {
    const res = await post(INITIALIZE);
    expect(res.status).toBe(200);
    return res.headers.get('mcp-session-id')!;
  };

  beforeAll(async () => {
    backend = await startFakeBackend();
    server = await startMcpServer(backend.url);
    token = (await linkAccount(server)).access_token;
  });

  afterAll(async () => {
    await server.close();
    await backend.close();
  });

  describe('sessions', () => {
    it('issues an Mcp-Session-Id on initialize and accepts it afterwards', async () => {
      const sessionId = await newSession();
      expect(sessionId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect((await post(PING, { 'Mcp-Session-Id': sessionId })).status).toBe(200);
    });

    it('answers 400 when the session id is missing and 404 when it is not one we issued', async () => {
      expect((await post(PING)).status).toBe(400);
      expect((await post(PING, { 'Mcp-Session-Id': 'forged.abcdefghijklmnopqrstuv' })).status).toBe(404);
      expect((await post(PING, { 'Mcp-Session-Id': 'not-even-shaped-right' })).status).toBe(404);
    });

    it('still negotiates 2025-11-25', async () => {
      const res = await post(INITIALIZE);
      expect(await res.text()).toContain('"protocolVersion":"2025-11-25"');
    });

    it('signs ids so tampering or another key is detected, without any stored state', () => {
      const id = makeSessionId('key-a');
      expect(isValidSessionId('key-a', id)).toBe(true);
      expect(isValidSessionId('key-b', id)).toBe(false);
      expect(isValidSessionId('key-a', id.replace(/.$/, (c) => (c === 'x' ? 'y' : 'x')))).toBe(false);
      expect(isValidSessionId('key-a', `${id}.extra`)).toBe(false);
      expect(makeSessionId('key-a')).not.toBe(id);
    });
  });

  describe('origin validation', () => {
    it('refuses a foreign Origin with 403, even with a valid token and session', async () => {
      const sessionId = await newSession();
      const res = await post(PING, { 'Mcp-Session-Id': sessionId, Origin: 'http://evil.example.com' });
      expect(res.status).toBe(403);
    });

    it('accepts requests with no Origin (server-to-server) and with our own origin', async () => {
      const sessionId = await newSession();
      expect((await post(PING, { 'Mcp-Session-Id': sessionId })).status).toBe(200);
      expect((await post(PING, { 'Mcp-Session-Id': sessionId, Origin: 'https://mcp.test' })).status).toBe(200);
    });

    it('applies to GET and DELETE as well', async () => {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${server.base}/mcp`, {
          method,
          headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.example.com' },
        });
        expect(res.status).toBe(403);
      }
    });
  });

  describe('token placement and message shape', () => {
    it('refuses a token in the query string, with or without an Authorization header', async () => {
      const sessionId = await newSession();
      const both = await post(PING, { 'Mcp-Session-Id': sessionId }, `?access_token=${token}`);
      expect(both.status).toBe(400);
      expect((await both.json()).error).toBe('invalid_request');
      const only = await fetch(`${server.base}/mcp?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify(PING),
      });
      expect(only.status).toBe(400);
    });

    it('refuses a JSON-RPC batch with -32600', async () => {
      const sessionId = await newSession();
      const res = await post([PING, { ...PING, id: 3 }], { 'Mcp-Session-Id': sessionId });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(-32600);
    });
  });
});
