export interface Config {
  port: number;
  /** Public HTTPS origin Alexa reaches, no trailing slash (e.g. a tunnel or AWS URL). */
  publicUrl: string;
  backendUrl: string;
  clientId: string;
  clientSecret: string;
  /** Typed by the owner on the consent page when linking the account. */
  ownerPasscode: string;
  /** Extra exact-match redirect URIs, on top of the Alexa host pattern. */
  redirectUris: string[];
  dataDir: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
}

const REQUIRED = ['PUBLIC_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OWNER_PASSCODE'] as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
  }
  return {
    port: Number(env.PORT ?? 4100),
    publicUrl: env.PUBLIC_URL!.replace(/\/+$/, ''),
    backendUrl: env.BACKEND_URL ?? 'http://localhost:4000',
    clientId: env.OAUTH_CLIENT_ID!,
    clientSecret: env.OAUTH_CLIENT_SECRET!,
    ownerPasscode: env.OWNER_PASSCODE!,
    redirectUris: (env.OAUTH_REDIRECT_URIS ?? '')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean),
    dataDir: env.DATA_DIR ?? '.data',
    accessTokenTtlSec: Number(env.ACCESS_TOKEN_TTL_SEC ?? 3600),
    refreshTokenTtlSec: Number(env.REFRESH_TOKEN_TTL_SEC ?? 60 * 60 * 24 * 30),
  };
}

export const SCOPE = 'commandcenter.devices';
