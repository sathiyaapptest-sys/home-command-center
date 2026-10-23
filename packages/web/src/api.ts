export type Language = 'auto' | 'ta' | 'en';

export type Step =
  | { kind: 'translate'; direction: 'in' | 'out'; from: string; to: string; text: string }
  | { kind: 'route'; tool?: string; input?: Record<string, unknown>; text?: string }
  | { kind: 'tool'; tool: string; text: string; isError: boolean };

export interface AskResult {
  language: 'ta' | 'en';
  steps: Step[];
  replyEnglish: string;
  reply: string;
  isError: boolean;
}

export interface Status {
  mode: 'aws' | 'offline';
  voice: boolean;
  mcp: { connected: true; tools: string[] } | { connected: false; error: string };
}

export async function getStatus(): Promise<Status> {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error(`Status failed (${res.status})`);
  return res.json();
}

export async function ask(text: string, language: Language): Promise<AskResult> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}
