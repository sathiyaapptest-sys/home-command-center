import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export type RouteDecision =
  | { kind: 'tool'; name: string; input: Record<string, unknown> }
  | { kind: 'text'; text: string };

/** Decides which MCP tool an English request means. In Alexa+ this is the platform's own job. */
export interface ToolRouter {
  route(utterance: string, tools: ToolInfo[]): Promise<RouteDecision>;
}

interface Sender {
  send(command: unknown): Promise<unknown>;
}

const SYSTEM_PROMPT =
  'You are the voice assistant for a smart home with plugs, bulbs and a hub. ' +
  'Pick the single best tool for the customer\'s request and fill in its arguments, ' +
  'passing device names exactly as the customer said them. If no tool fits, answer in one short sentence.';

/**
 * Tool use through the Bedrock Converse API: one inference call in which the model either
 * picks a tool with arguments or answers directly. No agent loop, by design (see the plan).
 */
export class BedrockRouter implements ToolRouter {
  constructor(
    private client: Sender,
    private modelId: string,
  ) {}

  async route(utterance: string, tools: ToolInfo[]): Promise<RouteDecision> {
    const response = (await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: utterance }] }],
        toolConfig: {
          tools: tools.map((tool) => ({
            toolSpec: {
              name: tool.name,
              description: tool.description,
              inputSchema: { json: tool.inputSchema as never },
            },
          })),
          toolChoice: { auto: {} },
        },
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
    )) as { output?: { message?: { content?: { text?: string; toolUse?: { name?: string; input?: unknown } }[] } } };

    const blocks = response.output?.message?.content ?? [];
    const toolUse = blocks.find((block) => block.toolUse)?.toolUse;
    if (toolUse?.name) {
      return { kind: 'tool', name: toolUse.name, input: (toolUse.input ?? {}) as Record<string, unknown> };
    }
    const text = blocks.map((block) => block.text ?? '').join(' ').trim();
    return { kind: 'text', text: text || "Sorry, I didn't understand that." };
  }
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
};

const clean = (value: string) =>
  value
    .replace(/\b(please|now|the|my|for|and)\b/g, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Keyword fallback so the app still works in English with no AWS account. */
export class RuleRouter implements ToolRouter {
  async route(utterance: string, tools: ToolInfo[]): Promise<RouteDecision> {
    const has = (name: string) => tools.some((t) => t.name === name);
    const text = utterance.toLowerCase().trim();

    const note = /^(?:add (?:a )?note|save (?:a )?note|remember(?: that)?|note(?: that)?)[:,]?\s+(.+)$/.exec(text);
    if (note && has('add_note')) return { kind: 'tool', name: 'add_note', input: { text: utterance.slice(utterance.length - note[1].length) } };
    if (/\b(read|show|list|what are)\b.*\bnotes?\b|^notes?$/.test(text) && has('list_notes')) {
      return { kind: 'tool', name: 'list_notes', input: {} };
    }
    if (/\b(alerts?|problems?|faults?|anything wrong|issues?)\b/.test(text) && has('get_recent_alerts')) {
      return { kind: 'tool', name: 'get_recent_alerts', input: {} };
    }

    const run = /\b(?:run|keep|leave|start)\s+(.+?)\s+(?:on\s+)?for\s+(\d+|[a-z]+)\s*(?:min|minute|minutes)\b/.exec(text);
    if (run && has('run_device_for_duration')) {
      const minutes = /^\d+$/.test(run[2]) ? Number(run[2]) : NUMBER_WORDS[run[2]];
      if (minutes) return { kind: 'tool', name: 'run_device_for_duration', input: { device: clean(run[1]), minutes } };
    }

    const power = /\b(?:turn|switch)\s+(on|off)\s+(.+)$/.exec(text) ?? /\b(?:turn|switch)\s+(.+?)\s+(on|off)$/.exec(text);
    if (power && has('set_device_power')) {
      const state = power[1] === 'on' || power[1] === 'off' ? power[1] : power[2];
      const device = power[1] === 'on' || power[1] === 'off' ? power[2] : power[1];
      return { kind: 'tool', name: 'set_device_power', input: { device: clean(device), power: state } };
    }

    const status = /\b(?:status of|how is|is|check)\s+(.+)$/.exec(text);
    if (status && has('get_device_status') && !/\b(devices|everything|all)\b/.test(text)) {
      return { kind: 'tool', name: 'get_device_status', input: { device: clean(status[1].replace(/\b(working|faulty|on|off|ok|okay)\b/g, '')) } };
    }
    if (/\b(devices|everything|overview|summary|status|how many)\b/.test(text) && has('list_devices')) {
      return { kind: 'tool', name: 'list_devices', input: {} };
    }
    return {
      kind: 'text',
      text: 'I can check devices, read alerts, turn things on or off, run a device for a set time, and save notes.',
    };
  }
}
