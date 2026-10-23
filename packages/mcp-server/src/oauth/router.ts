import { timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { SCOPE, type Config } from '../config.js';
import { isValidChallenge, verifyS256 } from './pkce.js';
import type { OAuthStore } from './store.js';

// Alexa links accounts through region-specific redirect URIs, so a single exact URI
// would fail for customers registered elsewhere. Extra exact URIs can be added with
// OAUTH_REDIRECT_URIS (the CLI prints the official list after configure-account-linking).
const ALEXA_REDIRECT = /^https:\/\/(alexa|pitangui|layla)\.amazon\.[a-z.]+\/api\/skill\/link\/[A-Za-z0-9]+$/;

const MAX_FAILED_PASSCODES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Params = Record<string, string | undefined>;

interface ValidAuthRequest {
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string | undefined;
  scope: string;
}

type AuthValidation =
  | { ok: true; request: ValidAuthRequest }
  | { ok: false; page: string }
  | { ok: false; redirect: { redirectUri: string; state: string | undefined; error: string; description: string } };

export function authorizationMetadata(config: Config) {
  return {
    issuer: config.publicUrl,
    authorization_endpoint: `${config.publicUrl}/authorize`,
    token_endpoint: `${config.publicUrl}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: [SCOPE],
    // Amazon's docs describe this metadata document both as the authorization server's and
    // as the protected resource's, so it carries both sets of fields.
    resource: `${config.publicUrl}/mcp`,
    authorization_servers: [config.publicUrl],
    bearer_methods_supported: ['header'],
  };
}

export function oauthRouter(config: Config, store: OAuthStore, now: () => number = Date.now): Router {
  const router = Router();
  const canonicalResource = `${config.publicUrl}/mcp`;
  const failedAttempts = new Map<string, { count: number; resetAt: number }>();

  const isLockedOut = (ip: string): boolean => {
    const entry = failedAttempts.get(ip);
    if (!entry) return false;
    if (entry.resetAt < now()) {
      failedAttempts.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILED_PASSCODES;
  };
  const recordFailure = (ip: string) => {
    const entry = failedAttempts.get(ip);
    if (!entry || entry.resetAt < now()) failedAttempts.set(ip, { count: 1, resetAt: now() + LOCKOUT_MS });
    else entry.count += 1;
  };

  function validateAuthRequest(params: Params): AuthValidation {
    if (params.client_id !== config.clientId) {
      return { ok: false, page: errorPage('Unknown client', 'This link request is not from a registered application.') };
    }
    const redirectUri = params.redirect_uri;
    if (!redirectUri || !(config.redirectUris.includes(redirectUri) || ALEXA_REDIRECT.test(redirectUri))) {
      return { ok: false, page: errorPage('Invalid redirect', 'The redirect address is not allowed for this application.') };
    }
    const fail = (error: string, description: string): AuthValidation => ({
      ok: false,
      redirect: { redirectUri, state: params.state, error, description },
    });

    if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
    if (!params.code_challenge || !isValidChallenge(params.code_challenge)) {
      return fail('invalid_request', 'A valid PKCE code_challenge is required.');
    }
    if (params.code_challenge_method !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256.');
    if (params.resource !== undefined && params.resource !== canonicalResource) {
      return fail('invalid_target', 'The resource parameter does not match this server.');
    }
    const requested = (params.scope ?? '').split(/\s+/).filter(Boolean);
    if (requested.some((s) => s !== SCOPE)) return fail('invalid_scope', 'Unsupported scope requested.');

    return {
      ok: true,
      request: {
        redirectUri,
        state: params.state,
        codeChallenge: params.code_challenge,
        resource: params.resource,
        scope: SCOPE,
      },
    };
  }

  const redirectWith = (res: Response, redirectUri: string, query: Record<string, string | undefined>) => {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
    res.redirect(302, url.toString());
  };

  const sendValidationFailure = (res: Response, result: Extract<AuthValidation, { ok: false }>) => {
    if ('page' in result) {
      res.status(400).type('html').send(result.page);
      return;
    }
    redirectWith(res, result.redirect.redirectUri, {
      error: result.redirect.error,
      error_description: result.redirect.description,
      state: result.redirect.state,
    });
  };

  router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => {
    res.json(authorizationMetadata(config));
  });

  router.get('/authorize', (req: Request, res: Response) => {
    const result = validateAuthRequest(req.query as Params);
    if (!result.ok) return sendValidationFailure(res, result);
    res.type('html').send(consentPage(req.query as Params));
  });

  router.post('/authorize', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const body = req.body as Params;
    const result = validateAuthRequest(body);
    if (!result.ok) return sendValidationFailure(res, result);

    if (body.decision === 'deny') {
      return redirectWith(res, result.request.redirectUri, { error: 'access_denied', state: result.request.state });
    }

    const ip = req.ip ?? 'unknown';
    if (isLockedOut(ip)) {
      res.status(429).type('html').send(consentPage(body, 'Too many incorrect passcodes. Try again in 15 minutes.'));
      return;
    }
    if (!body.passcode || !safeEqual(body.passcode, config.ownerPasscode)) {
      recordFailure(ip);
      res.status(401).type('html').send(consentPage(body, 'Incorrect passcode.'));
      return;
    }

    const code = store.createCode({
      clientId: config.clientId,
      redirectUri: result.request.redirectUri,
      codeChallenge: result.request.codeChallenge,
      resource: result.request.resource,
      scope: result.request.scope,
    });
    redirectWith(res, result.request.redirectUri, { code, state: result.request.state });
  });

  router.post('/token', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Params;
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    const oauthError = (status: number, error: string, description: string) =>
      res.status(status).json({ error, error_description: description });

    let clientId = body.client_id;
    let clientSecret = body.client_secret;
    const basic = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (basic) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > -1) {
        clientId = decodeURIComponent(decoded.slice(0, separator));
        clientSecret = decodeURIComponent(decoded.slice(separator + 1));
      }
    }
    if (clientId !== config.clientId || !clientSecret || !safeEqual(clientSecret, config.clientSecret)) {
      return oauthError(401, 'invalid_client', 'Client authentication failed.');
    }
    if (body.resource !== undefined && body.resource !== canonicalResource) {
      return oauthError(400, 'invalid_target', 'The resource parameter does not match this server.');
    }

    const respond = (tokens: { accessToken: string; refreshToken: string; expiresIn: number }) =>
      res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: SCOPE,
      });

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        return oauthError(400, 'invalid_request', 'code, redirect_uri and code_verifier are required.');
      }
      const entry = store.consumeCode(body.code);
      if (!entry || entry.clientId !== clientId || entry.redirectUri !== body.redirect_uri) {
        return oauthError(400, 'invalid_grant', 'The authorization code is invalid, expired or already used.');
      }
      if (!verifyS256(body.code_verifier, entry.codeChallenge)) {
        return oauthError(400, 'invalid_grant', 'PKCE verification failed.');
      }
      return respond(store.issueTokens(clientId, entry.scope, entry.resource));
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError(400, 'invalid_request', 'refresh_token is required.');
      const tokens = store.refresh(body.refresh_token, clientId);
      if (!tokens) return oauthError(400, 'invalid_grant', 'The refresh token is invalid or expired.');
      return respond(tokens);
    }

    return oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });

  return router;
}

const PAGE_STYLE = `
  body{font-family:-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#f1f5f9;display:flex;justify-content:center;padding:48px 16px}
  main{max-width:420px;width:100%}h1{font-size:22px}p{color:#94a3b8;line-height:1.5}
  input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border-radius:8px;border:1px solid #334155;background:#121a2b;color:#f1f5f9;margin:8px 0 16px}
  button{padding:12px 20px;font-size:16px;border-radius:8px;border:0;cursor:pointer;margin-right:8px}
  .primary{background:#38bdf8;color:#0b1220;font-weight:600}.secondary{background:#1a2540;color:#f1f5f9}
  .error{color:#f87171}`;

function errorPage(title: string, message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`;
}

const FORWARDED_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'];

function consentPage(params: Params, error?: string): string {
  const hidden = FORWARDED_FIELDS.filter((f) => params[f] !== undefined)
    .map((f) => `<input type="hidden" name="${f}" value="${escapeHtml(params[f]!)}">`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Home Command Center</title><style>${PAGE_STYLE}</style>
<main><h1>Link Alexa to Home Command Center</h1>
<p>Alexa is asking to check and control the devices in your Home Command Center. Enter the owner passcode to allow this.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize">${hidden}
<label for="passcode">Owner passcode</label>
<input id="passcode" name="passcode" type="password" autocomplete="off" autofocus>
<button class="primary" name="decision" value="approve">Allow</button><button class="secondary" name="decision" value="deny" formnovalidate>Cancel</button>
</form></main>`;
}
