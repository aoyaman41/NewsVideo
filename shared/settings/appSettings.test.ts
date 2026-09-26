import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseSettingsUpdate } from './appSettings';

describe('parseSettingsUpdate', () => {
  it('accepts valid fields and strips unknown keys', () => {
    const parsed = parseSettingsUpdate({
      scriptTextModel: 'gpt-5.6-sol',
      imagePromptTextModel: 'gpt-5.6-terra',
      ttsModel: 'gemini-3.1-flash-tts-preview',
      imageModel: 'gemini-3-pro-image',
      imageResolution: '2k',
      openaiReasoningEffort: 'max',
      geminiThinkingLevel: 'low',
      unknownKey: 'ignored',
    });

    expect(parsed.scriptTextModel).toBe('gpt-5.6-sol');
    expect(parsed.imagePromptTextModel).toBe('gpt-5.6-terra');
    expect(parsed.ttsModel).toBe('gemini-3.1-flash-tts-preview');
    expect(parsed.imageModel).toBe('gemini-3-pro-image');
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

  it('uses Gemini 3.8 Flash TTS only when no TTS model is saved', () => {
    expect(DEFAULT_SETTINGS.ttsModel).toBe('gemini-3.8-flash-tts');
    expect(normalizeSettings({}).ttsModel).toBe('gemini-3.8-flash-tts');
    expect(normalizeSettings({ ttsModel: 'gemini-3.8-flash-lite-tts' }).ttsModel).toBe(
      'gemini-3.8-flash-lite-tts'
    );
    expect(normalizeSettings({ ttsModel: 'gemini-2.5-pro-preview-tts' }).ttsModel).toBe(
      'gemini-2.5-pro-preview-tts'
    );
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

  it('replaces a saved minimal effort even when no OpenAI model is selected', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'claude-opus-5-5',
      imagePromptTextModel: 'claude-opus-5-5',
      openaiReasoningEffort: 'minimal',
    });

    expect(normalized.openaiReasoningEffort).toBe(DEFAULT_SETTINGS.openaiReasoningEffort);
    expect(() => parseSettingsUpdate({ openaiReasoningEffort: 'minimal' })).toThrow();
  });

  it('uses Claude Opus 5.5 for new settings and keeps saved legacy text models', () => {
    expect(DEFAULT_SETTINGS.scriptTextModel).toBe('claude-opus-5-5');
    expect(DEFAULT_SETTINGS.imagePromptTextModel).toBe('claude-opus-5-5');
    expect(normalizeSettings({}).scriptTextModel).toBe('claude-opus-5-5');

    const legacy = normalizeSettings({
      scriptTextModel: 'gpt-5.2',
      imagePromptTextModel: 'gpt-5.5',
      ttsModel: 'gemini-2.5-flash-preview-tts',
      imageModel: 'gpt-image-2',
    });
    expect(legacy).toMatchObject({
      scriptTextModel: 'gpt-5.2',
      imagePromptTextModel: 'gpt-5.5',
      ttsModel: 'gemini-2.5-flash-preview-tts',
      imageModel: 'gpt-image-2',
    });
  });
});

describe('Claude settings', () => {
  it('fills both Claude efforts with medium for settings saved before Claude support', () => {
    const legacySettings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete legacySettings.claudeEffort;
    delete legacySettings.claudeImagePromptEffort;

    const normalized = normalizeSettings(legacySettings);

    expect(DEFAULT_SETTINGS.claudeEffort).toBe('medium');
    expect(DEFAULT_SETTINGS.claudeImagePromptEffort).toBe('medium');
    expect(normalized.claudeEffort).toBe('medium');
    expect(normalized.claudeImagePromptEffort).toBe('medium');
    expect(normalized.scriptTextModel).toBe(DEFAULT_SETTINGS.scriptTextModel);
    expect(normalized.imagePromptTextModel).toBe(DEFAULT_SETTINGS.imagePromptTextModel);
  });

  it.each(['bad-effort', 'default', 'none', 42])(
    'replaces an invalid or placeholder Claude effort (%s) with the model default',
    (effort) => {
      const normalized = normalizeSettings({
        scriptTextModel: 'claude-opus-5-5',
        imagePromptTextModel: 'claude-opus-5-5',
        claudeEffort: effort,
        claudeImagePromptEffort: effort,
      });

      expect(normalized.claudeEffort).toBe('medium');
      expect(normalized.claudeImagePromptEffort).toBe('medium');
    }
  );

  it('keeps the script and image prompt efforts independent', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'claude-opus-5-5',
      imagePromptTextModel: 'claude-opus-5-5',
      claudeEffort: 'high',
      claudeImagePromptEffort: 'low',
    });

    expect(normalized.claudeEffort).toBe('high');
    expect(normalized.claudeImagePromptEffort).toBe('low');
    expect(parseSettingsUpdate({ claudeImagePromptEffort: 'xhigh' })).toEqual({
      claudeImagePromptEffort: 'xhigh',
    });
    expect(() => parseSettingsUpdate({ claudeImagePromptEffort: 'none' })).toThrow();
  });

  it('keeps a valid claudeEffort and Claude model selections', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'claude-opus-5-5',
      imagePromptTextModel: 'claude-opus-5-5',
      claudeEffort: 'xhigh',
    });

    expect(normalized).toMatchObject({
      scriptTextModel: 'claude-opus-5-5',
      imagePromptTextModel: 'claude-opus-5-5',
      claudeEffort: 'xhigh',
    });
  });

  it('keeps OpenAI and Gemini effort settings independent from claudeEffort', () => {
    const normalized = normalizeSettings({
      scriptTextModel: 'claude-opus-5-5',
      imagePromptTextModel: 'gpt-5.6-terra',
      openaiReasoningEffort: 'high',
      geminiThinkingLevel: 'low',
      claudeEffort: 'low',
    });

    expect(normalized.openaiReasoningEffort).toBe('high');
    expect(normalized.geminiThinkingLevel).toBe('low');
    expect(normalized.claudeEffort).toBe('low');
  });

  it('accepts claudeEffort updates and rejects unknown values', () => {
    expect(
      parseSettingsUpdate({ scriptTextModel: 'claude-opus-5-5', claudeEffort: 'max' })
    ).toEqual({ scriptTextModel: 'claude-opus-5-5', claudeEffort: 'max' });
    expect(() => parseSettingsUpdate({ claudeEffort: 'none' })).toThrow();
    expect(() => parseSettingsUpdate({ scriptTextModel: 'claude-opus-5' })).toThrow();
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

it.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'] as const)(
  'round-trips the %s image model and defaults new settings to GPT Image 2.5 Sunburst',
  (imageModel) => {
    expect(normalizeSettings(parseSettingsUpdate({ imageModel }))).toMatchObject({ imageModel });
    expect(DEFAULT_SETTINGS.imageModel).toBe('gpt-image-2.5-sunburst');
  }
);

describe('Gemini image model GA migration', () => {
  it.each([
    ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'],
    ['gemini-3-pro-image-preview', 'gemini-3-pro-image'],
  ] as const)('reads a saved %s as %s', (legacy, current) => {
    expect(normalizeSettings({ imageModel: legacy }).imageModel).toBe(current);
    expect(parseSettingsUpdate({ imageModel: legacy }).imageModel).toBe(current);
  });

  it('keeps a saved Gemini or OpenAI image model and resets only unknown values', () => {
    expect(normalizeSettings({ imageModel: 'gemini-3-pro-image' }).imageModel).toBe(
      'gemini-3-pro-image'
    );
    expect(normalizeSettings({ imageModel: 'gpt-image-2' }).imageModel).toBe('gpt-image-2');
    expect(normalizeSettings({ imageModel: 'retired-model' }).imageModel).toBe(
      'gpt-image-2.5-sunburst'
    );
    expect(normalizeSettings({}).imageModel).toBe('gpt-image-2.5-sunburst');
  });
});

describe('auto generation defaults (mode and budget)', () => {
  it('defaults to fully automatic with a 5 USD budget and keeps the legacy concurrency field', () => {
    const normalized = normalizeSettings({});
    expect(normalized.generationMode).toBe('automatic');
    expect(normalized.generationBudgetUsd).toBe(5);
    expect(normalized.generationConcurrency).toBe(2);
    expect(normalizeSettings({ generationConcurrency: 4 }).generationConcurrency).toBe(4);
  });

  it('keeps saved values, including no budget limit (null)', () => {
    expect(
      normalizeSettings({ generationMode: 'review', generationBudgetUsd: null })
    ).toMatchObject({ generationMode: 'review', generationBudgetUsd: null });
    expect(normalizeSettings({ generationBudgetUsd: 0 }).generationBudgetUsd).toBe(0);
    expect(normalizeSettings({ generationBudgetUsd: 2.5 }).generationBudgetUsd).toBe(2.5);
  });

  it('resets invalid values to the defaults', () => {
    expect(normalizeSettings({ generationMode: 'fast' }).generationMode).toBe('automatic');
    expect(normalizeSettings({ generationBudgetUsd: -1 }).generationBudgetUsd).toBe(5);
    expect(normalizeSettings({ generationBudgetUsd: '3' }).generationBudgetUsd).toBe(5);
    expect(normalizeSettings({ generationBudgetUsd: Number.NaN }).generationBudgetUsd).toBe(5);
  });

  it('accepts updates from the screens and rejects invalid ones', () => {
    expect(parseSettingsUpdate({ generationMode: 'review', generationBudgetUsd: null })).toEqual({
      generationMode: 'review',
      generationBudgetUsd: null,
    });
    expect(parseSettingsUpdate({ generationBudgetUsd: 1.5 }).generationBudgetUsd).toBe(1.5);
    expect(() => parseSettingsUpdate({ generationMode: 'fast' })).toThrow();
    expect(() => parseSettingsUpdate({ generationBudgetUsd: -1 })).toThrow();
  });
});
