import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it, vi } from 'vitest';
import { BedrockRouter, RuleRouter, type ToolInfo } from '../server/router.js';

const tools: ToolInfo[] = [
  'list_devices', 'get_device_status', 'get_recent_alerts', 'set_device_power', 'run_device_for_duration', 'add_note', 'list_notes',
].map((name) => ({ name, description: `${name} description`, inputSchema: { type: 'object', properties: {} } }));

describe('RuleRouter', () => {
  const route = (text: string) => new RuleRouter().route(text, tools);

  it.each([
    ['What is the status of all my devices?', 'list_devices', {}],
    ['how many devices are on', 'list_devices', {}],
    ['Are there any alerts?', 'get_recent_alerts', {}],
    ['is anything wrong', 'get_recent_alerts', {}],
    ['is the pump plug working', 'get_device_status', { device: 'pump plug' }],
    ['Turn on the Lamp Plug', 'set_device_power', { device: 'lamp plug', power: 'on' }],
    ['please switch off the heater plug', 'set_device_power', { device: 'heater plug', power: 'off' }],
    ['turn the fan plug off', 'set_device_power', { device: 'fan plug', power: 'off' }],
    ['Run the fan plug for 10 minutes', 'run_device_for_duration', { device: 'fan plug', minutes: 10 }],
    ['keep the motor plug on for five minutes', 'run_device_for_duration', { device: 'motor plug', minutes: 5 }],
    ['read my notes', 'list_notes', {}],
  ])('%s -> %s', async (text, name, input) => {
    expect(await route(text)).toEqual({ kind: 'tool', name, input });
  });

  it('saves a note with the original wording', async () => {
    expect(await route('Remember that the pump needs oiling')).toEqual({
      kind: 'tool',
      name: 'add_note',
      input: { text: 'the pump needs oiling' },
    });
  });

  it('asks which device when told to turn something on or off with no device named', async () => {
    for (const text of ['turn off', 'Turn on please', 'switch off.']) {
      const decision = await route(text);
      expect(decision.kind).toBe('text');
      expect((decision as { text: string }).text).toMatch(/^Which device should I turn (on|off)\?/);
    }
  });

  it('answers with what it can do when nothing matches, and ignores tools the server lacks', async () => {
    expect((await route('sing me a song')).kind).toBe('text');
    expect((await new RuleRouter().route('list my notes', [])).kind).toBe('text');
  });
});

describe('BedrockRouter', () => {
  const reply = (content: unknown[]) => ({ output: { message: { content } } });

  it('returns the tool the model chose, and sends the MCP tools as a Converse tool config', async () => {
    const send = vi.fn().mockResolvedValue(
      reply([{ toolUse: { toolUseId: 't1', name: 'run_device_for_duration', input: { device: 'fan', minutes: 10 } } }]),
    );
    const decision = await new BedrockRouter({ send }, 'us.amazon.nova-lite-v1:0').route('run fan for 10 minutes', tools);

    expect(decision).toEqual({ kind: 'tool', name: 'run_device_for_duration', input: { device: 'fan', minutes: 10 } });
    const command = send.mock.calls[0][0] as ConverseCommand;
    expect(command).toBeInstanceOf(ConverseCommand);
    expect(command.input.modelId).toBe('us.amazon.nova-lite-v1:0');
    expect(command.input.toolConfig?.tools).toHaveLength(7);
    expect(command.input.toolConfig?.tools?.[0].toolSpec?.name).toBe('list_devices');
    expect(command.input.inferenceConfig?.temperature).toBe(0);
    expect(command.input.messages?.[0].content?.[0]).toEqual({ text: 'run fan for 10 minutes' });
  });

  it('returns plain text when the model answers without a tool', async () => {
    const send = vi.fn().mockResolvedValue(reply([{ text: 'I can only help with your smart home.' }]));
    expect(await new BedrockRouter({ send }, 'm').route('tell me a joke', tools)).toEqual({
      kind: 'text',
      text: 'I can only help with your smart home.',
    });
  });

  it('falls back to an apology on an empty reply and defaults missing tool input', async () => {
    expect((await new BedrockRouter({ send: vi.fn().mockResolvedValue(reply([])) }, 'm').route('x', tools)).kind).toBe('text');
    const decision = await new BedrockRouter(
      { send: vi.fn().mockResolvedValue(reply([{ toolUse: { name: 'list_devices' } }])) },
      'm',
    ).route('x', tools);
    expect(decision).toEqual({ kind: 'tool', name: 'list_devices', input: {} });
  });
});
