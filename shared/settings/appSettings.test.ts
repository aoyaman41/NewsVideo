import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseSettingsUpdate } from './appSettings';

describe('parseSettingsUpdate', () => {
  it('accepts valid fields and strips unknown keys', () => {
    const parsed = parseSettingsUpdate({
      scriptTextModel: 'gpt-5.6-sol',
      imagePromptTextModel: 'gpt-5.6-terra',
      ttsModel: 'gemini-3.1-flash-tts-preview',
      imageModel: 'gemini-3-pro-image-preview',
      imageResolution: '2k',
      openaiReasoningEffort: 'max',
      geminiThinkingLevel: 'low',
      unknownKey: 'ignored',
    });

    expect(parsed.scriptTextModel).toBe('gpt-5.6-sol');
    expect(parsed.imagePromptTextModel).toBe('gpt-5.6-terra');
    expect(parsed.ttsModel).toBe('gemini-3.1-flash-tts-preview');
    expect(parsed.imageModel).toBe('gemini-3-pro-image-preview');
    expect(parsed.imageResolution).toBe('2k');
    expect(parsed.openaiReasoningEffort).toBe('max');
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

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'resolves the default reasoning effort to medium for %s',
    (model) => {
      const normalized = normalizeSettings({
        scriptTextModel: model,
        openaiReasoningEffort: 'default',
      });

      expect(normalized.scriptTextModel).toBe(model);
      expect(normalized.openaiReasoningEffort).toBe('medium');
    }
  );

  it('uses the image prompt model when it is the only selected OpenAI model', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'gemini-3.1-pro',
      imagePromptTextModel: 'gpt-5.6-terra',
      openaiReasoningEffort: 'default',
    });

    expect(normalized.openaiReasoningEffort).toBe('medium');
  });

  it('preserves a valid saved reasoning effort', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'gpt-5.6-luna',
      openaiReasoningEffort: 'high',
    });

    expect(normalized.openaiReasoningEffort).toBe('high');
  });

  it('uses the selected model default for an invalid saved reasoning effort', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'gpt-5.6-sol',
      openaiReasoningEffort: 'bad-effort',
    });

    expect(normalized.openaiReasoningEffort).toBe('medium');
  });

  it('normalizes a saved effort to the common values of mixed OpenAI models', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'gpt-5.6-sol',
      imagePromptTextModel: 'gpt-5.2',
      openaiReasoningEffort: 'max',
    });

    expect(normalized.openaiReasoningEffort).toBe('medium');
  });

  it('migrates the legacy minimal effort to a supported value', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'gpt-5.2',
      imagePromptTextModel: 'gpt-5.4',
      openaiReasoningEffort: 'minimal',
    });

    expect(normalized.openaiReasoningEffort).toBe('none');
  });
});

it('round-trips Astra and GPT Image 2 settings', () => {
  const values = {
    scriptTextModel: 'gpt-6-astra',
    imagePromptTextModel: 'gpt-6-astra',
    imageModel: 'gpt-image-2',
    openaiReasoningEffort: 'high',
  };
  expect(normalizeSettings(parseSettingsUpdate(values))).toMatchObject(values);
});
