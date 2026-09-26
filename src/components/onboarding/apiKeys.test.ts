import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/settings/appSettings';
import { explainConnectionResult, formatUsages, requiredServices, serviceUsages } from './apiKeys';

describe('requiredServices', () => {
  it('needs all three keys with the default models (Claude / GPT Image / Gemini TTS)', () => {
    expect(requiredServices(DEFAULT_SETTINGS)).toEqual(['anthropic', 'openai', 'google_ai']);
    expect(serviceUsages(DEFAULT_SETTINGS)).toEqual({
      anthropic: ['台本', '画像の指示'],
      openai: ['画像'],
      google_ai: ['音声'],
    });
  });

  it('follows the selected models', () => {
    expect(
      requiredServices({
        scriptTextModel: 'gemini-3.1-pro',
        imagePromptTextModel: 'gemini-3.1-pro',
        imageModel: 'gemini-3.1-flash-image',
        ttsEngine: 'gemini_tts',
      })
    ).toEqual(['google_ai']);
    expect(
      requiredServices({
        scriptTextModel: 'gpt-5.6-terra',
        imagePromptTextModel: 'claude-opus-5-5',
        imageModel: 'gpt-image-2.5-sunburst',
        ttsEngine: 'macos_tts',
      })
    ).toEqual(['anthropic', 'openai']);
  });
});

describe('formatUsages', () => {
  it('joins usages in natural Japanese', () => {
    expect(formatUsages([])).toBe('');
    expect(formatUsages(['画像'])).toBe('画像');
    expect(formatUsages(['台本', '画像の指示', '画像'])).toBe('台本・画像の指示と画像');
  });
});

describe('explainConnectionResult', () => {
  it('summarizes common failures without the raw message', () => {
    expect(explainConnectionResult({ success: true, message: '接続成功' })).toEqual({
      ok: true,
      summary: '使えます',
      detail: '',
    });
    expect(
      explainConnectionResult({ success: false, message: '接続失敗: 401 invalid key' })
    ).toMatchObject({ ok: false, summary: expect.stringContaining('正しくありません') });
    expect(
      explainConnectionResult({ success: false, message: '接続失敗: 429 quota' }).summary
    ).toContain('利用上限');
    expect(
      explainConnectionResult({ success: false, message: '接続エラー: fetch failed' }).summary
    ).toContain('インターネット');
    expect(
      explainConnectionResult({ success: false, message: 'APIキーが設定されていません' })
    ).toMatchObject({ summary: 'キーがまだ保存されていません。', detail: '' });
  });
});

it('never shows the key in the connection details', () => {
  const secret = 'AIzaSyA1234567890abcdefghijKLMN';
  const result = explainConnectionResult(
    { success: false, message: `接続失敗: 400 API key not valid: ${secret} (key=${secret})` },
    secret
  );
  expect(result.detail).not.toContain(secret);
  expect(
    explainConnectionResult(
      { success: false, message: '接続失敗: 401 bad key my-custom-key-1234' },
      'my-custom-key-1234'
    ).detail
  ).not.toContain('my-custom-key-1234');
});
