import { FormEvent, useEffect, useRef, useState } from 'react';
import { AskResult, Language, Status, Step, ask, getStatus } from './api';
import { Recording, startRecording } from './voice';

interface Exchange {
  id: number;
  input: string;
  result?: AskResult;
  error?: string;
}

// Starter phrases. The Tamil wording is a first draft and should be checked by a native speaker.
const ENGLISH_PHRASES = [
  'What is the status of all my devices?',
  'Is the pump plug working?',
  'Are there any alerts?',
  'Run the fan plug for 10 minutes',
  'Turn on the Lamp Plug',
];
const TAMIL_PHRASES = [
  'என் வீட்டில் உள்ள எல்லா சாதனங்களின் நிலை என்ன?',
  'பம்ப் பிளக் பழுதடைந்ததா?',
  'சமீபத்திய எச்சரிக்கைகளைச் சொல்',
  'மின்விசிறி பிளக்கை 10 நிமிடம் இயக்கு',
];

const describeStep = (step: Step): string | null => {
  if (step.kind === 'route' && step.tool) {
    const args = Object.entries(step.input ?? {})
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
    return args ? `${step.tool}  ·  ${args}` : step.tool;
  }
  return null;
};

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<Language>('auto');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [exchanges]);

  const send = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    const id = nextId.current++;
    setExchanges((list) => [...list, { id, input: trimmed }]);
    setText('');
    setBusy(true);
    try {
      const result = await ask(trimmed, language);
      setExchanges((list) => list.map((e) => (e.id === id ? { ...e, result } : e)));
    } catch (error) {
      setExchanges((list) =>
        list.map((e) => (e.id === id ? { ...e, error: error instanceof Error ? error.message : String(error) } : e)),
      );
    } finally {
      setBusy(false);
    }
  };

  // Speak, then the final transcript is sent like typed text. "Auto" listens for Tamil,
  // since voice exists mainly for the language Alexa can't hear.
  const toggleVoice = async () => {
    setVoiceError(null);
    if (recording) {
      setRecording(null);
      try {
        const spoken = await recording.stop();
        if (spoken.trim()) void send(spoken);
        else setVoiceError("I didn't catch that. Try again a little closer to the mic.");
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    try {
      setText('');
      setRecording(await startRecording(language === 'en' ? 'en-IN' : 'ta-IN', setText));
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(text);
  };

  const offline = status?.mode === 'offline';

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Home Command Center</h1>
          <p className="subtitle">Assistant · Tamil and English</p>
        </div>
        <div className="badges">
          <span className={`badge ${offline ? 'warn' : 'ok'}`} data-testid="mode">
            {status ? (offline ? 'Offline mode · English only' : 'AWS mode · Translate + Bedrock') : 'Connecting…'}
          </span>
          <span className={`badge ${status?.mcp.connected ? 'ok' : 'bad'}`} data-testid="mcp">
            {status
              ? status.mcp.connected
                ? `MCP linked · ${status.mcp.tools.length} tools`
                : 'MCP not reachable'
              : 'Connecting…'}
          </span>
        </div>
      </header>

      {status && !status.mcp.connected && <p className="notice bad">{status.mcp.error}</p>}
      {offline && (
        <p className="notice warn">
          Tamil needs Amazon Translate. It switches on when the AWS account is verified (set ASSISTANT_MODE=aws).
        </p>
      )}

      <section className="conversation" aria-live="polite">
        {exchanges.length === 0 && (
          <p className="empty">
            Ask in Tamil or English. Alexa+ can't take Tamil speech, so this app translates with Amazon Translate and then
            calls the same MCP tools Alexa+ uses.
          </p>
        )}
        {exchanges.map((exchange) => (
          <article key={exchange.id} className="exchange">
            <div className="bubble user" lang={exchange.result?.language}>
              {exchange.input}
            </div>
            {!exchange.result && !exchange.error && <div className="bubble thinking">Thinking…</div>}
            {exchange.error && <div className="bubble error">{exchange.error}</div>}
            {exchange.result && (
              <>
                <ol className="trace">
                  {exchange.result.steps.map((step, i) => {
                    if (step.kind === 'translate' && step.direction === 'in') {
                      return (
                        <li key={i}>
                          <span className="tag">Tamil → English</span> {step.text}
                        </li>
                      );
                    }
                    const tool = describeStep(step);
                    if (tool) {
                      return (
                        <li key={i}>
                          <span className="tag">MCP tool</span> <code>{tool}</code>
                        </li>
                      );
                    }
                    return null;
                  })}
                </ol>
                <div className={`bubble assistant ${exchange.result.isError ? 'warn' : ''}`}>
                  <div lang={exchange.result.language} className="reply">
                    {exchange.result.reply}
                  </div>
                  {exchange.result.language === 'ta' && <div className="english">{exchange.result.replyEnglish}</div>}
                </div>
              </>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </section>

      <section className="phrases" aria-label="Try a phrase">
        {ENGLISH_PHRASES.map((phrase) => (
          <button key={phrase} type="button" className="chip" disabled={busy} onClick={() => void send(phrase)}>
            {phrase}
          </button>
        ))}
        {TAMIL_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            className="chip tamil"
            lang="ta"
            disabled={busy || offline}
            title={offline ? 'Needs AWS mode' : undefined}
            onClick={() => void send(phrase)}
          >
            {phrase}
          </button>
        ))}
      </section>

      {voiceError && <p className="notice bad">{voiceError}</p>}
      <form className="composer" onSubmit={onSubmit}>
        <input
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={recording ? 'Listening…' : 'Type in Tamil or English…'}
          readOnly={Boolean(recording)}
          autoFocus
        />
        <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          <option value="auto">Auto</option>
          <option value="ta">தமிழ்</option>
          <option value="en">English</option>
        </select>
        <button
          type="button"
          className={`mic ${recording ? 'recording' : ''}`}
          onClick={() => void toggleVoice()}
          disabled={busy || !status?.voice}
          title={status?.voice ? undefined : 'Voice needs AWS mode (Amazon Transcribe)'}
          aria-pressed={Boolean(recording)}
        >
          {recording ? 'Stop' : 'Speak'}
        </button>
        <button type="submit" disabled={busy || Boolean(recording) || !text.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
