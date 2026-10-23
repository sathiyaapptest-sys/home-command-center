import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { SAMPLE_RATE, type Transcriber, type VoiceLanguage } from './transcribe.js';

const BYTES_PER_SECOND = SAMPLE_RATE * 2; // 16-bit mono
const MAX_SECONDS = 30;
const IDLE_MS = 10_000;

/** Turns pushed audio frames into an async iterable the Transcribe SDK can consume. */
class ChunkQueue implements AsyncIterable<Uint8Array> {
  private items: Uint8Array[] = [];
  private waiting: (() => void)[] = [];
  private ended = false;

  push(chunk: Uint8Array) {
    if (this.ended) return;
    this.items.push(chunk);
    this.waiting.splice(0).forEach((wake) => wake());
  }

  end() {
    this.ended = true;
    this.waiting.splice(0).forEach((wake) => wake());
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.items.shift();
      if (next) yield next;
      else if (this.ended) return;
      else await new Promise<void>((wake) => this.waiting.push(wake));
    }
  }
}

const send = (ws: WebSocket, message: Record<string, unknown>) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
};

/**
 * WebSocket at /api/listen?lang=ta-IN|en-IN. The browser streams 16 kHz PCM frames and a
 * {"type":"stop"} message; the server relays the audio to the transcriber and pushes back
 * {"type":"partial"|"final"} transcripts, then {"type":"done","text"} with the full utterance.
 */
export function attachVoice(
  server: Server,
  options: { transcriber?: Transcriber; isOriginAllowed: (origin: string | undefined) => boolean },
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname !== '/api/listen') return reject('404 Not Found');
    // Browsers always send Origin on WebSocket upgrades, so a missing one isn't a real page.
    if (!req.headers.origin || !options.isOriginAllowed(req.headers.origin)) return reject('403 Forbidden');
    if (!options.transcriber) return reject('503 Service Unavailable');
    const language: VoiceLanguage = url.searchParams.get('lang') === 'en-IN' ? 'en-IN' : 'ta-IN';
    wss.handleUpgrade(req, socket, head, (ws) => handle(ws, language, options.transcriber!));
  });

  return wss;
}

async function handle(ws: WebSocket, language: VoiceLanguage, transcriber: Transcriber) {
  const audio = new ChunkQueue();
  let received = 0;
  let idle = setTimeout(() => audio.end(), IDLE_MS);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const chunk = new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : (data as Buffer));
      received += chunk.byteLength;
      if (received > MAX_SECONDS * BYTES_PER_SECOND) {
        audio.end();
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(() => audio.end(), IDLE_MS);
      audio.push(chunk);
      return;
    }
    try {
      if ((JSON.parse(data.toString()) as { type?: string }).type === 'stop') audio.end();
    } catch {
      // ignore malformed control messages
    }
  });
  ws.on('close', () => audio.end());

  const finals: string[] = [];
  try {
    for await (const event of transcriber.transcribe(audio, language)) {
      if (event.isPartial) {
        send(ws, { type: 'partial', text: [...finals, event.text].join(' ') });
      } else {
        finals.push(event.text);
        send(ws, { type: 'final', text: finals.join(' ') });
      }
    }
    send(ws, { type: 'done', text: finals.join(' ') });
  } catch (error) {
    send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(idle);
    ws.close();
  }
}
