import { v4 as uuid } from 'uuid';
import { ActivityEntry, NewActivity } from '../types';

const MAX_INPUT = 500;
const MAX_REPLY = 2000;

const optionalString = (value: unknown, max: number): string | null | undefined => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value;
};

/** Validates a POST body; returns the entry or an error message. */
export function parseActivity(body: unknown): NewActivity | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.source !== 'assistant' && b.source !== 'alexa') return 'source must be "assistant" or "alexa"';
  if (b.language !== 'ta' && b.language !== 'en') return 'language must be "ta" or "en"';
  if (typeof b.reply !== 'string' || b.reply.length === 0 || b.reply.length > MAX_REPLY) {
    return `reply must be a non-empty string of at most ${MAX_REPLY} characters`;
  }
  const input = optionalString(b.input, MAX_INPUT);
  const inputEnglish = optionalString(b.inputEnglish, MAX_INPUT);
  const tool = optionalString(b.tool, 100);
  const replyEnglish = optionalString(b.replyEnglish, MAX_REPLY);
  if (input === undefined || inputEnglish === undefined || tool === undefined || replyEnglish === undefined) {
    return 'input, inputEnglish, tool and replyEnglish must be short strings or null';
  }
  const toolInput =
    b.toolInput && typeof b.toolInput === 'object' && !Array.isArray(b.toolInput)
      ? (b.toolInput as Record<string, unknown>)
      : null;
  return {
    source: b.source,
    language: b.language,
    input,
    inputEnglish,
    tool,
    toolInput,
    reply: b.reply,
    replyEnglish,
    isError: b.isError === true,
  };
}

/** The last few assistant / Alexa+ requests, kept in memory for the TV's Assistant panel. */
export class ActivityLog {
  private entries: ActivityEntry[] = [];

  constructor(
    private max = 20,
    private now: () => number = Date.now,
  ) {}

  add(entry: NewActivity): ActivityEntry {
    const record: ActivityEntry = { ...entry, id: uuid(), at: this.now() };
    this.entries.unshift(record);
    this.entries.length = Math.min(this.entries.length, this.max);
    return record;
  }

  list(limit = 10): ActivityEntry[] {
    return this.entries.slice(0, limit);
  }

  clear(): void {
    this.entries = [];
  }
}
