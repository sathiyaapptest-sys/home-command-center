import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from './config.js';

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

/** Origins a browser may call /mcp from: our own public origin, plus any configured extras. */
export function allowedOrigins(config: Config): Set<string> {
  return new Set([
    new URL(config.publicUrl).origin,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    ...config.allowedOrigins,
  ]);
}

/**
 * MCP 2025-11-25 transports: servers MUST validate Origin to stop DNS-rebinding attacks, and
 * answer 403 when it is present but not allowed. Server-to-server callers (Alexa+, our own
 * assistant) send no Origin and are unaffected.
 */
export function originGuard(config: Config) {
  const allowed = allowedOrigins(config);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      jsonRpcError(res, 403, -32000, 'Origin not allowed');
      return;
    }
    next();
  };
}

/** The Alexa+ quickstart forbids sending the bearer token in the query string (it leaks into logs). */
export function rejectQueryToken(req: Request, res: Response, next: NextFunction) {
  if (req.query.access_token !== undefined) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Send the access token in the Authorization header, never in the query string.',
    });
    return;
  }
  next();
}

/** A 2025-11-25 POST body is a single JSON-RPC message; batching was removed from MCP. */
export function rejectBatch(req: Request, res: Response, next: NextFunction) {
  if (Array.isArray(req.body)) {
    jsonRpcError(res, 400, -32600, 'Batch requests are not supported: send one JSON-RPC message per POST.');
    return;
  }
  next();
}

const hmac = (key: string, value: string) => createHmac('sha256', key).update(value).digest('base64url').slice(0, 22);

/**
 * Session ids are self-verifying (random nonce + HMAC), so the server can issue and check them
 * without storing anything: it stays stateless, restartable and horizontally scalable while
 * still giving clients the Mcp-Session-Id the Streamable HTTP transport expects.
 */
export function makeSessionId(key: string): string {
  const nonce = randomBytes(16).toString('base64url');
  return `${nonce}.${hmac(key, nonce)}`;
}

export function isValidSessionId(key: string, id: string): boolean {
  const [nonce, mac, ...rest] = id.split('.');
  if (!nonce || !mac || rest.length > 0) return false;
  const expected = Buffer.from(hmac(key, nonce));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Issues an Mcp-Session-Id on initialize; every later request must carry a valid one
 * (400 when missing, 404 when it is not one we issued, so the client re-initializes).
 */
export function sessionGuard(config: Config) {
  const key = `${config.clientSecret}:mcp-session`;
  return (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as { method?: unknown } | undefined;
    if (body?.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', makeSessionId(key));
      next();
      return;
    }
    const presented = req.headers['mcp-session-id'];
    if (typeof presented !== 'string' || presented === '') {
      jsonRpcError(res, 400, -32000, 'Missing Mcp-Session-Id header: send initialize first.');
      return;
    }
    if (!isValidSessionId(key, presented)) {
      jsonRpcError(res, 404, -32001, 'Unknown session: send initialize again.');
      return;
    }
    next();
  };
}
