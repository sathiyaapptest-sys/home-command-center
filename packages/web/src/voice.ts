export type VoiceLanguage = 'ta-IN' | 'en-IN';

export interface Recording {
  /** Stops the microphone and resolves with the final transcript. */
  stop(): Promise<string>;
  /** Abandons the recording without waiting for a transcript. */
  cancel(): void;
}

const SAMPLE_RATE = 16_000;
const SAMPLES_PER_MESSAGE = 1_600; // ~100 ms per WebSocket frame instead of one per 128-sample render quantum

// Copies each render quantum of microphone audio out of the audio thread.
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

const toPcm16 = (samples: Float32Array): Int16Array<ArrayBuffer> => {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
};

/**
 * Streams the microphone as 16 kHz mono 16-bit PCM to the local assistant, which relays it
 * to Amazon Transcribe in your own AWS account. The browser's built-in speech recognition is
 * deliberately not used: in Chrome it sends audio to Google.
 */
export async function startRecording(language: VoiceLanguage, onText: (text: string) => void): Promise<Recording> {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/listen?lang=${language}`);
  ws.binaryType = 'arraybuffer';

  let settle: { resolve: (text: string) => void; reject: (error: Error) => void } | undefined;
  const transcript = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { type: string; text?: string; message?: string };
    if (message.type === 'partial' || message.type === 'final') onText(message.text ?? '');
    else if (message.type === 'done') settle?.resolve(message.text ?? '');
    else if (message.type === 'error') settle?.reject(new Error(message.message ?? 'Transcription failed'));
  };
  ws.onclose = () => settle?.resolve('');

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Voice connection timed out')), 5_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Voice is unavailable. It needs AWS mode on the assistant server.'));
    };
  });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    ws.close();
    throw new Error('Microphone access was blocked. Allow it in the browser to use voice.');
  }

  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
  await context.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'pcm-capture');
  const silent = context.createGain();
  silent.gain.value = 0; // keeps the graph running without playing the mic back

  let pending: Float32Array[] = [];
  let pendingSamples = 0;
  const flush = () => {
    if (pendingSamples === 0 || ws.readyState !== WebSocket.OPEN) return;
    const joined = new Float32Array(pendingSamples);
    let offset = 0;
    for (const part of pending) {
      joined.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingSamples = 0;
    ws.send(toPcm16(joined));
  };
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    pending.push(event.data);
    pendingSamples += event.data.length;
    if (pendingSamples >= SAMPLES_PER_MESSAGE) flush();
  };
  source.connect(capture).connect(silent).connect(context.destination);

  const release = () => {
    source.disconnect();
    capture.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };

  return {
    async stop() {
      flush();
      release();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
      return Promise.race([
        transcript,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Transcription timed out')), 10_000)),
      ]);
    },
    cancel() {
      release();
      ws.close();
    },
  };
}
