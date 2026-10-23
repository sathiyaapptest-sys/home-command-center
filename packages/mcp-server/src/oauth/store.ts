import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuthCodeData {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | undefined;
  scope: string;
  expiresAt: number;
}

interface TokenRecord {
  clientId: string;
  scope: string;
  resource: string | undefined;
  expiresAt: number;
}

interface Persisted {
  access: Record<string, TokenRecord>;
  refresh: Record<string, TokenRecord>;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

/**
 * Authorization codes live in memory (short-lived, single use). Access and refresh
 * tokens are stored hashed, and persisted to disk so a restart doesn't force the
 * customer to re-link their account.
 */
export class OAuthStore {
  private codes = new Map<string, AuthCodeData>();
  private data: Persisted = { access: {}, refresh: {} };

  constructor(
    private filePath?: string,
    private accessTtlSec = 3600,
    private refreshTtlSec = 60 * 60 * 24 * 30,
    private now: () => number = Date.now,
  ) {
    if (filePath && existsSync(filePath)) {
      try {
        this.data = JSON.parse(readFileSync(filePath, 'utf8')) as Persisted;
      } catch {
        this.data = { access: {}, refresh: {} };
      }
    }
  }

  createCode(data: Omit<AuthCodeData, 'expiresAt'>, ttlSec = 300): string {
    const code = newSecret();
    this.codes.set(sha256(code), { ...data, expiresAt: this.now() + ttlSec * 1000 });
    return code;
  }

  /** Single use: the code is removed whether or not it is still valid. */
  consumeCode(code: string): AuthCodeData | undefined {
    const key = sha256(code);
    const entry = this.codes.get(key);
    this.codes.delete(key);
    if (!entry || entry.expiresAt < this.now()) return undefined;
    return entry;
  }

  issueTokens(clientId: string, scope: string, resource: string | undefined): IssuedTokens {
    const accessToken = newSecret();
    const refreshToken = newSecret();
    const now = this.now();
    this.data.access[sha256(accessToken)] = { clientId, scope, resource, expiresAt: now + this.accessTtlSec * 1000 };
    this.data.refresh[sha256(refreshToken)] = { clientId, scope, resource, expiresAt: now + this.refreshTtlSec * 1000 };
    this.persist();
    return { accessToken, refreshToken, expiresIn: this.accessTtlSec };
  }

  /** Issues a fresh access token and keeps the same refresh token (not rotated, so a retried request can't lose it). */
  refresh(refreshToken: string, clientId: string): IssuedTokens | undefined {
    const record = this.data.refresh[sha256(refreshToken)];
    if (!record || record.clientId !== clientId || record.expiresAt < this.now()) return undefined;
    const accessToken = newSecret();
    this.data.access[sha256(accessToken)] = {
      clientId,
      scope: record.scope,
      resource: record.resource,
      expiresAt: this.now() + this.accessTtlSec * 1000,
    };
    this.persist();
    return { accessToken, refreshToken, expiresIn: this.accessTtlSec };
  }

  verifyAccess(token: string): TokenRecord | undefined {
    const record = this.data.access[sha256(token)];
    if (!record || record.expiresAt < this.now()) return undefined;
    return record;
  }

  private persist(): void {
    if (!this.filePath) return;
    const cutoff = this.now();
    for (const table of [this.data.access, this.data.refresh]) {
      for (const [key, record] of Object.entries(table)) {
        if (record.expiresAt < cutoff) delete table[key];
      }
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data), { mode: 0o600 });
  }
}
