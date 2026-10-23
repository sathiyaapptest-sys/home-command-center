import { TranslateTextCommand } from '@aws-sdk/client-translate';
import { describe, expect, it, vi } from 'vitest';
import { AwsTranslator, OfflineTranslator, detectLanguage } from '../server/translate.js';

describe('detectLanguage', () => {
  it('detects Tamil script and treats everything else as English', () => {
    expect(detectLanguage('பம்ப் பிளக் பழுதடைந்ததா?')).toBe('ta');
    expect(detectLanguage('turn on the lamp plug')).toBe('en');
    expect(detectLanguage('turn on the சோலிமோ plug')).toBe('ta');
    expect(detectLanguage('')).toBe('en');
  });
});

describe('AwsTranslator', () => {
  it('sends the right Amazon Translate request and returns the translated text', async () => {
    const send = vi.fn().mockResolvedValue({ TranslatedText: 'hello' });
    const text = await new AwsTranslator({ send }).translate('வணக்கம்', 'ta', 'en');
    expect(text).toBe('hello');
    const command = send.mock.calls[0][0] as TranslateTextCommand;
    expect(command).toBeInstanceOf(TranslateTextCommand);
    expect(command.input).toEqual({ Text: 'வணக்கம்', SourceLanguageCode: 'ta', TargetLanguageCode: 'en' });
  });

  it('skips the AWS call when source and target match', async () => {
    const send = vi.fn();
    expect(await new AwsTranslator({ send }).translate('hi', 'en', 'en')).toBe('hi');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails clearly when AWS returns nothing', async () => {
    const translator = new AwsTranslator({ send: vi.fn().mockResolvedValue({}) });
    await expect(translator.translate('x', 'en', 'ta')).rejects.toThrow('no text');
  });

  it('propagates AWS errors so the UI can show them', async () => {
    const translator = new AwsTranslator({ send: vi.fn().mockRejectedValue(new Error('SubscriptionRequiredException')) });
    await expect(translator.translate('x', 'en', 'ta')).rejects.toThrow('SubscriptionRequiredException');
  });
});

describe('OfflineTranslator', () => {
  it('passes English through and refuses Tamil with a reason', async () => {
    const offline = new OfflineTranslator();
    expect(await offline.translate('hi', 'en', 'en')).toBe('hi');
    await expect(offline.translate('வணக்கம்', 'ta', 'en')).rejects.toThrow('Tamil needs Amazon Translate');
  });
});
