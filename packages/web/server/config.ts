export interface AssistantConfig {
  port: number;
  host: string;
  mode: 'aws' | 'offline';
  mcpUrl: string;
  backendUrl: string;
  clientId: string;
  clientSecret: string;
  ownerPasscode: string;
  redirectUri: string;
  awsRegion: string;
  modelId: string;
}

const REQUIRED = ['OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OWNER_PASSCODE'] as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): AssistantConfig {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}: set them in .env or in ../mcp-server/.env`);
  }
  const mode = env.ASSISTANT_MODE === 'aws' ? 'aws' : 'offline';
  return {
    port: Number(env.PORT ?? 4200),
    host: env.HOST ?? '127.0.0.1',
    mode,
    mcpUrl: (env.MCP_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, ''),
    backendUrl: env.BACKEND_URL ?? 'http://localhost:4000',
    clientId: env.OAUTH_CLIENT_ID!,
    clientSecret: env.OAUTH_CLIENT_SECRET!,
    ownerPasscode: env.OWNER_PASSCODE!,
    redirectUri: env.ASSISTANT_REDIRECT_URI ?? 'http://127.0.0.1/assistant-callback',
    awsRegion: env.AWS_REGION ?? 'us-east-1',
    modelId: env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-lite-v1:0',
  };
}
