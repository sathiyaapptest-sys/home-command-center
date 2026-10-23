import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolInfo } from './router.js';

export interface ToolResult {
  text: string;
  isError: boolean;
}

export interface McpTools {
  listTools(): Promise<ToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface McpClientOptions {
  /** Where the MCP server is reachable from this machine, e.g. http://127.0.0.1:4100 */
  mcpUrl: string;
  clientId: string;
  clientSecret: string;
  ownerPasscode: string;
  redirectUri: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 60_000;

/**
 * Links this assistant to the MCP server with the same OAuth 2.1 + PKCE flow Alexa+ uses
 * (authorization code, S256, resource indicator), so the demo exercises the real auth path
 * instead of a back door. The owner passcode plays the part of the person on the consent page.
 */
export async function linkAccount(options: McpClientOptions, now: () => number = Date.now): Promise<Tokens> {
  const metadata = (await (await fetch(`${options.mcpUrl}/.well-known/oauth-protected-resource`)).json()) as {
    resource: string;
  };

  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const approval = await fetch(`${options.mcpUrl}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      response_type: 'code',
      state: randomBytes(8).toString('hex'),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: metadata.resource,
      passcode: options.ownerPasscode,
      decision: 'approve',
    }),
  });
  const location = approval.headers.get('location');
  const code = location ? new URL(location).searchParams.get('code') : null;
  if (!code) {
    const hint =
      approval.status === 401
        ? 'the owner passcode was rejected'
        : approval.status === 429
          ? 'too many wrong passcodes; wait 15 minutes'
          : approval.status === 400
            ? 'the redirect URI is not allowed (add it to OAUTH_REDIRECT_URIS on the MCP server)'
            : `unexpected status ${approval.status}`;
    throw new Error(`Could not link to the MCP server: ${hint}`);
  }

  const response = await fetch(`${options.mcpUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: options.redirectUri,
      code_verifier: verifier,
      resource: metadata.resource,
    }),
  });
  if (!response.ok) throw new Error(`Token request failed with status ${response.status}`);
  const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + body.expires_in * 1000 };
}

export function createMcpClient(options: McpClientOptions): McpTools {
  let client: Client | undefined;
  let tokens: Tokens | undefined;

  const reset = async () => {
    const old = client;
    client = undefined;
    tokens = undefined;
    await old?.close().catch(() => {});
  };

  async function connected(): Promise<Client> {
    if (client && tokens && tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) return client;
    await reset();
    tokens = await linkAccount(options);
    const next = new Client({ name: 'command-center-assistant', version: '0.1.0' });
    await next.connect(
      new StreamableHTTPClientTransport(new URL(`${options.mcpUrl}/mcp`), {
        // Marks our calls so the MCP server doesn't log them a second time as Alexa+ activity.
        requestInit: { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Activity-Source': 'assistant' } },
      }),
    );
    client = next;
    return next;
  }

  // One retry after a full reconnect covers an expired token or a restarted server.
  async function withClient<T>(run: (c: Client) => Promise<T>): Promise<T> {
    try {
      return await run(await connected());
    } catch {
      await reset();
      return run(await connected());
    }
  }

  return {
    async listTools() {
      const { tools } = await withClient((c) => c.listTools());
      return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name, args) {
      const result = (await withClient((c) => c.callTool({ name, arguments: args }))) as {
        content?: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = (result.content ?? []).map((part) => part.text ?? '').join(' ').trim();
      return { text, isError: result.isError === true };
    },
  };
}
