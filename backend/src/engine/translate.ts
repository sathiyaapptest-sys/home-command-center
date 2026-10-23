/**
 * Language bridge interface. The real implementation (Week 3) calls Amazon
 * Translate (ta<->en, verified to support Tamil) and, for spoken input, Amazon
 * Transcribe first. Kept behind this interface so routes/notesEngine don't
 * change when the stub is swapped for the real AWS calls.
 */
export interface Translator {
  toEnglish(text: string, sourceLang: 'ta' | 'en'): Promise<string>;
  toTamil(text: string): Promise<string>;
}

export class StubTranslator implements Translator {
  async toEnglish(text: string, sourceLang: 'ta' | 'en'): Promise<string> {
    if (sourceLang === 'en') return text;
    return `[stub en-translation of ta text] ${text}`;
  }

  async toTamil(text: string): Promise<string> {
    return `[stub ta-translation] ${text}`;
  }
}
