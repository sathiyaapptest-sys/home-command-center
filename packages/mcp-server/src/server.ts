import { join } from 'node:path';
import { createApi } from '../../shared/src/api.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { OAuthStore } from './oauth/store.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const store = new OAuthStore(join(config.dataDir, 'oauth.json'), config.accessTokenTtlSec, config.refreshTokenTtlSec);
const api = createApi(config.backendUrl);
const app = createApp(config, store, api, (line) => console.log(`${new Date().toISOString()} ${line}`));

// Loopback only by default: a tunnel or reverse proxy on this machine still reaches it, but other
// devices on the home network cannot. Set HOST=0.0.0.0 when deploying behind a load balancer.
const host = process.env.HOST ?? '127.0.0.1';

app.listen(config.port, host, () => {
  console.log(`MCP server listening on ${host}:${config.port}`);
  console.log(`  public URL: ${config.publicUrl}`);
  console.log(`  MCP endpoint: ${config.publicUrl}/mcp`);
  console.log(`  backend: ${config.backendUrl}`);
});
