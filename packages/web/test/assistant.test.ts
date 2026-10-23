import { describe, expect, it, vi } from 'vitest';
import { Assistant } from '../server/assistant.js';
import type { McpTools } from '../server/mcpClient.js';
import type { RouteDecision, ToolRouter } from '../server/router.js';
import type { Translator } from '../server/translate.js';

const dictionary: Record<string, string> = {
  'பம்ப் பிளக் பழுதடைந்ததா?': 'Is the pump plug faulty?',
  'Pump Plug is faulty.': 'பம்ப் பிளக் பழுதடைந்துள்ளது.',
};

const translator: Translator = {
  translate: vi.fn(async (text: string, from: string, to: string) => {
    if (from === to) return text;
    return dictionary[text] ?? `[${from}->${to}] ${text}`;
  }),
};

function build(decision: RouteDecision, toolText = 'Pump Plug is faulty.', isError = false) {
  const router: ToolRouter = { route: vi.fn().mockResolvedValue(decision) };
  const tools: McpTools = {
    listTools: vi.fn().mockResolvedValue([{ name: 'get_device_status', inputSchema: {} }]),
    callTool: vi.fn().mockResolvedValue({ text: toolText, isError }),
  };
  return { assistant: new Assistant({ translator, router, tools }), router, tools };
}

describe('Assistant', () => {
  it('runs the whole Tamil path: translate in, route, call the MCP tool, translate the reply back', async () => {
    const { assistant, router, tools } = build({ kind: 'tool', name: 'get_device_status', input: { device: 'pump plug' } });
    const result = await assistant.ask('பம்ப் பிளக் பழுதடைந்ததா?');

    expect(result.language).toBe('ta');
    expect(result.steps.map((s) => s.kind)).toEqual(['translate', 'route', 'tool', 'translate']);
    expect(router.route).toHaveBeenCalledWith('Is the pump plug faulty?', expect.any(Array));
    expect(tools.callTool).toHaveBeenCalledWith('get_device_status', { device: 'pump plug' });
    expect(result.replyEnglish).toBe('Pump Plug is faulty.');
    expect(result.reply).toBe('பம்ப் பிளக் பழுதடைந்துள்ளது.');
    expect(result.isError).toBe(false);
  });

  it('skips translation for English', async () => {
    const { assistant } = build({ kind: 'tool', name: 'get_device_status', input: {} });
    const result = await assistant.ask('is the pump plug faulty');
    expect(result.language).toBe('en');
    expect(result.steps.map((s) => s.kind)).toEqual(['route', 'tool']);
    expect(result.reply).toBe(result.replyEnglish);
  });

  it('honours an explicit language over detection', async () => {
    const { assistant } = build({ kind: 'text', text: 'ok' });
    expect((await assistant.ask('hello', 'ta')).language).toBe('ta');
  });

  it('flags a tool error and still translates the explanation', async () => {
    const { assistant } = build({ kind: 'tool', name: 'run_device_for_duration', input: {} }, 'It is faulty.', true);
    const result = await assistant.ask('run the plug', 'ta');
    expect(result.isError).toBe(true);
    expect(result.reply).toBe('[en->ta] It is faulty.');
  });

  it('answers directly when the router picks no tool', async () => {
    const { assistant, tools } = build({ kind: 'text', text: 'I can help with devices.' });
    const result = await assistant.ask('tell me a joke');
    expect(tools.callTool).not.toHaveBeenCalled();
    expect(result.replyEnglish).toBe('I can help with devices.');
    expect(result.steps).toEqual([{ kind: 'route', text: 'I can help with devices.' }]);
  });

  it('rejects empty input', async () => {
    const { assistant } = build({ kind: 'text', text: 'x' });
    await expect(assistant.ask('   ')).rejects.toThrow('Say or type something');
  });
});
