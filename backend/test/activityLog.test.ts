import { describe, expect, it } from 'vitest';
import { ActivityLog, parseActivity } from '../src/engine/activityLog';

const valid = {
  source: 'assistant',
  language: 'ta',
  input: 'பம்ப் பிளக் பழுதடைந்ததா?',
  inputEnglish: 'Is the pump plug faulty?',
  tool: 'get_device_status',
  toolInput: { device: 'pump plug' },
  reply: 'பம்ப் பிளக் பழுதடைந்துள்ளது.',
  replyEnglish: 'Pump Plug is faulty.',
};

describe('parseActivity', () => {
  it('accepts a full assistant entry and an Alexa entry without an utterance', () => {
    expect(parseActivity(valid)).toMatchObject({ source: 'assistant', tool: 'get_device_status', isError: false });
    expect(parseActivity({ source: 'alexa', language: 'en', reply: 'You have 6 devices.' })).toMatchObject({
      input: null,
      tool: null,
      toolInput: null,
    });
  });

  it.each([
    [{ ...valid, source: 'someone' }, 'source'],
    [{ ...valid, language: 'fr' }, 'language'],
    [{ ...valid, reply: '' }, 'reply'],
    [{ ...valid, reply: 'x'.repeat(2001) }, 'reply'],
    [{ ...valid, input: 'x'.repeat(501) }, 'input'],
    [{ ...valid, tool: 42 }, 'tool'],
    [null, 'source'],
  ])('rejects bad input (%#)', (body, field) => {
    const result = parseActivity(body);
    expect(typeof result).toBe('string');
    expect(result).toContain(field);
  });
});

describe('ActivityLog', () => {
  it('keeps the newest first and caps the length', () => {
    let t = 0;
    const log = new ActivityLog(3, () => ++t);
    for (let i = 0; i < 5; i++) log.add({ ...(parseActivity({ ...valid, reply: `r${i}` }) as never) });
    expect(log.list().map((e) => e.reply)).toEqual(['r4', 'r3', 'r2']);
    expect(log.list(1)).toHaveLength(1);
    expect(log.list()[0].at).toBe(5);
  });

  it('clears on demo reset', () => {
    const log = new ActivityLog();
    log.add(parseActivity(valid) as never);
    log.clear();
    expect(log.list()).toEqual([]);
  });
});
