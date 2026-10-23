import { StartStreamTranscriptionCommand, type LanguageCode } from '@aws-sdk/client-transcribe-streaming';

/** Both are supported for streaming in us-east-1 (Tamil streaming is excluded only in a few regions). */
export type VoiceLanguage = 'ta-IN' | 'en-IN';

export const SAMPLE_RATE = 16_000;

export interface TranscriptEvent {
  text: string;
  isPartial: boolean;
}

export interface Transcriber {
  transcribe(audio: AsyncIterable<Uint8Array>, language: VoiceLanguage): AsyncIterable<TranscriptEvent>;
}

interface Sender {
  send(command: unknown): Promise<unknown>;
}

type ResultStream = AsyncIterable<{
  TranscriptEvent?: {
    Transcript?: { Results?: { IsPartial?: boolean; Alternatives?: { Transcript?: string }[] }[] };
  };
}>;

/** Amazon Transcribe streaming: 16 kHz mono 16-bit PCM in, partial and final transcripts out. */
export class AwsTranscriber implements Transcriber {
  constructor(private client: Sender) {}

  async *transcribe(audio: AsyncIterable<Uint8Array>, language: VoiceLanguage): AsyncIterable<TranscriptEvent> {
    const response = (await this.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: language as LanguageCode,
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: SAMPLE_RATE,
        AudioStream: (async function* () {
          for await (const chunk of audio) yield { AudioEvent: { AudioChunk: chunk } };
        })(),
      }),
    )) as { TranscriptResultStream?: ResultStream };

    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        const text = result.Alternatives?.[0]?.Transcript?.trim() ?? '';
        if (text) yield { text, isPartial: result.IsPartial === true };
      }
    }
  }
}
