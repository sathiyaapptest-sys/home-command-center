import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApi } from '../../shared/src/api.js';
import type { Alert, Device, Note } from '../../shared/src/types.js';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { OAuthStore } from '../src/oauth/store.js';

export const REDIRECT_URI = 'https://pitangui.amazon.com/api/skill/link/M3TESTID';

export function makeDevice(id: string, name: string, vendor: string, state: Partial<Device['state']> = {}): Device {
  return {
    id,
    name,
    vendor,
    type: 'smart_plug',
    controlledVia: 'alexa',
    ratedWattage: 100,
    state: { power: 'off', responsive: true, wattage: 0, lastChangedAt: 0, turnedOnAt: null, ...state },
    health: { hoursOfOperation: 0.5, cumulativeEnergyWh: 50, lastAlertAt: null },
    custom: false,
  };
}

export const FAULT_ALERT: Alert = {
  id: 'a1',
  deviceId: 'pump-plug',
  pattern: 'drop_after_duration',
  severity: 'critical',
  message: 'went unresponsive',
  explanation: 'It stopped drawing power 10 minutes after being switched on.',
  createdAt: Date.UTC(2026, 9, 3, 14, 5),
};

export interface FakeBackend {
  url: string;
  calls: string[];
  close: () => Promise<void>;
}

export async function startFakeBackend(): Promise<FakeBackend> {
  const devices: Device[] = [
    makeDevice('lamp-plug', 'Lamp Plug', 'Acme'),
    makeDevice('pump-plug', 'Pump Plug', 'Acme', { power: 'on', responsive: false }),
    makeDevice('fan-plug', 'Fan Plug', 'Globex'),
    makeDevice('heater-plug', 'Heater Plug', 'Initech', { power: 'on', wattage: 1000 }),
  ];
  const notes: Note[] = [];
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.get('/devices', (_req, res) => res.json(devices));
  app.get('/alerts', (_req, res) => res.json([FAULT_ALERT]));
  app.get('/notes', (_req, res) => res.json(notes));
  app.post('/notes', (req, res) => {
    calls.push(`note:${req.body.languageInput}:${req.body.text}`);
    const note: Note = {
      id: 'n1',
      languageInput: req.body.languageInput,
      textOriginal: req.body.text,
      textEnglish: req.body.text,
      summary: null,
      createdAt: 0,
      updatedAt: 0,
    };
    notes.push(note);
    res.status(201).json(note);
  });
  app.post('/devices/:id/power', (req, res) => {
    calls.push(`power:${req.params.id}:${req.body.power}`);
    res.json(devices.find((d) => d.id === req.params.id));
  });
  app.get('/activity', (_req, res) => res.json([]));
  app.post('/activity', (req, res) => {
    calls.push(`activity:${req.body.source}:${req.body.tool}`);
    res.status(201).json({ ...req.body, id: 'act', at: 0 });
  });
  app.post('/devices/:id/run-for', (req, res) => {
    calls.push(`run:${req.params.id}:${req.body.minutes}`);
    res.status(201).json({ deviceId: req.params.id, minutes: req.body.minutes });
  });
  const server = await listen(app);
  return { url: urlOf(server), calls, close: () => close(server) };
}

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  port: 0,
  publicUrl: 'https://mcp.test',
  backendUrl: 'http://unused',
  clientId: 'test-client',
  clientSecret: 'test-secret-value',
  ownerPasscode: 'open-sesame',
  redirectUris: [],
  dataDir: '.data-test',
  accessTokenTtlSec: 3600,
  refreshTokenTtlSec: 86400,
  ...overrides,
});

export interface TestServer {
  base: string;
  config: Config;
  store: OAuthStore;
  close: () => Promise<void>;
}

export async function startMcpServer(backendUrl: string, overrides: Partial<Config> = {}, now?: () => number): Promise<TestServer> {
  const config = testConfig({ backendUrl, ...overrides });
  const store = new OAuthStore(undefined, config.accessTokenTtlSec, config.refreshTokenTtlSec, now);
  const server = await listen(createApp(config, store, createApi(backendUrl)));
  return { base: urlOf(server), config, store, close: () => close(server) };
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const urlOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

export function makePkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeQuery(config: Config, challenge: string, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${config.publicUrl}/mcp`,
    ...extra,
  });
}

export const basicAuth = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

export async function approve(server: TestServer, challenge: string, passcode = server.config.ownerPasscode) {
  const body = authorizeQuery(server.config, challenge, { passcode, decision: 'approve' });
  return fetch(`${server.base}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

export async function exchangeCode(server: TestServer, code: string, verifier: string, extra: Record<string, string> = {}) {
  return fetch(`${server.base}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(server.config.clientId, server.config.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: `${server.config.publicUrl}/mcp`,
      ...extra,
    }),
  });
}

/** Runs the whole linking flow and returns the issued tokens. */
export async function linkAccount(server: TestServer): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const { verifier, challenge } = makePkce();
  const approved = await approve(server, challenge);
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const response = await exchangeCode(server, code, verifier);
  return (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
}
