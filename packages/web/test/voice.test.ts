import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { originChecker } from '../server/app.js';
import { AwsTranscriber, type Transcriber, type TranscriptEvent, type VoiceLanguage } from '../server/transcribe.js';
import { attachVoice } from '../server/voice.js';

const ORIGIN = 'http://127.0.0.1:4200';

/** Records what it received and replies with a partial and a final transcript. */
class FakeTranscriber implements Transcriber {
  bytes = 0;
  language?: VoiceLanguage;
  async *transcribe(audio: AsyncIterable<Uint8Array>, language: VoiceLanguage): AsyncIterable<TranscriptEvent> {
    this.language = language;
    for await (const chunk of audio) this.bytes += chunk.byteLength;
    yield { text: 'மின்விசிறி பிளக்கை', isPartial: true };
    yield { text: 'மின்விசிறி பிளக்கை 10 நிமிடம் இயக்கு', isPartial: false };
  }
}

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function start(transcriber?: Transcriber) {
  server = createServer((_req, res) => res.end());
  attachVoice(server, { transcriber, isOriginAllowed: originChecker(4200) });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Opens the socket, streams `chunks` of audio, says stop, and collects every message. */
function session(url: string, chunks: Uint8Array[], origin = ORIGIN) {
  return new Promise<{ messages: { type: string; text?: string; message?: string }[] }>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    const messages: { type: string; text?: string }[] = [];
    ws.on('open', () => {
      for (const chunk of chunks) ws.send(chunk);
      ws.send(JSON.stringify({ type: 'stop' }));
    });
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('close', () => resolve({ messages }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

describe('voice WebSocket', () => {
  it('relays audio to the transcriber and returns partial, final, and the whole utterance', async () => {
    const fake = new FakeTranscriber();
    const url = await start(fake);
    const { messages } = await session(`${url}/api/listen?lang=ta-IN`, [new Uint8Array(3200), new Uint8Array(3200)]);

    expect(fake.bytes).toBe(6400);
    expect(fake.language).toBe('ta-IN');
    expect(messages.map((m) => m.type)).toEqual(['partial', 'final', 'done']);
    expect(messages.at(-1)?.text).toBe('மின்விசிறி பிளக்கை 10 நிமிடம் இயக்கு');
  });

  it('passes English through when asked and defaults to Tamil otherwise', async () => {
    const fake = new FakeTranscriber();
    const url = await start(fake);
    await session(`${url}/api/listen?lang=en-IN`, []);
    expect(fake.language).toBe('en-IN');
    await session(`${url}/api/listen?lang=fr-FR`, []);
    expect(fake.language).toBe('ta-IN');
  });

  it('stops accepting audio after 30 seconds of it', async () => {
    const fake = new FakeTranscriber();
    const url = await start(fake);
    const second = new Uint8Array(32_000); // one second of 16 kHz 16-bit audio
    await session(`${url}/api/listen`, Array.from({ length: 35 }, () => second));
    expect(fake.bytes).toBeLessThanOrEqual(30 * 32_000);
  });

  it('reports transcriber failures to the browser', async () => {
    const failing: Transcriber = {
      async *transcribe(audio) {
        for await (const _ of audio) {
          // drain
        }
        throw new Error('Your account is currently being verified.');
      },
    };
    const url = await start(failing);
    const { messages } = await session(`${url}/api/listen`, [new Uint8Array(100)]);
    expect(messages).toEqual([{ type: 'error', message: 'Your account is currently being verified.' }]);
  });

  it('refuses other origins, unknown paths, and requests when voice is off', async () => {
    const url = await start(new FakeTranscriber());
    await expect(session(`${url}/api/listen`, [], 'https://evil.example')).rejects.toThrow('HTTP 403');
    await expect(session(`${url}/elsewhere`, [])).rejects.toThrow('HTTP 404');
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const offline = await start(undefined);
    await expect(session(`${offline}/api/listen`, [])).rejects.toThrow('HTTP 503');
  });
});

describe('AwsTranscriber', () => {
  it('requests 16 kHz PCM in the chosen language and maps partial and final results', async () => {
    let audioSeen = 0;
    const send = vi.fn(async (command: StartStreamTranscriptionCommand) => {
      for await (const event of command.input.AudioStream!) audioSeen += event.AudioEvent?.AudioChunk?.byteLength ?? 0;
      return {
        TranscriptResultStream: (async function* () {
          yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: 'turn on' }] }] } } };
          yield {
            TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: 'turn on the lamp plug' }] }] } },
          };
          yield { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: '  ' }] }] } } };
        })(),
      };
    });

    async function* audio() {
      yield new Uint8Array(640);
      yield new Uint8Array(640);
    }
    const events: TranscriptEvent[] = [];
    for await (const event of new AwsTranscriber({ send: send as never }).transcribe(audio(), 'en-IN')) events.push(event);

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(StartStreamTranscriptionCommand);
    expect(command.input.LanguageCode).toBe('en-IN');
    expect(command.input.MediaEncoding).toBe('pcm');
    expect(command.input.MediaSampleRateHertz).toBe(16000);
    expect(audioSeen).toBe(1280);
    expect(events).toEqual([
      { text: 'turn on', isPartial: true },
      { text: 'turn on the lamp plug', isPartial: false },
    ]);
  });
});
