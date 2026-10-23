import { TranslateTextCommand } from '@aws-sdk/client-translate';

export type Lang = 'ta' | 'en';

export interface Translator {
  translate(text: string, from: Lang, to: Lang): Promise<string>;
}

interface Sender {
  send(command: unknown): Promise<unknown>;
}

/** Tamil script block, U+0B80..U+0BFF. Deterministic, so detection needs no AWS call. */
export function detectLanguage(text: string): Lang {
  return /[஀-௿]/.test(text) ? 'ta' : 'en';
}

export class AwsTranslator implements Translator {
  constructor(private client: Sender) {}

  async translate(text: string, from: Lang, to: Lang): Promise<string> {
    if (from === to) return text;
    const result = (await this.client.send(
      new TranslateTextCommand({ Text: text, SourceLanguageCode: from, TargetLanguageCode: to }),
    )) as { TranslatedText?: string };
    if (!result.TranslatedText) throw new Error('Amazon Translate returned no text');
    return result.TranslatedText;
  }
}

/** Used when AWS isn't configured: English passes through, Tamil is refused with a clear reason. */
export class OfflineTranslator implements Translator {
  async translate(text: string, from: Lang, to: Lang): Promise<string> {
    if (from === to) return text;
    throw new Error('Tamil needs Amazon Translate. Set ASSISTANT_MODE=aws once your AWS account is verified.');
  }
}
