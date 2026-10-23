import { v4 as uuid } from 'uuid';
import { Note } from '../types';
import { Translator } from './translate';

/**
 * Own Notes/Plans module — deliberately not a copy of Alexa+'s native
 * "Remember This"/notes (that already exists and won't be rebuilt). The gap
 * this fills: Alexa+'s own memory/notes don't surface on Fire TV. Summarize
 * and correct are stubbed here; Week 3 swaps summarizeStub for a Bedrock call.
 */
export class NotesEngine {
  private notes = new Map<string, Note>();

  constructor(private translator: Translator) {}

  async create(languageInput: 'en' | 'ta', text: string): Promise<Note> {
    const now = Date.now();
    const textEnglish = await this.translator.toEnglish(text, languageInput);
    const note: Note = {
      id: uuid(),
      languageInput,
      textOriginal: text,
      textEnglish,
      summary: null,
      createdAt: now,
      updatedAt: now,
      history: [{ text, at: now }],
    };
    this.notes.set(note.id, note);
    return note;
  }

  list(): Note[] {
    return Array.from(this.notes.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  async correct(id: string, newText: string): Promise<Note> {
    const note = this.require(id);
    note.textOriginal = newText;
    note.textEnglish = await this.translator.toEnglish(newText, note.languageInput);
    note.updatedAt = Date.now();
    note.history.push({ text: newText, at: note.updatedAt });
    return note;
  }

  summarize(id: string): Note {
    const note = this.require(id);
    note.summary = summarizeStub(note.textEnglish);
    return note;
  }

  private require(id: string): Note {
    const note = this.notes.get(id);
    if (!note) throw new Error(`Unknown note: ${id}`);
    return note;
  }
}

function summarizeStub(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return firstSentence.length < text.length
    ? `${firstSentence} (+${text.length - firstSentence.length} more chars — stub summary, Bedrock swaps in Week 3)`
    : firstSentence;
}
