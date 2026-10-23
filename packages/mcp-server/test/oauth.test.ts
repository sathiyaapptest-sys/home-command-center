import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isValidChallenge, verifyS256 } from '../src/oauth/pkce.js';
import {
  REDIRECT_URI,
  approve,
  authorizeQuery,
  basicAuth,
  exchangeCode,
  linkAccount,
  makePkce,
  startMcpServer,
  type TestServer,
} from './helpers.js';

describe('PKCE', () => {
  it('accepts the matching verifier and rejects others', () => {
    const { verifier, challenge } = makePkce();
    expect(isValidChallenge(challenge)).toBe(true);
    expect(verifyS256(verifier, challenge)).toBe(true);
    expect(verifyS256(makePkce().verifier, challenge)).toBe(false);
    expect(verifyS256('too-short', challenge)).toBe(false);
  });
});

describe('OAuth authorization server', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startMcpServer('http://unused');
  });
  afterAll(async () => server.close());

  it('publishes metadata that requires PKCE S256 and names the MCP resource', async () => {
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource']) {
      const meta = await (await fetch(`${server.base}${path}`)).json();
      expect(meta.code_challenge_methods_supported).toEqual(['S256']);
      expect(meta.authorization_endpoint).toBe('https://mcp.test/authorize');
      expect(meta.token_endpoint).toBe('https://mcp.test/token');
      expect(meta.resource).toBe('https://mcp.test/mcp');
      expect(meta.authorization_servers).toEqual(['https://mcp.test']);
    }
  });

  it('refuses an unknown client or a redirect URI that is not Alexa', async () => {
    const { challenge } = makePkce();
    const unknown = await fetch(`${server.base}/authorize?${authorizeQuery(server.config, challenge, { client_id: 'nope' })}`);
    expect(unknown.status).toBe(400);
    const evil = await fetch(
      `${server.base}/authorize?${authorizeQuery(server.config, challenge, { redirect_uri: 'https://evil.example/cb' })}`,
      { redirect: 'manual' },
    );
    expect(evil.status).toBe(400);
    expect(evil.headers.get('location')).toBeNull();
  });

  it.each([
    ['no PKCE challenge', { code_challenge: '' }, 'invalid_request'],
    ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['wrong resource', { resource: 'https://other.example/mcp' }, 'invalid_target'],
    ['unsupported scope', { scope: 'admin' }, 'invalid_scope'],
    ['implicit flow', { response_type: 'token' }, 'unsupported_response_type'],
  ])('redirects an error for %s', async (_name, extra, error) => {
    const { challenge } = makePkce();
    const query = authorizeQuery(server.config, challenge, extra);
    if ((extra as Record<string, string>).code_challenge === '') query.delete('code_challenge');
    const res = await fetch(`${server.base}/authorize?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('state')).toBe('xyz');
  });

  it('shows the consent page for a valid request', async () => {
    const { challenge } = makePkce();
    const res = await fetch(`${server.base}/authorize?${authorizeQuery(server.config, challenge)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Owner passcode');
  });

  it('does not issue a code for a wrong passcode', async () => {
    const { challenge } = makePkce();
    const res = await approve(server, challenge, 'wrong');
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });

  it('returns access_denied when the owner cancels', async () => {
    const { challenge } = makePkce();
    const res = await fetch(`${server.base}/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: authorizeQuery(server.config, challenge, { decision: 'deny' }),
    });
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });

  it('completes the code flow, then refreshes without changing the refresh token', async () => {
    const tokens = await linkAccount(server);
    expect(tokens.expires_in).toBe(3600);
    expect(server.store.verifyAccess(tokens.access_token)).toBeDefined();

    const refreshed = await fetch(`${server.base}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(server.config.clientId, server.config.clientSecret),
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    const next = await refreshed.json();
    expect(refreshed.status).toBe(200);
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).toBe(tokens.refresh_token);
    expect(server.store.verifyAccess(next.access_token)).toBeDefined();
  });

  it('accepts client credentials in the body as well as Basic auth', async () => {
    const { verifier, challenge } = makePkce();
    const code = new URL((await approve(server, challenge)).headers.get('location')!).searchParams.get('code')!;
    const res = await fetch(`${server.base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        client_id: server.config.clientId,
        client_secret: server.config.clientSecret,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a code replayed after use', async () => {
    const { verifier, challenge } = makePkce();
    const code = new URL((await approve(server, challenge)).headers.get('location')!).searchParams.get('code')!;
    expect((await exchangeCode(server, code, verifier)).status).toBe(200);
    const replay = await exchangeCode(server, code, verifier);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe('invalid_grant');
  });

  it('rejects the wrong PKCE verifier', async () => {
    const { challenge } = makePkce();
    const code = new URL((await approve(server, challenge)).headers.get('location')!).searchParams.get('code')!;
    const res = await exchangeCode(server, code, makePkce().verifier);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a different redirect_uri at the token endpoint', async () => {
    const { verifier, challenge } = makePkce();
    const code = new URL((await approve(server, challenge)).headers.get('location')!).searchParams.get('code')!;
    const res = await exchangeCode(server, code, verifier, { redirect_uri: 'https://pitangui.amazon.com/api/skill/link/OTHER' });
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a wrong client secret and a mismatched resource', async () => {
    const { verifier, challenge } = makePkce();
    const code = new URL((await approve(server, challenge)).headers.get('location')!).searchParams.get('code')!;
    const badSecret = await fetch(`${server.base}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(server.config.clientId, 'not-the-secret'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }),
    });
    expect(badSecret.status).toBe(401);
    const badResource = await exchangeCode(server, code, verifier, { resource: 'https://other.example/mcp' });
    expect((await badResource.json()).error).toBe('invalid_target');
  });

  it('expires access tokens', async () => {
    let clock = 1_000_000;
    const timed = await startMcpServer('http://unused', {}, () => clock);
    const tokens = await linkAccount(timed);
    expect(timed.store.verifyAccess(tokens.access_token)).toBeDefined();
    clock += 3600 * 1000 + 1;
    expect(timed.store.verifyAccess(tokens.access_token)).toBeUndefined();
    await timed.close();
  });

  it('locks out passcode guessing after repeated failures', async () => {
    const guarded = await startMcpServer('http://unused');
    const { challenge } = makePkce();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await approve(guarded, challenge, `guess-${i}`)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    expect((await approve(guarded, challenge)).status).toBe(429); // even the right passcode is refused while locked
    await guarded.close();
  });
});
