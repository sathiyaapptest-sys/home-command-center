import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { TranslateClient } from '@aws-sdk/client-translate';
import { activityRecorder } from './activity.js';
import { createApp, originChecker } from './app.js';
import { Assistant } from './assistant.js';
import { loadConfig } from './config.js';
import { createMcpClient } from './mcpClient.js';
import { BedrockRouter, RuleRouter } from './router.js';
import { AwsTranscriber } from './transcribe.js';
import { AwsTranslator, OfflineTranslator } from './translate.js';
import { attachVoice } from './voice.js';

// Own .env first. The OAuth client and owner passcode are also read from the MCP server's
// .env so those secrets live in one place, but only those three keys: its PORT, PUBLIC_URL
// and the rest are the MCP server's own settings. Already-set variables are never overridden.
const SHARED_KEYS = ['OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OWNER_PASSCODE'];
try {
  process.loadEnvFile('.env');
} catch {
  // no .env of our own
}
try {
  const shared = parseEnv(readFileSync('../mcp-server/.env', 'utf8'));
  for (const key of SHARED_KEYS) if (shared[key] && !process.env[key]) process.env[key] = shared[key];
} catch {
  // MCP server's .env not present
}

const config = loadConfig();
const tools = createMcpClient({
  mcpUrl: config.mcpUrl,
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  ownerPasscode: config.ownerPasscode,
  redirectUri: config.redirectUri,
});

const assistant =
  config.mode === 'aws'
    ? new Assistant({
        translator: new AwsTranslator(new TranslateClient({ region: config.awsRegion })),
        router: new BedrockRouter(new BedrockRuntimeClient({ region: config.awsRegion }), config.modelId),
        tools,
      })
    : new Assistant({ translator: new OfflineTranslator(), router: new RuleRouter(), tools });

// Voice needs Amazon Transcribe, so it exists only in AWS mode; offline the UI hides the mic.
const transcriber =
  config.mode === 'aws' ? new AwsTranscriber(new TranscribeStreamingClient({ region: config.awsRegion })) : undefined;

const app = createApp({
  assistant,
  tools,
  mode: config.mode,
  port: config.port,
  voice: Boolean(transcriber),
  recordActivity: activityRecorder(config.backendUrl),
});
const server = app.listen(config.port, config.host, () => {
  console.log(`Assistant listening on ${config.host}:${config.port} (mode: ${config.mode}, voice: ${transcriber ? 'on' : 'off'})`);
  console.log(`  MCP server: ${config.mcpUrl}`);
  if (config.mode === 'aws') console.log(`  AWS region ${config.awsRegion}, model ${config.modelId}`);
});

attachVoice(server, { transcriber, isOriginAllowed: originChecker(config.port) });
