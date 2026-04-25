import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseSettingsUpdate,
} from './appSettings';

describe('parseSettingsUpdate', () => {
  it('accepts valid fields and strips unknown keys', () => {
    const parsed = parseSettingsUpdate({
      ttsModel: 'gemini-3.1-flash-tts-preview',
      imageModel: 'gemini-3-pro-image-preview',
      imageResolution: '2k',
      openaiReasoningEffort: 'high',
      geminiThinkingLevel: 'low',
      unknownKey: 'ignored',
    });

    expect(parsed.ttsModel).toBe('gemini-3.1-flash-tts-preview');
    expect(parsed.imageModel).toBe('gemini-3-pro-image-preview');
    expect(parsed.imageResolution).toBe('2k');
    expect(parsed.openaiReasoningEffort).toBe('high');
    expect(parsed.geminiThinkingLevel).toBe('low');
    expect(parsed).not.toHaveProperty('unknownKey');
  });

  it('rejects invalid field types', () => {
    expect(() => parseSettingsUpdate({ videoFps: '30' })).toThrow();
    expect(() => parseSettingsUpdate({ imageModel: 'invalid-model' })).toThrow();
  });
});

describe('normalizeSettings', () => {
  it('normalizes legacy voice and enforces gemini_tts', () => {
    const normalized = normalizeSettings({
      ttsEngine: 'google_tts',
      ttsVoice: 'ja-JP-Chirp3-HD-Aoife',
    });

    expect(normalized.ttsEngine).toBe('gemini_tts');
    expect(normalized.ttsVoice).toBe(DEFAULT_SETTINGS.ttsVoice);
  });

  it('keeps Gemini 3.1 Flash TTS selections', () => {
    const normalized = normalizeSettings({
      ttsModel: 'gemini-3.1-flash-tts-preview',
    });

    expect(normalized.ttsModel).toBe('gemini-3.1-flash-tts-preview');
  });

  it('falls back to defaults for invalid model selections and keeps cost', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'bad-model',
      imagePromptTextModel: 'bad-model',
      ttsModel: 'bad-model',
      openaiReasoningEffort: 'bad-effort',
      geminiThinkingLevel: 'bad-level',
      imageModel: 'bad-model',
      imageResolution: 'bad-resolution',
      cost: { openai: { inputPer1MTokensUsd: 1 } },
    });

    expect(normalized.scriptTextModel).toBe(DEFAULT_SETTINGS.scriptTextModel);
    expect(normalized.imagePromptTextModel).toBe(DEFAULT_SETTINGS.imagePromptTextModel);
    expect(normalized.ttsModel).toBe(DEFAULT_SETTINGS.ttsModel);
    expect(normalized.openaiReasoningEffort).toBe(DEFAULT_SETTINGS.openaiReasoningEffort);
    expect(normalized.geminiThinkingLevel).toBe(DEFAULT_SETTINGS.geminiThinkingLevel);
    expect(normalized.imageModel).toBe(DEFAULT_SETTINGS.imageModel);
    expect(normalized.imageResolution).toBe(DEFAULT_SETTINGS.imageResolution);
    expect(normalized.cost).toEqual({ openai: { inputPer1MTokensUsd: 1 } });
  });
});
